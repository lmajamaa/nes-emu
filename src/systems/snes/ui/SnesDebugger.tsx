import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { hex } from '../../../utils';
import { disassemble, disassembleFrom } from '../core/disassembler';
import type Snes from '../core/snes';

const UPCOMING_INSTRUCTIONS = 14;
const TILE_COLUMNS = 32;
const TILE_ROWS = 32;
const OBJ_ROWS = 16;

const rgb = (color: number) => `rgb(${(color & 31) << 3}, ${((color >> 5) & 31) << 3}, ${((color >> 10) & 31) << 3})`;

// Buttons give the keyboard back to the emulator once clicked
const blurAfter = (action: () => void) => (event: MouseEvent<HTMLElement>) => {
    action();
    event.currentTarget.blur();
};

const Flag = ({ name, set }: { name: string; set: boolean }) => <span className={set ? 'active' : 'inActive'}>{name}</span>;

const Registers = ({ snes }: { snes: Snes }) => {
    const { cpu } = snes;
    const indexDigits = cpu.xf ? 2 : 4;
    return (
        <div className="cpuArea">
            <h4>
                Status:
                <Flag name="N" set={cpu.n} />
                <Flag name="V" set={cpu.v} />
                <Flag name="M" set={cpu.m} />
                <Flag name="X" set={cpu.xf} />
                <Flag name="D" set={cpu.dec} />
                <Flag name="I" set={cpu.i} />
                <Flag name="Z" set={cpu.z} />
                <Flag name="C" set={cpu.c} />
                <Flag name="E" set={cpu.e} />
            </h4>
            <code>{`PC: $${hex(cpu.pbr, 2)}:${hex(cpu.pc, 4)}  A: $${hex(cpu.a, 4)}  X: $${hex(cpu.x, indexDigits)}  Y: $${hex(cpu.y, indexDigits)}`}</code>
            <code>{`S: $${hex(cpu.s, 4)}  D: $${hex(cpu.d, 4)}  DB: $${hex(cpu.dbr, 2)}${cpu.waiting ? '  WAI' : ''}${cpu.stopped ? '  STP' : ''}`}</code>
        </div>
    );
};

// The last instructions run, and the ones from the program counter on
const Disassembly = ({ snes }: { snes: Snes }) => {
    const { cpu, bus } = snes;
    const read = (addr: number) => bus.peek(addr);
    const pc = (cpu.pbr << 16) | cpu.pc;
    const flags = { m: cpu.m, x: cpu.xf };
    // The flags may have changed since, so these can decode a little differently than they ran
    const recent = snes.recentInstructions().slice(-6).map(address => disassemble(read, address, { ...flags }).text);
    const upcoming = disassembleFrom(read, pc, flags, UPCOMING_INSTRUCTIONS).map(line => line.text);
    return (
        <div className="codeArea">
            {recent.map((line, i) => <code key={`r${i}`} className="recent">{line}</code>)}
            {upcoming.map((line, i) => <code key={`u${i}`} className={i === 0 ? 'current' : undefined}>{line}</code>)}
        </div>
    );
};

const PpuState = ({ snes }: { snes: Snes }) => {
    const info = snes.bus.ppu.debugInfo();
    const layers = (screen: number) => ['BG1', 'BG2', 'BG3', 'BG4', 'OBJ'].filter((_, i) => screen & (1 << i)).join(' ') || '-';
    const setini = [info.setini & 0x08 && 'pseudo hi-res', info.setini & 0x04 && 'overscan', info.setini & 0x01 && 'interlace',
        info.setini & 0x40 && 'EXTBG'].filter(Boolean).join(', ');
    return (
        <div className="cpuArea snesPanel">
            <code>{`Mode ${info.mode}${info.mode === 1 && info.bg3Priority ? ' (BG3 priority)' : ''}  ${info.forceBlank ? 'Force blank' : `Brightness ${info.brightness}`}${setini ? `  ${setini}` : ''}`}</code>
            <code>{`Main: ${layers(info.mainScreen)}   Sub: ${layers(info.subScreen)}`}</code>
            {[0, 1, 2, 3].map(bg => (
                <code key={bg}>{`BG${bg + 1} map $${hex(info.bgScreenAddress[bg], 4)} tiles $${hex(info.bgTileAddress[bg], 4)} scroll ${info.bgHOffset[bg]},${info.bgVOffset[bg]}`}</code>
            ))}
        </div>
    );
};

const Cgram = ({ snes, selected, onSelect }: { snes: Snes; selected: number; onSelect: (row: number) => void }) => {
    const size = 8;
    const { cgram } = snes.bus.ppu;
    return (
        <svg className="palette" width={16 * size + 2} height={16 * size + 2}>
            {Array.from({ length: 256 }, (_, i) => (
                <rect key={i} x={(i & 15) * size + 1} y={(i >> 4) * size + 1} width={size} height={size} fill={rgb(cgram[i])}
                    onClick={() => onSelect(i >> 4)} />
            ))}
            <rect x={0.5} y={selected * size + 0.5} width={16 * size + 1} height={size + 1} fill="none" stroke="goldenrod" />
        </svg>
    );
};

// VRAM as tiles of a color depth, with a palette row of CGRAM
const Tiles = ({ snes, bpp, page, palette }: { snes: Snes; bpp: number; page: number; palette: number }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const context = canvasRef.current?.getContext('2d');
        if (!context) return;
        const { vram, cgram } = snes.bus.ppu;
        const image = context.createImageData(TILE_COLUMNS * 8, TILE_ROWS * 8);
        const pixels = new Uint32Array(image.data.buffer);
        const wordsPerTile = bpp * 4;
        const base = page * TILE_COLUMNS * TILE_ROWS * wordsPerTile;
        const paletteBase = bpp === 8 ? 0 : palette * 16;

        for (let tile = 0; tile < TILE_COLUMNS * TILE_ROWS; tile++) {
            const address = base + tile * wordsPerTile;
            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    // Bitplanes in pairs, a word per row, 8 words apart
                    let index = 0;
                    for (let pair = 0; pair < bpp / 2; pair++) {
                        const word = vram[(address + pair * 8 + y) & 0x7FFF];
                        index |= ((word >> (7 - x)) & 1) << (pair * 2);
                        index |= ((word >> (15 - x)) & 1) << (pair * 2 + 1);
                    }
                    const color = cgram[(paletteBase + index) & 0xFF];
                    const px = (tile % TILE_COLUMNS) * 8 + x;
                    const py = Math.floor(tile / TILE_COLUMNS) * 8 + y;
                    pixels[py * TILE_COLUMNS * 8 + px] = 0xFF000000 | (((color >> 10) & 31) << 19) | (((color >> 5) & 31) << 11) | ((color & 31) << 3);
                }
            }
        }
        context.putImageData(image, 0, 0);
    });

    return <canvas id="patternCanvas" ref={canvasRef} width={TILE_COLUMNS * 8} height={TILE_ROWS * 8} />;
};

// The sprites on the screen, from OAM
const Objects = ({ snes }: { snes: Snes }) => {
    const { oam } = snes.bus.ppu;
    const rows: string[] = [];
    for (let i = 0; i < 128 && rows.length < OBJ_ROWS; i++) {
        const high = oam[0x200 + (i >> 2)] >> ((i & 3) * 2);
        const x = ((oam[i * 4] | ((high & 1) << 8)) << 23) >> 23;
        const y = oam[i * 4 + 1];
        if (y >= 224 && y < 240 || x <= -64) continue;
        const attributes = oam[i * 4 + 3];
        const tile = oam[i * 4 + 2] | ((attributes & 1) << 8);
        const flips = `${attributes & 0x40 ? 'H' : '-'}${attributes & 0x80 ? 'V' : '-'}`;
        rows.push(`#${String(i).padStart(3)} ${String(x).padStart(4)},${String(y).padStart(3)} tile $${hex(tile, 3)} pal ${(attributes >> 1) & 7} pri ${(attributes >> 4) & 3} ${flips}${high & 2 ? ' large' : ''}`);
    }
    return (
        <div className="codeArea">
            {rows.length ? rows.map((row, i) => <code key={i}>{row}</code>) : <code>No sprites on the screen</code>}
        </div>
    );
};

const VOICE_BAR_WIDTH = 10;
const VOICE_BAR_HEIGHT = 16;

// Each voice's envelope as a bar, in a fixed size so the layout doesn't move as they change
const VoiceBars = ({ envelopes }: { envelopes: number[] }) => (
    <svg className="voiceBars" width={envelopes.length * (VOICE_BAR_WIDTH + 2)} height={VOICE_BAR_HEIGHT}>
        {envelopes.map((envelope, v) => {
            const height = Math.round(envelope / 0x7F * VOICE_BAR_HEIGHT);
            return <rect key={v} x={v * (VOICE_BAR_WIDTH + 2)} y={VOICE_BAR_HEIGHT - height} width={VOICE_BAR_WIDTH} height={height} fill="goldenrod" />;
        })}
    </svg>
);

const ApuState = ({ snes }: { snes: Snes }) => {
    const { apu } = snes.bus;
    const envelopes = Array.from({ length: 8 }, (_, v) => apu.dsp.read((v << 4) | 0x08));
    return (
        <div className="cpuArea snesPanel">
            <code>{`SPC700 PC: $${hex(apu.spc.pc, 4)}  Ports: ${[...apu.outputs].map(v => hex(v, 2)).join(' ')}`}</code>
            <div className="voices">
                <code>Voices:</code>
                <VoiceBars envelopes={envelopes} />
            </div>
        </div>
    );
};

const SnesDebugger = ({ snes, children }: { snes: Snes | null; children: ReactNode }) => {
    const [bpp, setBpp] = useState(4);
    const [page, setPage] = useState(0);
    const [palette, setPalette] = useState(0);
    if (!snes) return <div className="column">{children}</div>;

    // A page is 1024 tiles, so VRAM holds more pages of fewer colors
    const pages = 0x8000 / (TILE_COLUMNS * TILE_ROWS * bpp * 4);
    return (
        <>
            <div className="column">
                {children}
                <code className="instructions">C = Step Instruction</code>
                <Registers snes={snes} />
                <Disassembly snes={snes} />
            </div>
            <div className="column">
                <PpuState snes={snes} />
                <Cgram snes={snes} selected={palette} onSelect={setPalette} />
                <div className="snesButtons">
                    <button className="button" onClick={blurAfter(() => { setBpp(b => (b === 8 ? 2 : b * 2)); setPage(0); })}>
                        {bpp}bpp tiles
                    </button>
                    <button className="button" onClick={blurAfter(() => setPage(p => (p + 1) % pages))}>
                        Page {page + 1} of {pages}
                    </button>
                </div>
                <Tiles snes={snes} bpp={bpp} page={page % pages} palette={palette} />
                <ApuState snes={snes} />
                <Objects snes={snes} />
            </div>
        </>
    );
};

export default SnesDebugger;

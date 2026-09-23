import { useMemo, type ReactNode } from 'react';
import type { NesEmulator } from '..';
import Ram from './Ram';
import Cpu from './Cpu';
import Code from './Code';
import Palette from './Palette';
import PatternTable from './PatternTable';

const NesDebugger = ({ nes, children }: { nes: NesEmulator; children: ReactNode }) => {
    const { bus, selectedPalette } = nes;
    const disassembly = useMemo(() => bus.cpu.disassemble(0x0000, 0xFFFF), [bus]);

    const palettes: string[][] = [];
    for (let p = 0; p < 8; p++) {
        const palette = [];
        for (let s = 0; s < 4; s++) {
            const pixel = bus.ppu.getColorFromPaletteRam(p, s);
            palette.push(`rgb(${pixel.r}, ${pixel.g}, ${pixel.b})`);
        }
        palettes.push(palette);
    }

    return (
        <>
            <div className="column">
                {children}
                <code className="instructions">C = Step Instruction    P = Palette    I = IRQ    N = NMI</code>
                <Ram nes={bus} nAddr={0x0000} nRows={16} nColumns={16} />
                <Ram nes={bus} nAddr={0x8000} nRows={16} nColumns={16} />
            </div>
            <div className="column">
                <Cpu cpu={{ ...bus.cpu }} />
                <Code pc={bus.cpu.pc} mapAsm={disassembly} />
                <div>
                    {palettes.map((palette, index) => <Palette key={index} size={10} data={palette} selected={selectedPalette === index} />)}
                </div>
                <div>
                    <PatternTable patternTable={bus.ppu.getPatternTable(0, selectedPalette)} />
                    <PatternTable patternTable={bus.ppu.getPatternTable(1, selectedPalette)} />
                </div>
            </div>
        </>
    );
};

export default NesDebugger;

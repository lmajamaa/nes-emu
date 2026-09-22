import { useCallback, useEffect, useState, useRef, type ChangeEvent } from 'react';
import Bus from './nes/bus';
import Ram from './components/Ram';
import Cpu from './components/Cpu';
import Code from './components/Code';
import Cartridge, { SUPPORTED_MAPPERS } from './nes/cartridge';
import { Button } from './nes/controller';
import type { CpuState } from './nes/cpu';
import PatternTable from './components/PatternTable';
import Palette from './components/Palette';
import nestestUrl from '../test/data/nestest/nestest.nes?url';
import AudioOutput from './audio/audioOutput';

const DEBUG_REFRESH_MS = 100;
const NTSC_FRAME_MS = 1000 / 60.0988;
const MAX_FRAMES_PER_TICK = 4;

const nes = new Bus();
const audio = new AudioOutput();
let bEmulationRun = false;

// Has to be called from a user gesture
function startAudio(): void {
    audio.start()
        .then(() => nes.apu.setSampleRate(audio.sampleRate!))
        .catch(e => console.warn('Audio is not available', e));
}

const CONTROLLER_KEYS: Record<string, number> = {
    KeyX: Button.A,
    KeyZ: Button.B,
    KeyA: Button.Select,
    KeyS: Button.Start,
    ArrowUp: Button.Up,
    ArrowDown: Button.Down,
    ArrowLeft: Button.Left,
    ArrowRight: Button.Right,
};

// Keys typed into the ROM file picker shouldn't reach the emulator
function isFormControl(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement;
}

function handleControllerKey(event: KeyboardEvent): boolean {
    const button = CONTROLLER_KEYS[event.code];
    if (button === undefined) return false;

    if (event.type === 'keydown') {
        if (isFormControl(event.target)) return false;
        nes.controller[0] |= button;
    } else {
        // Always release, the key may have been pressed before focus moved
        nes.controller[0] &= ~button;
    }
    event.preventDefault();
    return true;
}

const App = () => {
    const [rom, setRom] = useState<string | null>(null);
    const [romError, setRomError] = useState<string | null>(null);
    const [cpu, setCpu] = useState<CpuState>(nes.cpu);
    const [disassembly, setDisassembly] = useState<string[]>([]);
    const [selectedPalette, setSelectedPalette] = useState(0x00);
    const [muted, setMuted] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const toggleMute = useCallback(() => {
        const mute = !audio.isMuted;
        audio.setMuted(mute);
        setMuted(mute);
        startAudio();
    }, []);

    const handleUserKeyPress = useCallback((event: KeyboardEvent) => {
        if (handleControllerKey(event) || isFormControl(event.target)) return;

        switch (event.code) {
            case 'Space':
                event.preventDefault();
                bEmulationRun = !bEmulationRun;
                if (bEmulationRun) {
                    startAudio();
                } else {
                    audio.clear();
                }
                break;
            case 'KeyM':
                toggleMute();
                break;
            case 'KeyC':
                // Clock enough times to execute a whole CPU instruction
                do { nes.clock(); } while (!nes.cpu.complete());
                // CPU clock runs slower than system clock, so it may be
                // complete for additional system clock cycles. Drain
                // those out
                do { nes.clock(); } while (!nes.cpu.complete());
                updateCanvas();
                break;
            case 'KeyF':
                // Clock enough times to draw a single frame
                do { nes.clock(); } while (!nes.ppu.frame_complete);
                // Use residual clock cycles to complete current instruction
                do { nes.clock(); } while (!nes.cpu.complete());
                // Reset frame completion flag
                nes.ppu.frame_complete = false;
                updateCanvas();
                break;
            case 'KeyP':
                setSelectedPalette(s => (s + 1) & 0x07);
                break;
            case 'KeyR':
                nes.cpu.reset();
                break;
            case 'KeyI':
                nes.cpu.irq();
                break;
            case 'KeyN':
                nes.cpu.nmi();
                break;
            default:
                break;
        }
        const cpuState = { ...nes.cpu };
        setCpu(cpuState);
    }, [toggleMute]);

    const loadRom = useCallback((name: string, data: ArrayBuffer) => {
        let cartridge: Cartridge;
        try {
            cartridge = new Cartridge(data);
        } catch (e) {
            setRomError(`Could not load ${name}: ${e instanceof Error ? e.message : e}`);
            return;
        }

        nes.insertCartridge(cartridge);
        const canvas = canvasRef.current;
        canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
        // Extract dissassembly
        setDisassembly(nes.cpu.disassemble(0x0000, 0xFFFF));
        nes.reset();
        setCpu({ ...nes.cpu });
        setRom(name);
        setRomError(null);
    }, []);

    useEffect(() => {
        fetch(nestestUrl)
            .then(response => response.arrayBuffer())
            .then(data => loadRom('nestest.nes', data));
    }, [loadRom]);

    useEffect(() => {
        window.addEventListener('keydown', handleUserKeyPress);
        window.addEventListener('keyup', handleControllerKey);

        return () => {
            window.removeEventListener('keydown', handleUserKeyPress);
            window.removeEventListener('keyup', handleControllerKey);
        };
    }, [handleUserKeyPress]);

    useEffect(() => {
        let lastDebugUpdate = 0;
        let startTime: number | null = null;
        let framesDone = 0;
        let requestId = 0;

        function tick(now: number) {
            requestId = requestAnimationFrame(tick);
            if (!bEmulationRun || !nes.cartridge) {
                startTime = null;
                // Drops the sound of stepping while paused
                nes.apu.takeSamples();
                return;
            }
            if (startTime === null) {
                startTime = now;
                framesDone = 0;
            }

            // Emulate as many frames as real time asks for, so sound is generated at the right rate
            let framesDue = Math.floor((now - startTime) / NTSC_FRAME_MS) - framesDone;
            if (framesDue > MAX_FRAMES_PER_TICK) {
                // Far behind, e.g. the tab was in the background, so skip ahead instead
                framesDone += framesDue - 1;
                framesDue = 1;
            }
            for (let i = 0; i < framesDue; i++) {
                do { nes.clock(); } while (!nes.ppu.frame_complete);
                nes.ppu.frame_complete = false;
                framesDone++;
                const samples = nes.apu.takeSamples();
                if (audio.ready) audio.push(samples);
            }
            if (framesDue === 0) return;

            updateCanvas();
            // Refreshing the debug views every frame is too fast to read and slows down emulation
            if (now - lastDebugUpdate >= DEBUG_REFRESH_MS) {
                lastDebugUpdate = now;
                setCpu({ ...nes.cpu });
            }
        }

        requestId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(requestId);
    }, []); // This effect never re-runs

    async function handleRomOpened(event: ChangeEvent<HTMLInputElement>) {
        const input = event.currentTarget;
        const file = input.files?.[0];
        if (file) loadRom(file.name, await file.arrayBuffer());
        // Allows choosing the same file again, and gives the keyboard back to the emulator
        input.value = '';
        input.blur();
    }

    function updateCanvas() {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;

        const canvasData = context.getImageData(0, 0, canvas.width, canvas.height);
        const screen = nes.ppu.getScreen();

        for (let x = 0; x < screen.width; x++) {
            for (let y = 0; y < screen.height; y++) {
                const pixel = screen.getPixel(x, y);
                const index = (x * 4 + (y * screen.width) * 4);
                canvasData.data[index + 0] = pixel.r;
                canvasData.data[index + 1] = pixel.g;
                canvasData.data[index + 2] = pixel.b;
                canvasData.data[index + 3] = 255;
            }
        }

        context.putImageData(canvasData, 0, 0);
    }

    const palettes: string[][] = [];
    if (nes.cartridge) {
        for (let p = 0; p < 8; p++) {
            const palette = [];
            for (let s = 0; s < 4; s++) {
                let pixel = nes.ppu.getColorFromPaletteRam(p, s);
                palette.push(`rgb(${pixel.r}, ${pixel.g}, ${pixel.b})`);
            }
            palettes.push(palette);
        }
    }

    const patternTable0 = nes.cartridge ? nes.ppu.getPatternTable(0, selectedPalette) : null;
    const patternTable1 = nes.cartridge ? nes.ppu.getPatternTable(1, selectedPalette) : null;
    const unsupportedMapper = nes.cartridge && !SUPPORTED_MAPPERS.includes(nes.cartridge.mapperId)
        ? nes.cartridge.mapperId
        : null;

    return (
        <div className="gameArea">
            <h1>NES Emulator{rom && ` - ${rom}`}</h1>
            <div className="toolbar">
                <label className="button">
                    Open ROM…
                    <input type="file" accept=".nes" onChange={handleRomOpened} hidden />
                </label>
                <button className="button" onClick={event => { toggleMute(); event.currentTarget.blur(); }}>
                    Sound: {muted ? 'Off' : 'On'}
                </button>
            </div>
            {romError && <p className="message error">{romError}</p>}
            {unsupportedMapper !== null && (
                <p className="message">Mapper {unsupportedMapper} is not supported yet, running it as mapper 0 so it may not work.</p>
            )}
            {nes.cartridge ?
                <div className="container">
                    <div className="column">
                        <canvas id="emulationCanvas" ref={canvasRef} width="256" height="240" />
                        <code className="instructions">SPACE = Run/Pause    C = Step Instruction    F = Step Frame    P = Palette    M = Mute    R = RESET    I = IRQ    N = NMI</code>
                        <code className="instructions">Controller: Arrows = D-pad    X = A    Z = B    A = Select    S = Start</code>
                        <Ram nes={nes} nAddr={0x0000} nRows={16} nColumns={16} />
                        <Ram nes={nes} nAddr={0x8000} nRows={16} nColumns={16} />
                    </div>
                    <div className="column">
                        <Cpu cpu={cpu} />
                        <Code pc={cpu.pc} mapAsm={disassembly} />
                        <div>
                            {palettes.map((palette, index) => <Palette key={index} size={10} data={palette} selected={selectedPalette === index} />)}
                        </div>
                        <div>
                            {patternTable0 && <PatternTable patternTable={patternTable0} />}
                            {patternTable1 && <PatternTable patternTable={patternTable1} />}
                        </div>
                    </div>
                </div>
                : !romError && <p className="message">Loading…</p>}
        </div>
    )
}

export default App;

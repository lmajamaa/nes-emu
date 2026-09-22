import React, { useCallback, useEffect, useState, useRef } from 'react';
import Bus from './nes/bus';
import Ram from './components/Ram';
import Cpu from './components/Cpu';
import Code from './components/Code';
import Cartridge from './nes/cartridge';
import PatternTable from './components/PatternTable';
import Palette from './components/Palette';

const nes = new Bus();
let bEmulationRun = false;
//let fResidualTime = 0.0;

const App = () => {
    const [rom, setRom] = useState('nestest.nes');
    const [cpu, setCpu] = useState(nes.cpu);
    const [disassembly, setDisassembly] = useState([]);
    const [selectedPalette, setSelectedPalette] = useState(0x00);
    const canvasRef = useRef(null);

    const handleUserKeyPress = useCallback(event => {
        const { code } = event;
        switch (code) {
            case 'Space':
                //do { nes.clock(); } while (!nes.cpu.complete());
                bEmulationRun = !bEmulationRun;
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
    }, []);

    useEffect(() => {
        window.addEventListener('keydown', handleUserKeyPress);

        async function getRom() {
            const response = await fetch('/roms/' + rom);

            if (response.ok) {
                const data = await response.arrayBuffer();
                // setRom(data);
                nes.insertCartridge(new Cartridge(data));
                //console.log('rom loaded');
                // Extract dissassembly
                const mapAsm = nes.cpu.disassemble(0x0000, 0xFFFF);
                setDisassembly(mapAsm);

                // Reset
                nes.reset();
                //console.log('reset done');
                const cpuState = { ...nes.cpu };
                setCpu(cpuState);

            }
        }

        getRom();

        return () => {
            window.removeEventListener('keydown', handleUserKeyPress);
        };
    }, [handleUserKeyPress, rom]);

    useEffect(() => {
        function tick() {
            if (bEmulationRun) {
                do { nes.clock(); } while (!nes.ppu.frame_complete);
                nes.ppu.frame_complete = false;
                updateCanvas();
                const cpuState = { ...nes.cpu };
                setCpu(cpuState);
            }
        }

        const id = setInterval(tick, 1000 / 60); // NTSC 60Hz
        return () => clearInterval(id);
    }, []); // This effect never re-runs

    function updateCanvas() {
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        var canvasData = context.getImageData(0, 0, canvas.width, canvas.height);
        const screen = nes.ppu.getScreen();
       
        for (let x = 0; x < screen.width; x++) {
            for (let y = 0; y < screen.height; y++) {
                let pixel = undefined;
                try {
                pixel = screen.getPixel(x, y);
                let index = (x * 4 + (y * screen.width) * 4);
                canvasData.data[index + 0] = pixel.r;
                canvasData.data[index + 1] = pixel.g;
                canvasData.data[index + 2] = pixel.b;
                canvasData.data[index + 3] = 255;
            } catch(e) {
                console.log('Failed to update screen', screen,x, y, pixel);
                break;
            }
            }
        }
        
        context.putImageData(canvasData, 0, 0);
    }

    const palettes = [];
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

    return (
        <div className="gameArea">
            <h1>NES Emulator - {rom}</h1>
            {nes.cartridge ?
                <div className="container">
                    <div className="column">
                        <canvas id="emulationCanvas" ref={canvasRef} width="256" height="240" />
                        <code className="instructions">SPACE = Run/Pause    C = Step Instruction    F = Step Frame    P = Palette    R = RESET    I = IRQ    N = NMI</code>
                        <Ram nes={nes} x={2} y={2} nAddr={0x0000} nRows={16} nColumns={16} />
                        <Ram nes={nes} x={2} y={182} nAddr={0x8000} nRows={16} nColumns={16} />
                    </div>
                    <div className="column">
                        <Cpu cpu={cpu} />
                        <Code pc={cpu.pc} mapAsm={disassembly} x={512} y={72} nLines={26} />
                        <div>
                            {palettes.map((palette, index) => <Palette key={index} size={10} data={palette} selected={selectedPalette === index} />)}
                        </div>
                        <div>
                            <PatternTable patternTable={patternTable0} />
                            <PatternTable patternTable={patternTable1} />
                        </div>
                    </div>
                </div>
                : <div>Loading</div>}
        </div>
    )
}

export default App;
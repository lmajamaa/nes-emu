import React, { useCallback, useEffect, useState, useRef } from 'react';
import Bus from './nes/bus';
import Ram from './components/Ram';
import Cpu from './components/Cpu';
import Code from './components/Code';
import Cartridge from './nes/cartridge';

const nes = new Bus();
let bEmulationRun = false;
//let fResidualTime = 0.0;

const App = () => {
    // const [rom, setRom] = useState(null);
    const [cpu, setCpu] = useState(nes.cpu);
    const [disassembly, setDisassembly] = useState([]);
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
                //do { nes.clock(); } while (nes.cpu.complete());
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
            const response = await fetch('/roms/nestest.nes');

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
    }, [handleUserKeyPress]);

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
                let pixel = screen.getPixel(x, y);
                let index = (x * 4 + (y * screen.width)* 4);
                if (x === 128) {
                    canvasData.data[index + 0] = 218;
                    canvasData.data[index + 1] = 168;
                    canvasData.data[index + 2] = 32;
                    canvasData.data[index + 3] = 255;
                } else if (y === 120) {
                    canvasData.data[index + 0] = 255;
                    canvasData.data[index + 1] = 0;
                    canvasData.data[index + 2] = 0;
                    canvasData.data[index + 3] = 0;
                } else {
                    canvasData.data[index + 0] = pixel.r;
                    canvasData.data[index + 1] = pixel.g;
                    canvasData.data[index + 2] = pixel.b;
                    canvasData.data[index + 3] = 255;
                }
            }
        }
        context.putImageData(canvasData, 0, 0);
    }

    return (
        <div className="gameArea">
            <h1>NES Emulator</h1>
            {nes.cartridge ?
                <div className="container">
                    <div className="column">
                        <canvas id="emulationCanvas" ref={canvasRef} width="256" height="240" />
                        <code className="instructions">SPACE = Step Instruction    R = RESET    I = IRQ    N = NMI</code>
                        <Ram nes={nes} x={2} y={2} nAddr={0x0000} nRows={16} nColumns={16} />
                        <Ram nes={nes} x={2} y={182} nAddr={0x8000} nRows={16} nColumns={16} />
                    </div>
                    <div>
                        <Cpu cpu={cpu} />
                        <Code pc={cpu.pc} mapAsm={disassembly} x={512} y={72} nLines={26} />
                    </div>
                </div>
                : <div>Loading</div>}
        </div>
    )
}

export default App;
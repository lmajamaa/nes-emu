import React, { useCallback, useEffect, useState } from 'react';
import Bus from './nes/bus';
import Ram from './components/Ram';
import Cpu from './components/Cpu';
import Code from './components/Code';

const nes = new Bus();
// Load temp program
const program = "A2 0A 8E 00 00 A2 03 8E 01 00 AC 00 00 A9 00 18 6D 01 00 88 D0 FA 8D 02 00 EA EA EA";
let nOffset = 0x8000;

for (let hex of program.split(' ')) {
    nes.ram[nOffset] = parseInt(hex, 16);
    nOffset++;
}

// Set Reset Vector
nes.ram[0xFFFC] = 0x00;
nes.ram[0xFFFD] = 0x80;

// Reset
nes.cpu.reset();

const App = () => {

    const [cpu, setCpu] = useState(nes.cpu);

    const handleUserKeyPress = useCallback(event => {
        const { code } = event;
        switch (code) {
            case 'Space':
                do {
                    nes.cpu.clock();
                }
                while (!nes.cpu.complete());
                break;
            case "KeyR":
                nes.cpu.reset();
                break;
            case "KeyI":
                nes.cpu.irq();
                break;
            case "KeyN":
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

        return () => {
            window.removeEventListener('keydown', handleUserKeyPress);
        };
    }, [handleUserKeyPress]);

    // Extract dissassembly
    const mapAsm = nes.cpu.disassemble(0x0000, 0xFFFF);

    return nes ? (
        <div className="gameArea">
            <h1>NES Emulator</h1>
            <div className="container">
                <div className="column">
                    <canvas id="emulationCanvas" width="256" height="240" />
                    <code className="instructions">SPACE = Step Instruction    R = RESET    I = IRQ    N = NMI</code>
                    <Ram nes={nes} x={2} y={2} nAddr={0x0000} nRows={16} nColumns={16} />
                    <Ram nes={nes} x={2} y={182} nAddr={0x8000} nRows={16} nColumns={16} />
                </div>
                <div>
                    <Cpu cpu={cpu} />
                    <Code pc={cpu.pc} mapAsm={mapAsm} x={448} y={72} nLines={26} />
                </div>
            </div>
        </div>
    ) : <div>Loading</div>
}

export default App;
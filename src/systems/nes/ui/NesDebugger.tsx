import { useMemo, type ReactNode } from 'react';
import type { NesEmulator } from '..';
import { cssColor } from '../core/graphics';
import Ram from './Ram';
import Cpu from './Cpu';
import Code from './Code';
import Palette from './Palette';
import PatternTable from './PatternTable';

const NesDebugger = ({ nes, children }: { nes: NesEmulator; children: ReactNode }) => {
    const { bus, selectedPalette } = nes;
    const disassembly = useMemo(() => bus.cpu.disassemble(0x0000, 0xFFFF), [bus]);
    const palettes = Array.from({ length: 8 }, (_, palette) =>
        Array.from({ length: 4 }, (_, pixel) => cssColor(bus.ppu.colorOf(palette, pixel))));

    return (
        <>
            <div className="column">
                {children}
                <code className="instructions">C = Step Instruction    P = Palette    I = IRQ    N = NMI</code>
                <Ram bus={bus} start={0x0000} rows={16} columns={16} />
                <Ram bus={bus} start={0x8000} rows={16} columns={16} />
            </div>
            <div className="column">
                <Cpu cpu={bus.cpu} />
                <Code pc={bus.cpu.pc} lines={disassembly} />
                <div>
                    {palettes.map((colors, index) => <Palette key={index} size={10} colors={colors} selected={selectedPalette === index} />)}
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

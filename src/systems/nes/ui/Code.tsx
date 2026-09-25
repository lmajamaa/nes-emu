import { useMemo } from 'react';

const LINES_AROUND_PC = 12;

interface CodeProps {
    pc: number;
    // By address
    lines: ReadonlyMap<number, string>;
}

// Index of the last address that is <= pc
function findLine(addresses: readonly number[], pc: number): number {
    let lo = 0;
    let hi = addresses.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (addresses[mid] <= pc) lo = mid + 1; else hi = mid;
    }
    return lo - 1;
}

const Code = ({ pc, lines }: CodeProps) => {
    // In order, as the disassembler adds them
    const addresses = useMemo(() => [...lines.keys()], [lines]);
    const current = findLine(addresses, pc);

    return (
        <div className="codeArea">
            {Array.from({ length: LINES_AROUND_PC * 2 + 1 }, (_, i) => {
                const offset = i - LINES_AROUND_PC;
                const addr = addresses[current + offset];
                // Keyed by position so React only updates the text of each line
                return (
                    <code key={offset} className={addr === pc ? 'current' : undefined}>
                        {addr === undefined ? ' ' : lines.get(addr)}
                    </code>
                );
            })}
        </div>
    );
};

export default Code;

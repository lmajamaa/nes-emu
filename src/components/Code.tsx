import { useMemo } from 'react';

const LINES_AROUND_PC = 12;

interface CodeProps {
    pc: number;
    // Sparse, indexed by address
    mapAsm: string[];
}

// Index of the last address that is <= pc
function findLine(addresses: number[], pc: number): number {
    let lo = 0;
    let hi = addresses.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (addresses[mid] <= pc) lo = mid + 1; else hi = mid;
    }
    return lo - 1;
}

const Code = ({ pc, mapAsm }: CodeProps) => {
    const addresses = useMemo(() => Object.keys(mapAsm).map(Number), [mapAsm]);
    const current = findLine(addresses, pc);

    const lines = [];
    for (let offset = -LINES_AROUND_PC; offset <= LINES_AROUND_PC; offset++) {
        const addr = addresses[current + offset];
        // Keyed by position so React only updates the text of each line
        lines.push(
            <code key={offset} className={addr === pc ? 'current' : undefined}>
                {addr === undefined ? ' ' : mapAsm[addr]}
            </code>
        );
    }

    return (
        <div className="codeArea">
            {lines}
        </div>
    )
};

export default Code;

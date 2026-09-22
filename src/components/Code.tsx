import type { ReactElement } from 'react';

interface CodeProps {
    pc: number;
    // Sparse, indexed by address
    mapAsm: string[];
}

const Code = ({ pc, mapAsm }: CodeProps) => {
    const items: ReactElement[] = [];

    for (let i = pc - 25; i < pc; i++) {
        let it_a = mapAsm[i];
        if (it_a) {
            items.push(<code key={it_a}>{it_a}<br /></code>)
        }
    }

    for (let i = pc; i <= pc + 25; i++) {
        let it_a = mapAsm[i];
        if (it_a) {
            items.push(<code className={i === pc ? 'current' : undefined} key={it_a}>{it_a}<br /></code>)
        }
    }

    return (
        <div className="codeArea">
            {items}
        </div>
    )
};

export default Code;

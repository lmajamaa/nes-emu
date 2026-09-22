import type { ReactElement } from 'react';
import { hex } from '../utils';
import type Bus from '../nes/bus';

interface RamProps {
    nes: Bus;
    nAddr: number;
    nRows: number;
    nColumns: number;
}

const Ram = ({ nes, nAddr, nRows, nColumns }: RamProps) => {
    const items: ReactElement[] = [];

    for (let row = 0; row < nRows; row++) {
        let sOffset = '$' + hex(nAddr, 4) + ': ';
        for (let col = 0; col < nColumns; col++) {
            sOffset += hex(nes.cpuRead(nAddr, true), 2) + ' ';
            nAddr += 1;
        }
        items.push(<code key={row}>{sOffset}</code>)
    }

    return (
        <div className="ramArea">
            {items}
        </div>
    )
};

export default Ram;

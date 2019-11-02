import React from 'react';
import { hex } from '../utilities';

const Ram = ({ nes, x, y, nAddr, nRows, nColumns }) => {
    const items = [];

    for (let row = 0; row < nRows; row++) {
        let sOffset = '$' + hex(nAddr, 4) + ': ';
        for (let col = 0; col < nColumns; col++) {
            sOffset += hex(nes.read(nAddr, true), 2) + ' ';
            nAddr += 1;
        }
        items.push(<code key={sOffset}>{sOffset}<br /></code>)
    }

    return (
        <div className="ramArea">
            {items}
        </div>
    )
};

export default Ram;
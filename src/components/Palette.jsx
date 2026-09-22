import React from 'react';

const Palette = ({ data, size, selected }) => (
    <svg className="palette" width={size * 4 + 2} height={size + 2}>
        {selected && <rect x={size * 0} y="0" width={size * 4 + 2} height={size + 2} strokeWidth="2" stroke="goldenrod" />}
        <rect x={size * 0 + 1} y="1" width={size} height={size} fill={data[0]} />
        <rect x={size * 1 + 1} y="1" width={size} height={size} fill={data[0]} />
        <rect x={size * 2 + 1} y="1" width={size} height={size} fill={data[0]} />
        <rect x={size * 3 + 1} y="1" width={size} height={size} fill={data[0]} />
    </svg>
)

export default Palette;

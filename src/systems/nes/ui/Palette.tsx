interface PaletteProps {
    // CSS colours
    colors: readonly string[];
    size: number;
    selected: boolean;
}

const Palette = ({ colors, size, selected }: PaletteProps) => (
    <svg className="palette" width={size * colors.length + 2} height={size + 2}>
        {selected && <rect x="0" y="0" width={size * colors.length + 2} height={size + 2} strokeWidth="2" stroke="goldenrod" />}
        {colors.map((color, i) => <rect key={i} x={size * i + 1} y="1" width={size} height={size} fill={color} />)}
    </svg>
);

export default Palette;

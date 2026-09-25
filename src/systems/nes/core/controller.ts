// Bits of a controller state, in the order the NES reads them (A first)
export const Button = {
    A: 0x80,
    B: 0x40,
    Select: 0x20,
    Start: 0x10,
    Up: 0x08,
    Down: 0x04,
    Left: 0x02,
    Right: 0x01,
} as const;

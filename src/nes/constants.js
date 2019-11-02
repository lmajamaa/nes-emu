export const RENDERING_MODES = {
    NORMAL: 0,
    SPLIT: 1
};

export const MODES = {
    ABS: 0, // Absolute
    ABX: 1, // Absolute with X offset
    ABY: 2, // Absolute with Y offset
    IMM: 4, // Immediate
    IMP: 5, // Implied
    IZX: 6, // Indirect X
    IND: 7, // Indirect
    IZY: 8, // Indirect Y
    REL: 9, // Relative
    ZP0: 10, // Zero page
    ZPX: 11, // Zero page with X offset
    ZPY: 12, // Zero page with Y offset
};

export const OPCODES = {
    ADC: 0,
    AND: 1,
    ASL: 2,
    BCC: 3,
    BCS: 4,
    BEQ: 5,
    BIT: 6,
    BMI: 7,
    BNE: 8,
    BPL: 9,
    BRK: 10,
    BVC: 11,
    BVS: 12,
    CLC: 13,
    CLD: 14,
    CLI: 15,
    CLV: 16,
    CMP: 17,
    CPX: 18,
    CPY: 19,
    DEC: 20,
    DEX: 21,
    DEY: 22,
    EOR: 23,
    INC: 24,
    INX: 25,
    INY: 26,
    JMP: 27,
    JSR: 28,
    LDA: 29,
    LDX: 30,
    LDY: 31,
    LSR: 32,
    NOP: 33,
    ORA: 34,
    PHA: 35,
    PHP: 36,
    PLA: 37,
    PLP: 38,
    ROL: 39,
    ROR: 40,
    RTI: 41,
    RTS: 42,
    SBC: 43,
    SEC: 44,
    SED: 45,
    SEI: 46,
    STA: 47,
    STX: 48,
    STY: 49,
    TAX: 50,
    TAY: 51,
    TSX: 52,
    TXA: 53,
    TXS: 54,
    TYA: 55,

    XXX: 99 // Illegal opcodes
};

export const INTERRUPTS = {
    NMI: 0,
    IRQ: 1
};

export const KEYBOARD_KEYS = {
    A: 67,
    B: 88,
    SELECT: 16,
    START: 13,
    UP: 38,
    DOWN: 40,
    LEFT: 37,
    RIGHT: 39
};

export const BUTTONS = {
    A: 0,
    B: 1,
    SELECT: 2,
    START: 3,
    UP: 4,
    DOWN: 5,
    LEFT: 6,
    RIGHT: 7
};

export const COLORS = [
    0x666666,
    0x002a88,
    0x1412a7,
    0x3b00a4,
    0x5c007e,
    0x6e0040,
    0x6c0600,
    0x561d00,
    0x333500,
    0x0b4800,
    0x005200,
    0x004f08,
    0x00404d,
    0x000000,
    0x000000,
    0x000000,
    0xadadad,
    0x155fd9,
    0x4240ff,
    0x7527fe,
    0xa01acc,
    0xb71e7b,
    0xb53120,
    0x994e00,
    0x6b6d00,
    0x388700,
    0x0c9300,
    0x008f32,
    0x007c8d,
    0x000000,
    0x000000,
    0x000000,
    0xfffeff,
    0x64b0ff,
    0x9290ff,
    0xc676ff,
    0xf36aff,
    0xfe6ecc,
    0xfe8170,
    0xea9e22,
    0xbcbe00,
    0x88d800,
    0x5ce430,
    0x45e082,
    0x48cdde,
    0x4f4f4f,
    0x000000,
    0x000000,
    0xfffeff,
    0xc0dfff,
    0xd3d2ff,
    0xe8c8ff,
    0xfbc2ff,
    0xfec4ea,
    0xfeccc5,
    0xf7d8a5,
    0xe4e594,
    0xcfef96,
    0xbdf4ab,
    0xb3f3cc,
    0xb5ebf2,
    0xb8b8b8,
    0x000000,
    0x000000
];

export const CYCLES = {
    ZERO: 0,
    ONE: 1,
    PREFETCH: 2,
    VISIBLE: 3,
    SPRITES: 4,
    COPY_Y: 5,
    COPY_X: 6,
    INCREMENT_Y: 7,
    IDLE: 8,
    FLUSH_TILEDATA: 9,
    MAPPER_TICK: 10
};

export const SCANLINES = {
    PRELINE: 0,
    VISIBLE: 1,
    VBLANK: 2,
    IDLE: 3
};
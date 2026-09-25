export const MIRROR = {
    VERTICAL: 0,
    HORIZONTAL: 1,
    ONESCREEN_LO: 2,
    ONESCREEN_HI: 3,
} as const;

export type Mirror = typeof MIRROR[keyof typeof MIRROR];

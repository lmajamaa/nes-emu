import type { EmulatorSystem } from '../types';
import SnesLogo from './SnesLogo';

// Bits of a controller state, in the order the SNES reads them (B first)
export const Button = {
    B: 0x8000,
    Y: 0x4000,
    Select: 0x2000,
    Start: 0x1000,
    Up: 0x0800,
    Down: 0x0400,
    Left: 0x0200,
    Right: 0x0100,
    A: 0x0080,
    X: 0x0040,
    L: 0x0020,
    R: 0x0010,
} as const;

const snes: EmulatorSystem = {
    id: 'snes',
    name: 'Super Nintendo Entertainment System',
    shortName: 'SNES',
    extensions: ['.sfc', '.smc'],
    Logo: SnesLogo,
    keyMap: {
        KeyX: Button.A,
        KeyZ: Button.B,
        KeyS: Button.X,
        KeyA: Button.Y,
        KeyQ: Button.L,
        KeyW: Button.R,
        ShiftRight: Button.Select,
        Enter: Button.Start,
        ArrowUp: Button.Up,
        ArrowDown: Button.Down,
        ArrowLeft: Button.Left,
        ArrowRight: Button.Right,
    },
    controlsHelp: 'Arrows = D-pad    X = A    Z = B    S = X    A = Y    Q = L    W = R    Right Shift = Select    Enter = Start',
};

export default snes;

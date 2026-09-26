import { PadButton, type EmulatorSystem } from '../types';
import { SnesEmulator } from './emulator';
import SnesLogo from './ui/SnesLogo';

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
    // The standard mapping numbers buttons by position, which is the SNES pad's layout
    padMap: {
        [PadButton.FaceBottom]: Button.B,
        [PadButton.FaceRight]: Button.A,
        [PadButton.FaceLeft]: Button.Y,
        [PadButton.FaceTop]: Button.X,
        [PadButton.LeftShoulder]: Button.L,
        [PadButton.RightShoulder]: Button.R,
        [PadButton.LeftTrigger]: Button.L,
        [PadButton.RightTrigger]: Button.R,
        [PadButton.Select]: Button.Select,
        [PadButton.Start]: Button.Start,
        [PadButton.Up]: Button.Up,
        [PadButton.Down]: Button.Down,
        [PadButton.Left]: Button.Left,
        [PadButton.Right]: Button.Right,
    },
    touchLayout: {
        dpad: { up: Button.Up, down: Button.Down, left: Button.Left, right: Button.Right },
        face: [
            { label: 'X', button: Button.X, position: 'top' },
            { label: 'Y', button: Button.Y, position: 'left' },
            { label: 'A', button: Button.A, position: 'right' },
            { label: 'B', button: Button.B, position: 'bottom' },
        ],
        shoulders: [{ label: 'L', button: Button.L }, { label: 'R', button: Button.R }],
        menu: [{ label: 'Select', button: Button.Select }, { label: 'Start', button: Button.Start }],
    },
    controlsHelp: 'Arrows = D-pad    X = A    Z = B    S = X    A = Y    Q = L    W = R    Right Shift = Select    Enter = Start',
    create: () => new SnesEmulator(),
};

export default snes;

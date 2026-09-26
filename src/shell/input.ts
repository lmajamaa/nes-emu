import { PadButton, type Emulator } from '../systems/types';

export const PLAYERS = 2;

// How far the left stick has to move to press the D-pad
const STICK_THRESHOLD = 0.5;

// The parts of a Gamepad this reads, so tests can make them up
export interface PadState {
    readonly id: string;
    readonly connected: boolean;
    readonly buttons: readonly { readonly pressed: boolean }[];
    readonly axes: readonly number[];
}

// A pad's buttons as a system's controller buttons
export function padButtons(pad: PadState, padMap: Readonly<Record<number, number>>): number {
    let buttons = 0;
    pad.buttons.forEach((button, index) => {
        if (button.pressed) buttons |= padMap[index] ?? 0;
    });
    const [x = 0, y = 0] = pad.axes;
    if (x < -STICK_THRESHOLD) buttons |= padMap[PadButton.Left] ?? 0;
    if (x > STICK_THRESHOLD) buttons |= padMap[PadButton.Right] ?? 0;
    if (y < -STICK_THRESHOLD) buttons |= padMap[PadButton.Up] ?? 0;
    if (y > STICK_THRESHOLD) buttons |= padMap[PadButton.Down] ?? 0;
    return buttons;
}

// The connected pads, one per player, in the order the browser numbers them
export function playerPads(pads: readonly (PadState | null)[]): PadState[] {
    return pads.filter((pad): pad is PadState => pad !== null && pad.connected).slice(0, PLAYERS);
}

// A pad's name without the vendor and product numbers some browsers add
export function padName(pad: PadState): string {
    return pad.id.replace(/\s*\(.*\)\s*$/, '') || 'Gamepad';
}

// Each player's buttons are those held on the keyboard and on their pad together. Only changes
// reach the emulator, so letting go of a key doesn't let go of the same button held on a pad.
export class PlayerInput {
    private readonly keyboard = new Array<number>(PLAYERS).fill(0);
    private readonly pads = new Array<number>(PLAYERS).fill(0);
    private readonly sent = new Array<number>(PLAYERS).fill(0);

    setKey(player: number, button: number, pressed: boolean): void {
        this.keyboard[player] = pressed ? this.keyboard[player]! | button : this.keyboard[player]! & ~button;
    }

    // E.g. when the window loses focus, and the keys are let go of without it hearing
    releaseKeys(): void {
        this.keyboard.fill(0);
    }

    // Buttons per player, missing players have none
    setPads(buttons: readonly number[]): void {
        for (let player = 0; player < PLAYERS; player++) this.pads[player] = buttons[player] ?? 0;
    }

    // A new emulator starts with no buttons held, so everything held is sent again
    forget(): void {
        this.sent.fill(0);
    }

    apply(emulator: Pick<Emulator, 'setButton'>): void {
        for (let player = 0; player < PLAYERS; player++) {
            const buttons = this.keyboard[player]! | this.pads[player]!;
            const changed = buttons ^ this.sent[player]!;
            for (let bit = 1; bit <= changed; bit <<= 1) {
                if (changed & bit) emulator.setButton(player, bit, (buttons & bit) !== 0);
            }
            this.sent[player] = buttons;
        }
    }
}

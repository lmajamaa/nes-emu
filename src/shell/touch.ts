import type { TouchLayout } from '../systems/types';

// Of the D-pad's radius, how far from the middle a thumb has to be to press anything
const DPAD_DEAD_ZONE = 0.2;

// The D-pad's buttons for a thumb at dx, dy from its middle (y down), in eight directions like a
// real D-pad: each direction covers 45 degrees, and the diagonals press two buttons.
export function dpadButtons(dx: number, dy: number, radius: number, dpad: TouchLayout['dpad']): number {
    if (Math.hypot(dx, dy) < radius * DPAD_DEAD_ZONE) return 0;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    let buttons = 0;
    if (Math.abs(angle) < 67.5) buttons |= dpad.right;
    if (Math.abs(angle) > 112.5) buttons |= dpad.left;
    if (angle > 22.5 && angle < 157.5) buttons |= dpad.down;
    if (angle < -22.5 && angle > -157.5) buttons |= dpad.up;
    return buttons;
}

import type { TouchLayout } from '../systems/types';

// Of the D-pad's radius, how far from the middle a thumb has to be to press anything
const DPAD_DEAD_ZONE = 0.2;

// How far from a button a finger can slip and still press it, in CSS pixels
export const BUTTON_SLOP = 24;

// How far a point is from a rectangle, 0 inside it
export function distanceToRect(x: number, y: number, rect: { left: number; top: number; right: number; bottom: number }): number {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    return Math.hypot(dx, dy);
}

// The D-pad's buttons for a thumb at dx, dy from its middle (y down), in eight directions like a
// real D-pad: each direction covers 45 degrees, and the diagonals press two buttons. There's no
// limit to how far out, as a thumb that drifts off the D-pad is still pressing it.
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

import { describe, expect, test } from 'bun:test';
import { Button } from '../systems/nes/core/controller';
import nes from '../systems/nes';
import { dpadButtons } from './touch';

const dpad = nes.touchLayout.dpad;
const at = (degrees: number, distance = 60) =>
    dpadButtons(Math.cos(degrees * Math.PI / 180) * distance, Math.sin(degrees * Math.PI / 180) * distance, 75, dpad);

describe('touch D-pad', () => {
    test('presses the direction the thumb is in, y going down', () => {
        expect(at(0)).toBe(Button.Right);
        expect(at(90)).toBe(Button.Down);
        expect(at(180)).toBe(Button.Left);
        expect(at(-90)).toBe(Button.Up);
    });

    test('presses two buttons on the diagonals', () => {
        expect(at(45)).toBe(Button.Right | Button.Down);
        expect(at(135)).toBe(Button.Left | Button.Down);
        expect(at(-135)).toBe(Button.Left | Button.Up);
        expect(at(-45)).toBe(Button.Right | Button.Up);
    });

    test('each direction covers 45 degrees', () => {
        expect(at(20)).toBe(Button.Right);
        expect(at(25)).toBe(Button.Right | Button.Down);
        expect(at(65)).toBe(Button.Right | Button.Down);
        expect(at(70)).toBe(Button.Down);
    });

    test('nothing near the middle', () => {
        expect(at(0, 10)).toBe(0);
        expect(at(90, 16)).toBe(Button.Down);
    });
});

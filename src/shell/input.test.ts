import { describe, expect, test } from 'bun:test';
import nes, { NesEmulator } from '../systems/nes';
import { Button as NesButton } from '../systems/nes/core/controller';
import snes, { Button as SnesButton } from '../systems/snes';
import { buildRom } from '../systems/snes/core/test-helpers';
import { SnesEmulator } from '../systems/snes/emulator';
import { PadButton } from '../systems/types';
import { padButtons, padName, PlayerInput, playerPads, type PadState } from './input';

// A standard gamepad with these buttons held and the left stick at x, y
function pad(held: number[] = [], [x, y] = [0, 0], id = 'Test pad'): PadState {
    return {
        id,
        connected: true,
        buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: held.includes(index) })),
        axes: [x, y, 0, 0],
    };
}

// Records what reaches the emulator
function recorder() {
    const calls: [player: number, button: number, pressed: boolean][] = [];
    return { calls, setButton: (player: number, button: number, pressed: boolean) => calls.push([player, button, pressed]) };
}

describe('gamepad mapping', () => {
    test('SNES buttons are where they are on a SNES pad', () => {
        const map = snes.padMap;
        expect(padButtons(pad([PadButton.FaceBottom]), map)).toBe(SnesButton.B);
        expect(padButtons(pad([PadButton.FaceRight]), map)).toBe(SnesButton.A);
        expect(padButtons(pad([PadButton.FaceLeft]), map)).toBe(SnesButton.Y);
        expect(padButtons(pad([PadButton.FaceTop]), map)).toBe(SnesButton.X);
        expect(padButtons(pad([PadButton.LeftShoulder, PadButton.RightTrigger]), map)).toBe(SnesButton.L | SnesButton.R);
        expect(padButtons(pad([PadButton.Select, PadButton.Start]), map)).toBe(SnesButton.Select | SnesButton.Start);
        expect(padButtons(pad([PadButton.Up, PadButton.Left]), map)).toBe(SnesButton.Up | SnesButton.Left);
    });

    test('NES B and A are on the SNES pad’s B and A, the other face buttons do nothing', () => {
        const map = nes.padMap;
        expect(padButtons(pad([PadButton.FaceBottom, PadButton.FaceRight]), map)).toBe(NesButton.B | NesButton.A);
        expect(padButtons(pad([PadButton.FaceLeft, PadButton.FaceTop, PadButton.LeftShoulder]), map)).toBe(0);
        expect(padButtons(pad([PadButton.Down, PadButton.Start]), map)).toBe(NesButton.Down | NesButton.Start);
    });

    test('the left stick moves the D-pad past half way', () => {
        const map = nes.padMap;
        expect(padButtons(pad([], [-0.9, 0]), map)).toBe(NesButton.Left);
        expect(padButtons(pad([], [0.7, 0.8]), map)).toBe(NesButton.Right | NesButton.Down);
        expect(padButtons(pad([], [0, -1]), map)).toBe(NesButton.Up);
        expect(padButtons(pad([], [0.3, -0.4]), map)).toBe(0);
    });
});

describe('gamepads and players', () => {
    test('the first two connected pads are players 1 and 2', () => {
        const first = pad([], [0, 0], 'First');
        const second = pad([], [0, 0], 'Second');
        const gone = { ...pad([], [0, 0], 'Gone'), connected: false };
        expect(playerPads([null, first, gone, second, pad()]).map(p => p.id)).toEqual(['First', 'Second']);
        expect(playerPads([])).toEqual([]);
    });

    test('names leave out the vendor and product numbers', () => {
        expect(padName(pad([], [0, 0], 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)'))).toBe('Xbox Wireless Controller');
        expect(padName(pad([], [0, 0], '054c-0ce6-DualSense Wireless Controller'))).toBe('054c-0ce6-DualSense Wireless Controller');
    });
});

describe('player input', () => {
    test('only changes reach the emulator', () => {
        const input = new PlayerInput();
        const emulator = recorder();
        input.setKey(0, 0x80, true);
        input.apply(emulator);
        input.apply(emulator);
        expect(emulator.calls).toEqual([[0, 0x80, true]]);
    });

    test('letting go of a key keeps the same button held on the pad', () => {
        const input = new PlayerInput();
        const emulator = recorder();
        input.setKey(0, 0x80, true);
        input.setPads([0x80]);
        input.apply(emulator);
        input.setKey(0, 0x80, false);
        input.apply(emulator);
        expect(emulator.calls).toEqual([[0, 0x80, true]]);
        input.setPads([]);
        input.apply(emulator);
        expect(emulator.calls).toEqual([[0, 0x80, true], [0, 0x80, false]]);
    });

    test('the second pad plays as player 2, with the SNES’s high bits too', () => {
        const input = new PlayerInput();
        const emulator = recorder();
        input.setPads([0, SnesButton.B | SnesButton.R]);
        input.apply(emulator);
        expect(emulator.calls).toEqual([[1, SnesButton.R, true], [1, SnesButton.B, true]]);
    });

    test('the touch controls are player 1’s, alongside the keyboard', () => {
        const input = new PlayerInput();
        const emulator = recorder();
        input.setKey(0, 0x01, true);
        input.setTouch(0x01 | 0x80);
        input.apply(emulator);
        input.setTouch(0);
        input.apply(emulator);
        expect(emulator.calls).toEqual([[0, 0x01, true], [0, 0x80, true], [0, 0x80, false]]);
    });

    test('keys are let go of when the window loses focus', () => {
        const input = new PlayerInput();
        const emulator = recorder();
        input.setKey(0, 0x01, true);
        input.apply(emulator);
        input.releaseKeys();
        input.apply(emulator);
        expect(emulator.calls.at(-1)).toEqual([0, 0x01, false]);
    });

    test('a new emulator gets the buttons still held', () => {
        const input = new PlayerInput();
        input.setKey(0, 0x10, true);
        input.apply(recorder());
        const next = recorder();
        input.forget();
        input.apply(next);
        expect(next.calls).toEqual([[0, 0x10, true]]);
    });

    test('reach both controller ports of the NES and the SNES', () => {
        const input = new PlayerInput();
        input.setKey(0, NesButton.Start, true);
        input.setPads([0, NesButton.A]);
        const nesEmulator = new NesEmulator();
        input.apply(nesEmulator);
        expect([...nesEmulator.bus.controller]).toEqual([NesButton.Start, NesButton.A]);

        const snesInput = new PlayerInput();
        snesInput.setPads([SnesButton.Y, SnesButton.L]);
        const snesEmulator = new SnesEmulator();
        snesEmulator.load(buildRom().buffer as ArrayBuffer);
        snesInput.apply(snesEmulator);
        expect(snesEmulator.snes!.bus.io.controllers.map(controller => controller.buttons)).toEqual([SnesButton.Y, SnesButton.L]);
    });
});

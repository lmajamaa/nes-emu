import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import nes from '../../src/systems/nes';
import snes, { Button } from '../../src/systems/snes';
import { SnesEmulator } from '../../src/systems/snes/emulator';
import Resampler from '../../src/systems/snes/resampler';
import { unpackBundle } from './bundle';
import { buildRom } from './helpers';
import { KROM_BUNDLE } from './krom-cases';

const helloWorld = unpackBundle(readFileSync(KROM_BUNDLE)).get('HelloWorld/HelloWorld.sfc')!;

function loaded(): SnesEmulator {
    const emulator = snes.create!() as SnesEmulator;
    emulator.load(helloWorld.slice().buffer);
    return emulator;
}

// What the shell passes to drawFrame, without a DOM
function imageData(width: number, height: number): ImageData {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
}

describe('SNES emulator adapter', () => {
    test('is available in the console menu', () => {
        expect(snes.create).toBeDefined();
    });

    test('runs a game and draws its frames 512 wide', () => {
        const emulator = loaded();
        for (let i = 0; i < 30; i++) emulator.runFrame();
        expect([emulator.width, emulator.height]).toEqual([512, 224]);
        const image = imageData(emulator.width, emulator.height);
        emulator.drawFrame(image);
        const pixels = new Uint32Array(image.data.buffer);
        expect(new Set(pixels).size).toBeGreaterThan(1);
        expect(pixels[0] >>> 24).toBe(0xFF);
    });

    test('rejects files that are not SNES ROMs', () => {
        expect(() => loaded().load(new ArrayBuffer(0x1000))).toThrow();
    });

    test('warns about enhancement chips', () => {
        const emulator = new SnesEmulator();
        const result = emulator.load(buildRom({ chipset: 0x15 }).buffer as ArrayBuffer);
        expect(result.warning).toContain('SuperFX');
    });

    test('passes buttons to controller 1, also ones held before loading', () => {
        const emulator = new SnesEmulator();
        emulator.setButton(0, Button.Start, true);
        emulator.load(helloWorld.slice().buffer);
        emulator.setButton(0, Button.A, true);
        expect(emulator.snes!.bus.io.controllers[0].buttons).toBe(Button.Start | Button.A);
        emulator.setButton(0, Button.Start, false);
        expect(emulator.snes!.bus.io.controllers[0].buttons).toBe(Button.A);
    });

    test('makes a frame of stereo sound per frame at the output rate', () => {
        const emulator = loaded();
        emulator.setSampleRate(48000);
        // Its start up clears work RAM with DMAs longer than a frame
        for (let i = 0; i < 10; i++) {
            emulator.runFrame();
            emulator.takeSamples();
        }
        let samples = 0;
        for (let i = 0; i < 60; i++) {
            emulator.runFrame();
            samples += emulator.takeSamples().length / 2;
        }
        expect(Math.abs(samples - 48000 * 60 / emulator.frameRate)).toBeLessThan(10);
    });
});

describe('SNES resampler', () => {
    const stereo = (values: number[]) => Int16Array.from(values.flatMap(v => [v, v]));

    test('keeps the channels apart, scaled to -1 to 1', () => {
        const resampler = new Resampler(1000);
        resampler.setOutputRate(1000);
        const output = resampler.resample(Int16Array.from([16384, 0, -32768, 8192, 0, 0]));
        expect(Array.from(output)).toEqual([0.5, 0, -1, 0.25]);
    });

    test('interpolates between samples when upsampling', () => {
        const resampler = new Resampler(1000);
        resampler.setOutputRate(2000);
        const output = resampler.resample(Int16Array.from([0, 0, 16384, -16384, 0, 0]));
        expect(Array.from(output)).toEqual([0, 0, 0.25, -0.25, 0.5, -0.5, 0.25, -0.25]);
    });

    test('keeps its position across blocks', () => {
        const once = new Resampler(32000);
        once.setOutputRate(48000);
        const whole = once.resample(stereo(Array.from({ length: 64 }, (_, i) => i * 100)));

        const split = new Resampler(32000);
        split.setOutputRate(48000);
        const values = Array.from({ length: 64 }, (_, i) => i * 100);
        const parts = [split.resample(stereo(values.slice(0, 23))), split.resample(stereo(values.slice(23)))];
        const joined = [...parts[0], ...parts[1]];
        expect(joined.length).toBe(whole.length);
        joined.forEach((value, i) => expect(value).toBeCloseTo(whole[i], 6));
    });
});

describe('NES emulator adapter sound', () => {
    test('puts the mono sound in both channels', () => {
        const emulator = nes.create!();
        emulator.load(new Uint8Array(readFileSync(new URL('../data/nestest/nestest.nes', import.meta.url))).buffer);
        emulator.setSampleRate(48000);
        emulator.runFrame();
        emulator.takeSamples();
        emulator.runFrame();
        const samples = emulator.takeSamples();
        expect(samples.length % 2).toBe(0);
        expect(Math.abs(samples.length / 2 - 48000 / emulator.frameRate)).toBeLessThan(2);
        for (let i = 0; i < samples.length; i += 2) expect(samples[i + 1]).toBe(samples[i]);
    });
});

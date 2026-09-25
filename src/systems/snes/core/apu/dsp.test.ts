import { describe, expect, test } from 'bun:test';
import Dsp from './dsp';

describe('SNES DSP', () => {
    // A looping sample at $0300 of one block, every sample at the top of range 12
    function setup(): { ram: Uint8Array; dsp: Dsp } {
        const ram = new Uint8Array(0x10000);
        const dsp = new Dsp(ram);
        dsp.reset();
        // Directory at $0200: sample 0 starts and loops at $0300
        ram.set([0x00, 0x03, 0x00, 0x03], 0x0200);
        ram.set([0xC3, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77, 0x77], 0x0300);
        dsp.write(0x5D, 0x02);
        dsp.write(0x0C, 0x7F);
        dsp.write(0x1C, 0x7F);
        dsp.write(0x6C, 0x20);
        dsp.write(0x00, 0x7F);
        dsp.write(0x01, 0x7F);
        dsp.write(0x03, 0x10);
        // ADSR with the fastest attack, sustain at the top
        dsp.write(0x05, 0x8F);
        dsp.write(0x06, 0xE0);
        return { ram, dsp };
    }

    function run(dsp: Dsp, samples: number): Int16Array {
        for (let i = 0; i < samples; i++) dsp.sample();
        return dsp.takeSamples();
    }

    test('is silent until a voice is keyed on', () => {
        const { dsp } = setup();
        expect(run(dsp, 32).every(sample => sample === 0)).toBe(true);
    });

    test('plays a keyed on voice after a short delay, at full envelope', () => {
        const { dsp } = setup();
        dsp.write(0x4C, 0x01);
        const samples = run(dsp, 64);
        // Stereo: left then right
        expect(samples[0]).toBe(0);
        expect(samples[62]).toBeGreaterThan(20000);
        expect(samples[63]).toBe(samples[62]);
        expect(dsp.read(0x08)).toBe(0x7F);
        expect(dsp.read(0x09)).toBeGreaterThan(0x60);
    });

    test('sets ENDX when a sample reaches its end, and a write clears it', () => {
        const { dsp } = setup();
        dsp.write(0x4C, 0x01);
        run(dsp, 32);
        expect(dsp.read(0x7C) & 1).toBe(1);
        dsp.write(0x7C, 0xFF);
        expect(dsp.read(0x7C)).toBe(0);
    });

    test('key off releases the envelope', () => {
        const { dsp } = setup();
        dsp.write(0x4C, 0x01);
        run(dsp, 32);
        dsp.write(0x5C, 0x01);
        run(dsp, 32);
        const envelope = dsp.read(0x08);
        expect(envelope).toBeLessThan(0x7F);
        expect(envelope).toBeGreaterThan(0x40);
        run(dsp, 400);
        expect(dsp.read(0x08)).toBe(0);
    });

    test('a block with the end flag and no loop flag is silenced', () => {
        const { ram, dsp } = setup();
        ram[0x0300] = 0xC1;
        dsp.write(0x4C, 0x01);
        const samples = run(dsp, 64);
        expect(samples.every(sample => sample === 0)).toBe(true);
    });

    test('GAIN sets the envelope directly', () => {
        const { dsp } = setup();
        dsp.write(0x05, 0x00);
        dsp.write(0x07, 0x40);
        dsp.write(0x4C, 0x01);
        run(dsp, 32);
        expect(dsp.read(0x08)).toBe(0x40);
    });

    test('noise replaces the sample', () => {
        const { dsp } = setup();
        dsp.write(0x3D, 0x01);
        dsp.write(0x6C, 0x3F);
        dsp.write(0x4C, 0x01);
        const samples = run(dsp, 200).filter((_, i) => i % 2 === 0).slice(10);
        expect(samples.some(sample => sample > 0)).toBe(true);
        expect(samples.some(sample => sample < 0)).toBe(true);
    });

    test('mute silences the output', () => {
        const { dsp } = setup();
        dsp.write(0x6C, 0x60);
        dsp.write(0x4C, 0x01);
        expect(run(dsp, 64).every(sample => sample === 0)).toBe(true);
    });

    test('echo writes the voices into the echo buffer', () => {
        const { ram, dsp } = setup();
        dsp.write(0x4D, 0x01);
        dsp.write(0x6D, 0x80);
        dsp.write(0x7D, 0x01);
        dsp.write(0x6C, 0x00);
        dsp.write(0x4C, 0x01);
        run(dsp, 64);
        const buffer = ram.subarray(0x8000, 0x8000 + 256);
        expect(buffer.some(byte => byte !== 0)).toBe(true);
    });
});

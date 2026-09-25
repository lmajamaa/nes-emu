import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import nes, { NesEmulator } from '.';
import { buildRom, muteConsole, NESTEST_ROM } from './core/test-helpers';

beforeAll(muteConsole);

// LDA #$42 ; STA $6000 ; JMP *
function program(): Uint8Array {
    const prg = new Uint8Array(0x4000);
    prg.set([0xA9, 0x42, 0x8D, 0x00, 0x60, 0x4C, 0x05, 0x80]);
    prg.set([0x00, 0x80], 0x3FFC); // Reset vector: $8000
    return prg;
}

const rom = (battery = true) => buildRom({ prg: program(), battery }).buffer as ArrayBuffer;

describe('NES save RAM', () => {
    test('games without a battery have nothing to save', () => {
        const emulator = new NesEmulator();
        emulator.load(rom(false));
        expect(emulator.saveId).toBeNull();
    });

    test('is identified by the ROM, not the header', () => {
        const a = new NesEmulator();
        a.load(rom());
        const b = new NesEmulator();
        const other = new Uint8Array(rom());
        other[15] = 0xFF; // Junk in the unused header bytes, as some dumps have
        b.load(other.buffer);
        expect(a.saveId).toMatch(/^nes-[0-9a-f]{8}$/);
        expect(b.saveId).toBe(a.saveId);
    });

    test('is taken once after the game writes it', () => {
        const emulator = new NesEmulator();
        emulator.load(rom());
        expect(emulator.takeSave()).toBeNull();
        emulator.runFrame();
        const save = emulator.takeSave();
        expect(save?.length).toBe(0x2000);
        expect(save?.[0]).toBe(0x42);
        expect(emulator.takeSave()).toBeNull();
    });

    test('rewriting the same value is not a change', () => {
        const emulator = new NesEmulator();
        emulator.load(rom());
        emulator.runFrame();
        emulator.takeSave();
        // The game keeps running but $6000 already holds $42
        emulator.reset();
        emulator.runFrame();
        expect(emulator.takeSave()).toBeNull();
    });

    test('is restored into the cartridge and survives a reset', () => {
        const emulator = new NesEmulator();
        emulator.load(buildRom({ battery: true }).buffer as ArrayBuffer);
        emulator.loadSave(new Uint8Array(0x2000).fill(0x5A));
        expect(emulator.bus.cpuRead(0x6123, true)).toBe(0x5A);
        expect(emulator.takeSave()).toBeNull();
        emulator.reset();
        expect(emulator.bus.cpuRead(0x7FFF, true)).toBe(0x5A);
    });
});

describe('NES emulator adapter sound', () => {
    test('puts the mono sound in both channels', () => {
        const emulator = nes.create!();
        emulator.load(new Uint8Array(readFileSync(NESTEST_ROM)).buffer);
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

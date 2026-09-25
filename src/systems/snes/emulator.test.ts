import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import snes, { Button } from '.';
import SnesBus from './core/bus';
import SnesCartridge from './core/cartridge';
import Snes from './core/snes';
import { unpackBundle } from './core/test-bundle';
import { buildRom } from './core/test-helpers';
import { KROM_BUNDLE } from './core/test-krom-cases';
import { SnesEmulator } from './emulator';

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

describe('SNES debugging hooks', () => {
    test('peeking reads memory without touching I/O', () => {
        const bus = new SnesBus();
        bus.reset();
        bus.wram[0x10] = 0x42;
        expect(bus.peek(0x7E0010)).toBe(0x42);
        const before = bus.cycles;
        expect(bus.peek(0x002139)).toBe(0);
        expect(bus.peek(0x004210)).toBe(0);
        expect(bus.cycles).toBe(before);
    });

    test('remembers the last instructions run', () => {
        // NOP NOP NOP BRA *
        const rom = buildRom({ patches: { 0: [0xEA, 0xEA, 0xEA, 0x80, 0xFE] } });
        const snes = new Snes(new SnesCartridge(rom.buffer as ArrayBuffer));
        snes.reset();
        for (let i = 0; i < 6; i++) snes.step();
        expect(snes.recentInstructions()).toEqual([0x8000, 0x8001, 0x8002, 0x8003]);
    });

    test('C steps one instruction', () => {
        const emulator = new SnesEmulator();
        emulator.load(buildRom({ patches: { 0: [0xEA, 0xEA] } }).buffer as ArrayBuffer);
        expect(emulator.handleDebugKey('KeyC')).toBe(true);
        expect(emulator.snes!.cpu.pc).toBe(0x8001);
        expect(emulator.handleDebugKey('KeyP')).toBe(false);
    });
});

describe('SNES save RAM', () => {
    // LoROM with 8 KB of battery-backed SRAM: STA $700000 ; BRA *
    const rom = () => buildRom({ chipset: 0x02, sramByte: 0x03, patches: { 0: [0xA9, 0x42, 0x8F, 0x00, 0x00, 0x70, 0x80, 0xFE] } }).buffer as ArrayBuffer;

    test('games without a battery have nothing to save', () => {
        const emulator = new SnesEmulator();
        emulator.load(buildRom().buffer as ArrayBuffer);
        expect(emulator.saveId).toBeNull();
    });

    test('is identified by the ROM', () => {
        const a = new SnesEmulator();
        a.load(rom());
        const b = new SnesEmulator();
        b.load(rom());
        expect(a.saveId).toMatch(/^snes-[0-9a-f]{8}$/);
        expect(b.saveId).toBe(a.saveId);
    });

    test('is taken once after the game writes it', () => {
        const emulator = new SnesEmulator();
        emulator.load(rom());
        expect(emulator.takeSave()).toBeNull();
        emulator.runFrame();
        const save = emulator.takeSave();
        expect(save?.length).toBe(0x2000);
        expect(save?.[0]).toBe(0x42);
        expect(emulator.takeSave()).toBeNull();
    });

    test('is restored into the cartridge', () => {
        const emulator = new SnesEmulator();
        emulator.load(buildRom({ chipset: 0x02, sramByte: 0x03 }).buffer as ArrayBuffer);
        const save = new Uint8Array(0x2000).fill(0x5A);
        emulator.loadSave(save);
        expect(emulator.snes!.bus.peek(0x700123)).toBe(0x5A);
        expect(emulator.takeSave()).toBeNull();
    });
});

import { describe, expect, test } from 'bun:test';
import SnesCartridge from '../../src/systems/snes/core/cartridge';
import CpuIo, { CYCLES_PER_LINE, LINES_PER_FRAME_PAL } from '../../src/systems/snes/core/io';
import Snes from '../../src/systems/snes/core/snes';
import { SnesEmulator } from '../../src/systems/snes/emulator';
import { buildRom } from './helpers';

const cartridge = (region: number) => new SnesCartridge(buildRom({ region }).buffer as ArrayBuffer);

describe('SNES PAL consoles', () => {
    test('the cartridge region says whether a game is PAL', () => {
        // Japan, USA, Korea, Canada and Brazil are NTSC
        for (const region of [0x00, 0x01, 0x0D, 0x0F, 0x10]) expect(cartridge(region).header.pal).toBe(false);
        // Europe's countries, Hong Kong, Indonesia and Australia are PAL
        for (const region of [0x02, 0x03, 0x06, 0x09, 0x0B, 0x0C, 0x11]) expect(cartridge(region).header.pal).toBe(true);
    });

    test('a frame is 312 lines', () => {
        const io = new CpuIo();
        io.pal = true;
        let cycles = 0;
        while (io.frame === 0) cycles += io.advance(8);
        expect(cycles).toBeGreaterThanOrEqual(CYCLES_PER_LINE * LINES_PER_FRAME_PAL);
        expect(cycles).toBeLessThan(CYCLES_PER_LINE * LINES_PER_FRAME_PAL + 8);
    });

    test('vblank still starts at line 225, so it is longer', () => {
        const io = new CpuIo();
        io.pal = true;
        const toLine = (line: number) => {
            while (io.v !== line) io.advance(8);
        };
        toLine(225);
        expect(io.vblank).toBe(true);
        toLine(300);
        expect(io.vblank).toBe(true);
    });

    test('the console takes the region of the cartridge, and STAT78 bit 4 reports it', () => {
        const pal = new Snes(cartridge(0x02));
        pal.reset();
        expect(pal.pal).toBe(true);
        expect(pal.bus.ppu.read(0x3F) & 0x10).toBe(0x10);

        const ntsc = new Snes(cartridge(0x01));
        ntsc.reset();
        expect(ntsc.pal).toBe(false);
        expect(ntsc.bus.ppu.read(0x3F) & 0x10).toBe(0);
    });

    test('runs at 50 frames a second', () => {
        const emulator = new SnesEmulator();
        emulator.load(buildRom({ region: 0x02 }).buffer as ArrayBuffer);
        expect(emulator.frameRate).toBeCloseTo(50.007, 3);
        emulator.load(buildRom({ region: 0x01 }).buffer as ArrayBuffer);
        expect(emulator.frameRate).toBeCloseTo(60.10, 2);
    });

    test('the APU keeps its own speed on the slower master clock', () => {
        // The DSP makes 32040 samples a second on both
        for (const region of [0x01, 0x02]) {
            const emulator = new SnesEmulator();
            emulator.load(buildRom({ region, patches: { 0: [0x80, 0xFE] } }).buffer as ArrayBuffer);
            emulator.setSampleRate(32040);
            let frames = 0;
            let samples = 0;
            for (; frames < Math.round(emulator.frameRate); frames++) {
                emulator.runFrame();
                samples += emulator.takeSamples().length / 2;
            }
            expect(Math.abs(samples - 32040)).toBeLessThan(700);
        }
    });
});

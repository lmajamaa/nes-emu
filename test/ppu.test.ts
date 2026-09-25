// Boots nestest.nes on the full system (CPU + PPU) and checks that the menu is
// rendered: every pixel on screen must match the pattern of the tile that the
// nametable holds at that position.

import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import Bus from '../src/nes/bus';
import Cartridge from '../src/nes/cartridge';
import { buildRom, muteConsole, NESTEST_ROM as ROM } from './helpers';

const FRAMES = 10;

describe('PPU background rendering (nestest.nes menu)', () => {
    let bus: Bus;

    beforeAll(() => {
        muteConsole();
        bus = new Bus();
        bus.insertCartridge(new Cartridge(readFileSync(ROM)));
        bus.reset();
        for (let frame = 0; frame < FRAMES; frame++) {
            do { bus.clock(); } while (!bus.ppu.frameComplete);
            bus.ppu.frameComplete = false;
        }
    });

    test('menu text is in the nametable', () => {
        const nametable = bus.ppu.nametables[0];
        const row = String.fromCharCode(...nametable.subarray(4 * 32, 5 * 32));
        expect(row).toContain('Run all tests');
    });

    test('rendering is enabled', () => {
        expect(bus.ppu.mask.renderBackground).toBe(1);
    });

    test('screen matches the nametable tiles', () => {
        const ppu = bus.ppu;
        const screen = ppu.screen;
        const backdrop = ppu.colorOf(0, 0);
        const patternBase = ppu.control.patternBackground << 12;

        const mismatches = [];
        for (let row = 0; row < 30; row++) {
            for (let col = 0; col < 32; col++) {
                const tile = ppu.nametables[0][row * 32 + col];
                for (let y = 0; y < 8; y++) {
                    const lsb = ppu.ppuRead(patternBase + tile * 16 + y);
                    const msb = ppu.ppuRead(patternBase + tile * 16 + y + 8);
                    for (let x = 0; x < 8; x++) {
                        const pixel = (((msb >> (7 - x)) & 1) << 1) | ((lsb >> (7 - x)) & 1);
                        const isBackdrop = screen.getPixel(col * 8 + x, row * 8 + y) === backdrop;
                        if ((pixel === 0) !== isBackdrop) {
                            mismatches.push(`tile (${col}, ${row}) pixel (${x}, ${y})`);
                        }
                    }
                }
            }
        }
        expect(mismatches.slice(0, 5)).toEqual([]);
    });
});

describe('palette RAM', () => {
    // Games like Bubble Bobble write $FF and rely on it being stored as $3F (black)
    test('is only 6 bits wide', () => {
        const bus = new Bus();
        bus.insertCartridge(new Cartridge(buildRom()));
        bus.ppu.ppuWrite(0x3F00, 0xFF);
        bus.ppu.ppuWrite(0x3F11, 0xC1);

        expect(bus.ppu.ppuRead(0x3F00)).toBe(0x3F);
        expect(bus.ppu.ppuRead(0x3F11)).toBe(0x01);
        expect(bus.ppu.colorOf(0, 0)).toBe(0x3F);
    });
});

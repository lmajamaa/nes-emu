// Boots nestest.nes on the full system (CPU + PPU) and checks that the menu is
// rendered: every pixel on screen must match the pattern of the tile that the
// nametable holds at that position.

import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import Bus from '../src/nes/bus';
import Cartridge from '../src/nes/cartridge';
import { muteConsole, NESTEST_ROM as ROM } from './helpers';

const FRAMES = 10;

describe('PPU background rendering (nestest.nes menu)', () => {
    let bus: Bus;

    beforeAll(() => {
        muteConsole();
        bus = new Bus();
        bus.insertCartridge(new Cartridge(readFileSync(ROM)));
        bus.reset();
        for (let frame = 0; frame < FRAMES; frame++) {
            do { bus.clock(); } while (!bus.ppu.frame_complete);
            bus.ppu.frame_complete = false;
        }
    });

    test('menu text is in the nametable', () => {
        const nametable = bus.ppu.tblName[0];
        const row = nametable.slice(4 * 32, 5 * 32).map(c => String.fromCharCode(c)).join('');
        expect(row).toContain('Run all tests');
    });

    test('rendering is enabled', () => {
        expect(bus.ppu.mask.render_background).toBe(1);
    });

    test('screen matches the nametable tiles', () => {
        const ppu = bus.ppu;
        const screen = ppu.getScreen();
        const backdrop = ppu.getColorFromPaletteRam(0, 0);
        const patternBase = ppu.control.pattern_background << 12;

        const mismatches = [];
        for (let row = 0; row < 30; row++) {
            for (let col = 0; col < 32; col++) {
                const tile = ppu.tblName[0][row * 32 + col];
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

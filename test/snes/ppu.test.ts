import { beforeEach, describe, expect, test } from 'bun:test';
import Ppu, { FRAME_WIDTH, type PpuTiming } from '../../src/systems/snes/core/ppu';

// Colors are 15-bit BGR
const RED = 0x001F;
const GREEN = 0x03E0;
const BLUE = 0x7C00;
const WHITE = 0x7FFF;
const GRAY = 0x4210;

class Timing implements PpuTiming {
    h = 0;
    v = 0;
    vblank = true;
    overscan = false;
    interlace = false;
    field = 0;
    pal = false;
}

let timing: Timing;
let ppu: Ppu;

// Full brightness RGBA, as the frame holds it
function rgba(color: number): number {
    const expand = (c: number) => (c << 3) | (c >> 2);
    return (0xFF000000 | (expand((color >> 10) & 31) << 16) | (expand((color >> 5) & 31) << 8) | expand(color & 31)) >>> 0;
}

function write(addr: number, ...data: number[]): void {
    for (const byte of data) ppu.write(addr, byte);
}

function writeVram(address: number, words: number[]): void {
    write(0x15, 0x80);
    write(0x16, address & 0xFF);
    write(0x17, address >> 8);
    for (const word of words) write(0x18, word & 0xFF), write(0x19, word >> 8);
}

function writeCgram(index: number, colors: number[]): void {
    write(0x21, index);
    for (const color of colors) write(0x22, color & 0xFF, color >> 8);
}

// Bitplane words of a tile, from its rows of color indices
function encodeTile(rows: number[][], bpp: number): number[] {
    const words = new Array(bpp * 4).fill(0);
    rows.forEach((row, y) => row.forEach((color, x) => {
        for (let plane = 0; plane < bpp; plane++) {
            if (!(color & (1 << plane))) continue;
            const word = (plane >> 1) * 8 + y;
            words[word] |= (0x80 >> x) << ((plane & 1) * 8);
        }
    }));
    return words;
}

const solid = (color: number) => Array.from({ length: 8 }, () => new Array(8).fill(color));
// Each row a different color index: row y has color y + 1
const striped = () => Array.from({ length: 8 }, (_, y) => new Array(8).fill(y + 1));
// Each column a different color index: column x has color x + 1
const columns = () => Array.from({ length: 8 }, () => Array.from({ length: 8 }, (_, x) => x + 1));

// All 512 pixels of a line, the sub screen in the even columns and the main screen in the odd ones
function hiresLine(v: number): number[] {
    ppu.renderLine(v);
    return Array.from(ppu.frame.subarray((v - 1) * FRAME_WIDTH, v * FRAME_WIDTH), pixel => pixel >>> 0);
}

// The main screen's 256 pixels of a line
function line(v: number): number[] {
    return hiresLine(v).filter((_, x) => x & 1);
}

// Mode 1 with BG1's map at $1000 and tiles at $2000, BG2's map at $1400 and tiles at $3000
function setupMode1(): void {
    write(0x05, 0x01);
    write(0x07, 0x10);
    write(0x08, 0x14);
    write(0x0B, 0x32);
    write(0x2C, 0x03);
}

beforeEach(() => {
    timing = new Timing();
    ppu = new Ppu(timing);
    ppu.reset();
    // Screen on at full brightness
    write(0x00, 0x0F);
});

describe('SNES PPU registers', () => {
    test('VRAM is written a word at a time, incrementing after the high byte', () => {
        writeVram(0x1234, [0xBEEF, 0xCAFE]);
        expect(ppu.vram[0x1234]).toBe(0xBEEF);
        expect(ppu.vram[0x1235]).toBe(0xCAFE);
    });

    test('VRAM increments by 32 or 128', () => {
        write(0x15, 0x81);
        write(0x16, 0x00);
        write(0x17, 0x00);
        write(0x18, 0x11); write(0x19, 0x11);
        write(0x18, 0x22); write(0x19, 0x22);
        expect(ppu.vram[0]).toBe(0x1111);
        expect(ppu.vram[32]).toBe(0x2222);
    });

    test('VRAM address remapping lays out rows of 8 words as tiles', () => {
        // Mode 1: aaaaaaaaYYYxxxxx becomes aaaaaaaaxxxxxYYY
        write(0x15, 0x84);
        write(0x16, 0x21);
        write(0x17, 0x00);
        write(0x18, 0x34); write(0x19, 0x12);
        expect(ppu.vram[(1 << 3) | 1]).toBe(0x1234);
    });

    test('VRAM reads go through a prefetch latch, so the first word comes twice', () => {
        writeVram(0x0400, [0x1111, 0x2222]);
        write(0x15, 0x80);
        write(0x16, 0x00);
        write(0x17, 0x04);
        const words = Array.from({ length: 3 }, () => ppu.read(0x39) | (ppu.read(0x3A) << 8));
        expect(words).toEqual([0x1111, 0x1111, 0x2222]);
    });

    test('VRAM writes are ignored while the screen is drawn', () => {
        timing.vblank = false;
        writeVram(0x0100, [0x5555]);
        expect(ppu.vram[0x0100]).toBe(0);
        // Force blank allows them again
        write(0x00, 0x80);
        writeVram(0x0100, [0x5555]);
        expect(ppu.vram[0x0100]).toBe(0x5555);
    });

    test('CGRAM takes a low and a high byte per color', () => {
        writeCgram(5, [0x7FFF, 0x1234]);
        expect(ppu.cgram[5]).toBe(0x7FFF);
        expect(ppu.cgram[6]).toBe(0x1234);
        write(0x21, 6);
        expect([ppu.read(0x3B), ppu.read(0x3B)]).toEqual([0x34, 0x12]);
    });

    test('OAM low table is written in pairs, the high table directly', () => {
        write(0x02, 0x00);
        write(0x03, 0x00);
        write(0x04, 0x11);
        expect(ppu.oam[0]).toBe(0);
        write(0x04, 0x22);
        expect([ppu.oam[0], ppu.oam[1]]).toEqual([0x11, 0x22]);
        write(0x02, 0x00);
        write(0x03, 0x01);
        write(0x04, 0x33);
        expect(ppu.oam[0x200]).toBe(0x33);
        write(0x02, 0x00);
        write(0x03, 0x00);
        expect([ppu.read(0x38), ppu.read(0x38)]).toEqual([0x11, 0x22]);
    });

    test('scroll registers are written twice through a shared latch', () => {
        write(0x0D, 0x34, 0x01);
        expect(ppu.bgHOffset[0]).toBe(0x134);
        write(0x0E, 0xFF, 0x03);
        expect(ppu.bgVOffset[0]).toBe(0x3FF);
        // The low 3 bits of a horizontal offset come from the last horizontal write
        write(0x0F, 0xFF, 0x00);
        expect(ppu.bgHOffset[1]).toBe(0x0FF);
    });

    test('mode 7 multiplication result', () => {
        write(0x1B, 0x00, 0x01);
        write(0x1C, 0x00, 0xFE);
        // $0100 * -2
        expect([ppu.read(0x34), ppu.read(0x35), ppu.read(0x36)]).toEqual([0x00, 0xFE, 0xFF]);
    });

    test('latched H/V counters are read low byte first', () => {
        timing.h = 400;
        timing.v = 260;
        ppu.latchCounters();
        expect([ppu.read(0x3C), ppu.read(0x3C) & 1]).toEqual([100, 0]);
        expect([ppu.read(0x3D), ppu.read(0x3D) & 1]).toEqual([4, 1]);
        expect(ppu.read(0x3F) & 0x40).toBe(0x40);
        expect(ppu.read(0x3F) & 0x40).toBe(0);
    });
});

describe('SNES PPU backgrounds', () => {
    beforeEach(setupMode1);

    test('shows the backdrop where nothing is drawn', () => {
        writeCgram(0, [GRAY]);
        expect(new Set(line(10))).toEqual(new Set([rgba(GRAY)]));
    });

    test('draws a 4bpp tile with its palette, line v showing row v + VOFS', () => {
        writeVram(0x2000 + 16, encodeTile(striped(), 4));
        // Tile 1, palette 2
        writeVram(0x1000, [0x0801]);
        writeCgram(32, [0, RED, GREEN, BLUE, WHITE]);
        expect(line(1).slice(0, 9)).toEqual([...new Array(8).fill(rgba(GREEN)), rgba(0)]);
        write(0x0E, 0x02, 0x00);
        expect(line(1)[0]).toBe(rgba(WHITE));
    });

    test('scrolls horizontally', () => {
        writeVram(0x2000 + 16, encodeTile(columns(), 4));
        writeVram(0x1000, [0x0001]);
        writeCgram(0, [0, RED, GREEN, BLUE, WHITE]);
        write(0x0D, 0x02, 0x00);
        expect(line(1).slice(0, 2)).toEqual([rgba(BLUE), rgba(WHITE)]);
    });

    test('flips tiles', () => {
        writeVram(0x2000 + 16, encodeTile(columns(), 4));
        // H flip, V flip
        writeVram(0x1000, [0x4001, 0x8001]);
        writeCgram(0, [0, RED, 0, 0, 0, 0, 0, 0, GREEN]);
        const pixels = line(1);
        expect(pixels[0]).toBe(rgba(GREEN));
        expect(pixels[7]).toBe(rgba(RED));
        expect(pixels[8]).toBe(rgba(RED));
    });

    test('16x16 tiles use the tiles to the right and below', () => {
        write(0x05, 0x11);
        writeVram(0x2000 + 16 * 1, encodeTile(solid(1), 4));
        writeVram(0x2000 + 16 * 2, encodeTile(solid(2), 4));
        writeVram(0x2000 + 16 * 17, encodeTile(solid(3), 4));
        writeVram(0x2000 + 16 * 18, encodeTile(solid(4), 4));
        writeVram(0x1000, [0x0001]);
        writeCgram(0, [0, RED, GREEN, BLUE, WHITE]);
        expect([line(1)[0], line(1)[8]]).toEqual([rgba(RED), rgba(GREEN)]);
        expect([line(9)[0], line(9)[8]]).toEqual([rgba(BLUE), rgba(WHITE)]);
    });

    test('a 64-tile wide map continues in the second screen', () => {
        write(0x07, 0x11);
        writeVram(0x2000 + 16, encodeTile(solid(1), 4));
        writeVram(0x1400, [0x0001]);
        writeCgram(0, [0, RED]);
        write(0x0D, 0x00, 0x01);
        expect(line(1)[0]).toBe(rgba(RED));
    });

    test('BG2 high priority tiles are in front of BG1 low priority ones', () => {
        writeVram(0x2000 + 16, encodeTile(solid(1), 4));
        writeVram(0x3000 + 16, encodeTile(solid(2), 4));
        writeCgram(0, [0, RED, GREEN]);
        writeVram(0x1000, [0x0001]);
        writeVram(0x1400, [0x0001]);
        expect(line(1)[0]).toBe(rgba(RED));
        writeVram(0x1400, [0x2001]);
        expect(line(1)[0]).toBe(rgba(GREEN));
    });

    test('mode 1 BG3 priority brings its high tiles to the front', () => {
        write(0x05, 0x09);
        write(0x09, 0x18);
        write(0x0C, 0x04);
        write(0x2C, 0x05);
        writeVram(0x2000 + 16, encodeTile(solid(1), 4));
        writeVram(0x4000 + 8, encodeTile(solid(2), 2));
        writeVram(0x1000, [0x2001]);
        writeVram(0x1800, [0x2001]);
        writeCgram(0, [0, RED, GREEN]);
        expect(line(1)[0]).toBe(rgba(GREEN));
        write(0x05, 0x01);
        expect(line(1)[0]).toBe(rgba(RED));
    });

    test('mosaic repeats the first pixel of each block', () => {
        writeVram(0x2000 + 16, encodeTile(columns(), 4));
        writeVram(0x1000, [0x0001]);
        writeCgram(0, [0, RED, GREEN, BLUE, WHITE, GRAY]);
        write(0x06, 0x31);
        expect(line(1).slice(0, 5)).toEqual([rgba(RED), rgba(RED), rgba(RED), rgba(RED), rgba(GRAY)]);
    });

    test('direct color shows 8bpp pixels as colors', () => {
        write(0x05, 0x03);
        write(0x30, 0x01);
        write(0x2C, 0x01);
        // Color $07: red at 7 of 8, plus the palette's red bit
        writeVram(0x2000 + 32, encodeTile(solid(0x07), 8));
        writeVram(0x1000, [0x0401]);
        expect(line(1)[0]).toBe(rgba(0x001E));
    });

    test('offset-per-tile scrolls each column from BG3 map entries', () => {
        write(0x05, 0x02);
        write(0x09, 0x18);
        write(0x2C, 0x01);
        writeVram(0x2000 + 16, encodeTile(solid(1), 4));
        writeVram(0x2000 + 32, encodeTile(solid(2), 4));
        // BG1 map: tile 1, then tile 2 at column 2
        writeVram(0x1000, [0x0001, 0x0001, 0x0002]);
        // BG3 entry for screen column 1: horizontal offset 8, valid for BG1
        writeVram(0x1800, [0x2008]);
        writeCgram(0, [0, RED, GREEN]);
        const pixels = line(1);
        expect(pixels[0]).toBe(rgba(RED));
        expect(pixels[8]).toBe(rgba(GREEN));
    });
});

describe('SNES PPU sprites', () => {
    // Sprite tiles at $6000, 8x8 and 16x16
    function setupObjects(): void {
        write(0x01, 0x03);
        write(0x2C, 0x10);
        writeVram(0x6000 + 16, encodeTile(columns(), 4));
        writeCgram(128, [0, RED, GREEN, BLUE, WHITE, GRAY, 0x0011, 0x0022, 0x0033]);
    }

    function writeObject(index: number, x: number, y: number, tile: number, attributes: number, large = false): void {
        write(0x02, index * 2 & 0xFF);
        write(0x03, (index * 2) >> 8);
        write(0x04, x & 0xFF, y, tile, attributes);
        const highIndex = 0x100 + (index >> 3);
        write(0x02, highIndex & 0xFF);
        write(0x03, highIndex >> 8);
        const shift = (index & 3) * 2;
        const current = ppu.oam[0x200 + (index >> 2)] & ~(3 << shift);
        write(0x04, current | ((x >> 8) & 1) << shift | (large ? 2 : 0) << shift);
    }

    // All sprites off screen, below the visible lines
    function hideObjects(): void {
        for (let i = 0; i < 128; i++) writeObject(i, 0, 240, 0, 0);
    }

    beforeEach(() => {
        setupObjects();
        hideObjects();
    });

    test('are drawn from their top line down', () => {
        writeObject(0, 10, 20, 1, 0x00);
        expect(line(19)[10]).toBe(rgba(0));
        expect(line(20)[10]).toBe(rgba(RED));
        expect(line(27)[17]).toBe(rgba(0x0033));
        expect(line(28)[10]).toBe(rgba(0));
    });

    test('flip horizontally', () => {
        writeObject(0, 0, 10, 1, 0x40);
        const pixels = line(10);
        expect(pixels[0]).toBe(rgba(0x0033));
        expect(pixels[7]).toBe(rgba(RED));
    });

    test('negative X shows the right part of the sprite', () => {
        writeObject(0, 0x1FC, 10, 1, 0x00);
        expect(line(10).slice(0, 5)).toEqual([rgba(GRAY), rgba(0x0011), rgba(0x0022), rgba(0x0033), rgba(0)]);
    });

    test('lower OAM indexes are in front', () => {
        writeVram(0x6000 + 32, encodeTile(solid(2), 4));
        writeObject(0, 0, 10, 1, 0x00);
        writeObject(1, 0, 10, 2, 0x00);
        expect(line(10)[0]).toBe(rgba(RED));
    });

    test('large sprites take tiles to the right and below', () => {
        writeVram(0x6000 + 16 * 17, encodeTile(solid(3), 4));
        writeObject(0, 0, 10, 1, 0x00, true);
        expect(line(18)[0]).toBe(rgba(BLUE));
    });

    test('priority places them between background layers', () => {
        setupMode1();
        write(0x2C, 0x11);
        writeVram(0x2000 + 16, encodeTile(solid(4), 4));
        writeCgram(4, [WHITE]);
        writeVram(0x1000, [0x2001]);
        writeObject(0, 0, 1, 1, 0x20);
        expect(line(1)[0]).toBe(rgba(WHITE));
        writeObject(0, 0, 1, 1, 0x30);
        expect(line(1)[0]).toBe(rgba(RED));
    });

    test('only 32 fit on a line, and range over is flagged', () => {
        for (let i = 0; i < 32; i++) writeObject(i, 0, 50, 1, 0x00);
        writeObject(32, 100, 50, 1, 0x00);
        const pixels = line(50);
        expect(pixels[0]).toBe(rgba(RED));
        expect(pixels[100]).toBe(rgba(0));
        expect(ppu.read(0x3E) & 0x40).toBe(0x40);
    });

    test('only 34 tiles fit on a line, and time over is flagged', () => {
        write(0x01, 0x63);
        writeVram(0x6000 + 16 * 2, encodeTile(solid(1), 4));
        // Five 16x32 sprites: 10 tiles wide, ending at x 159
        for (let i = 0; i < 5; i++) writeObject(i, i * 16, 50, 1, 0x00);
        line(50);
        expect(ppu.read(0x3E) & 0x80).toBe(0);
        // 18 sprites, 36 tiles
        for (let i = 0; i < 18; i++) writeObject(i, i * 14, 50, 1, 0x00);
        line(50);
        expect(ppu.read(0x3E) & 0x80).toBe(0x80);
    });
});

describe('SNES PPU screens and effects', () => {
    beforeEach(() => {
        setupMode1();
        writeVram(0x2000 + 16, encodeTile(solid(1), 4));
        writeVram(0x3000 + 16, encodeTile(solid(2), 4));
        writeVram(0x1000, [0x0001]);
        writeVram(0x1400, [0x0001]);
        writeCgram(0, [0, 0x0010, 0x0200]);
        // BG1 on the main screen, BG2 on the sub screen
        write(0x2C, 0x01);
        write(0x2D, 0x02);
    });

    test('adds the sub screen', () => {
        write(0x30, 0x02);
        write(0x31, 0x01);
        expect(line(1)[0]).toBe(rgba(0x0210));
    });

    test('halves the sum', () => {
        write(0x30, 0x02);
        write(0x31, 0x41);
        expect(line(1)[0]).toBe(rgba(0x0108));
    });

    test('subtracts the fixed color, clamping at 0', () => {
        write(0x30, 0x00);
        write(0x31, 0x81);
        write(0x32, 0x20 | 0x04);
        expect(line(1)[0]).toBe(rgba(0x000C));
        write(0x32, 0x20 | 0x1F);
        expect(line(1)[0]).toBe(rgba(0x0000));
    });

    test('a transparent sub screen adds the fixed color without halving', () => {
        write(0x2D, 0x00);
        write(0x30, 0x02);
        write(0x31, 0x41);
        write(0x32, 0x40 | 0x04);
        expect(line(1)[0]).toBe(rgba(0x0090));
    });

    test('the color window can force the main screen black', () => {
        write(0x25, 0x20);
        write(0x26, 0x10);
        write(0x27, 0x20);
        write(0x30, 0x80);
        const pixels = line(1);
        expect(pixels[0]).toBe(rgba(0x0010));
        expect(pixels[0x10]).toBe(rgba(0));
    });

    test('a window hides a layer on the main screen', () => {
        writeVram(0x1000, new Array(32).fill(0x0001));
        writeCgram(0, [GRAY]);
        write(0x23, 0x02);
        write(0x26, 4);
        write(0x27, 7);
        write(0x2E, 0x01);
        const pixels = line(1);
        expect(pixels[3]).toBe(rgba(0x0010));
        expect(pixels.slice(4, 8)).toEqual(new Array(4).fill(rgba(GRAY)));
        expect(pixels[8]).toBe(rgba(0x0010));
    });

    test('brightness scales the output by (1 + level) / 16, level 0 is very dark but not black', () => {
        writeCgram(1, [WHITE]);
        write(0x2D, 0x00);
        write(0x00, 0x07);
        expect(line(1)[0]).toBe(0xFF808080);
        write(0x00, 0x00);
        expect(line(1)[0]).toBe(0xFF040404);
        // Force blank is black
        write(0x00, 0x8F);
        expect(line(1)[0]).toBe(0xFF000000);
    });
});

describe('SNES PPU mode 7', () => {
    // Tile 1 has color 5 everywhere, the map has tile 1 at (0, 0)
    beforeEach(() => {
        write(0x05, 0x07);
        write(0x2C, 0x01);
        write(0x15, 0x00);
        write(0x17, 0x00);
        write(0x18, 0x01);
        write(0x15, 0x80);
        write(0x16, 0x40);
        write(0x17, 0x00);
        for (let i = 0; i < 64; i++) write(0x19, 5);
        writeCgram(0, [GRAY, 0, 0, 0, 0, RED]);
        // Identity matrix
        write(0x1B, 0x00, 0x01);
        write(0x1C, 0x00, 0x00);
        write(0x1D, 0x00, 0x00);
        write(0x1E, 0x00, 0x01);
    });

    test('shows the map through the identity matrix', () => {
        const pixels = line(1);
        expect(pixels.slice(0, 9)).toEqual([...new Array(8).fill(rgba(RED)), rgba(GRAY)]);
    });

    test('scales with the matrix', () => {
        // A = 2: two map pixels per screen pixel
        write(0x1B, 0x00, 0x02);
        const pixels = line(1);
        expect(pixels[3]).toBe(rgba(RED));
        expect(pixels[4]).toBe(rgba(GRAY));
    });

    test('outside the plane repeats it, or is transparent', () => {
        // Tile 1 at the right edge of the map too
        write(0x15, 0x00);
        write(0x16, 0x7F);
        write(0x17, 0x00);
        write(0x18, 0x01);
        // Scrolled 8 pixels left of the plane
        write(0x0D, 0xF8, 0x1F);
        expect(line(1)[0]).toBe(rgba(RED));
        write(0x1A, 0x80);
        expect(line(1)[0]).toBe(rgba(GRAY));
        expect(line(1)[8]).toBe(rgba(RED));
    });
});

describe('SNES PPU hi-res', () => {
    test('other lines draw every pixel twice', () => {
        setupMode1();
        writeVram(0x2000 + 16, encodeTile(columns(), 4));
        writeVram(0x1000, [0x0001]);
        writeCgram(0, [0, RED, GREEN]);
        expect(hiresLine(1).slice(0, 4)).toEqual([rgba(RED), rgba(RED), rgba(GREEN), rgba(GREEN)]);
    });

    test('mode 5 draws backgrounds 512 wide, with 16 pixel wide tiles', () => {
        // BG1 4bpp: tile 1 and the tile right of it make one 16 pixel wide tile
        write(0x05, 0x05);
        write(0x07, 0x10);
        write(0x0B, 0x02);
        write(0x2C, 0x01);
        write(0x2D, 0x01);
        writeVram(0x2000 + 16, encodeTile(columns(), 4));
        writeVram(0x2000 + 32, encodeTile(solid(9), 4));
        writeVram(0x1000, [0x0001]);
        writeCgram(0, [0, RED, GREEN, BLUE, WHITE, GRAY, 0, 0, 0x0011, 0x0022]);
        const pixels = hiresLine(1);
        expect(pixels.slice(0, 4)).toEqual([rgba(RED), rgba(GREEN), rgba(BLUE), rgba(WHITE)]);
        expect(pixels.slice(7, 9)).toEqual([rgba(0x0011), rgba(0x0022)]);
    });

    test('pseudo hi-res interleaves the sub screen and the main screen', () => {
        setupMode1();
        write(0x33, 0x08);
        write(0x2C, 0x01);
        write(0x2D, 0x02);
        writeVram(0x2000 + 16, encodeTile(solid(1), 4));
        writeVram(0x3000 + 16, encodeTile(solid(2), 4));
        writeVram(0x1000, [0x0001]);
        writeVram(0x1400, [0x0001]);
        writeCgram(0, [0, RED, GREEN]);
        expect(hiresLine(1).slice(0, 4)).toEqual([rgba(GREEN), rgba(RED), rgba(GREEN), rgba(RED)]);
    });

    test('an empty sub screen shows the backdrop color', () => {
        setupMode1();
        write(0x33, 0x08);
        write(0x2C, 0x01);
        write(0x2D, 0x00);
        write(0x32, 0x20 | 0x1F);
        writeVram(0x2000 + 16, encodeTile(solid(1), 4));
        writeVram(0x1000, [0x0001]);
        writeCgram(0, [0, GREEN]);
        writeCgram(0, [BLUE]);
        expect(hiresLine(1).slice(0, 2)).toEqual([rgba(BLUE), rgba(GREEN)]);
    });
});

describe('SNES PPU interlace', () => {
    // Row of the frame, as drawn for line v
    function frameRow(row: number): number[] {
        return Array.from(ppu.frame.subarray(row * FRAME_WIDTH, (row + 1) * FRAME_WIDTH), pixel => pixel >>> 0).filter((_, x) => x & 1);
    }

    test('doubles the height and draws each field into alternate rows', () => {
        setupMode1();
        write(0x33, 0x01);
        expect(ppu.height).toBe(448);
        writeCgram(0, [RED]);
        timing.field = 0;
        ppu.renderLine(2);
        writeCgram(0, [GREEN]);
        timing.field = 1;
        ppu.renderLine(2);
        expect(frameRow(2)[0]).toBe(rgba(RED));
        expect(frameRow(3)[0]).toBe(rgba(GREEN));
        expect(ppu.read(0x3F) & 0x80).toBe(0x80);
    });

    test('hi-res backgrounds show every other line in each field', () => {
        write(0x05, 0x05);
        write(0x07, 0x10);
        write(0x0B, 0x02);
        write(0x2C, 0x01);
        write(0x2D, 0x01);
        write(0x33, 0x01);
        // Rows of colors 1 to 8
        writeVram(0x2000 + 16, encodeTile(striped(), 4));
        writeVram(0x2000 + 32, encodeTile(striped(), 4));
        writeVram(0x1000, [0x0001]);
        writeCgram(0, [0, RED, GREEN, BLUE, WHITE]);
        // Line 1 shows tile rows 2 and 3 in the two fields
        timing.field = 0;
        ppu.renderLine(1);
        timing.field = 1;
        ppu.renderLine(1);
        expect(frameRow(0)[0]).toBe(rgba(BLUE));
        expect(frameRow(1)[0]).toBe(rgba(WHITE));
    });

    test('OBJ interlace draws sprites at half height, alternating their rows', () => {
        write(0x01, 0x03);
        write(0x2C, 0x10);
        write(0x33, 0x02);
        writeVram(0x6000 + 16, encodeTile(striped(), 4));
        writeCgram(128, [0, RED, GREEN, BLUE, WHITE]);
        // Sprite 0 at (0, 10), the others hidden below the screen
        write(0x02, 0x00);
        write(0x03, 0x00);
        write(0x04, 0, 10, 1, 0);
        for (let i = 1; i < 128; i++) write(0x04, 0, 240, 0, 0);
        timing.field = 0;
        expect(line(10)[0]).toBe(rgba(RED));
        timing.field = 1;
        expect(line(10)[0]).toBe(rgba(GREEN));
        timing.field = 0;
        expect(line(11)[0]).toBe(rgba(BLUE));
        // 8 lines tall becomes 4
        expect(line(14)[0]).toBe(rgba(0));
    });
});

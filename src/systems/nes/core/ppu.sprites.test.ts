import { beforeAll, describe, expect, test } from 'bun:test';
import Bus from './bus';
import Cartridge from './cartridge';
import type Ppu from './ppu';
import { buildRom, clockUntil, muteConsole, runFrames } from './test-helpers';

const BACKDROP = 0x0F;
const BG_COLOUR = 0x16;
const SPRITE_COLOUR_1 = 0x2A;
const SPRITE_COLOUR_2 = 0x12;

// Tile ids in the CHR ROM
const SOLID = 1;       // colour 1 everywhere
const CORNER = 2;      // colour 1 in the top left pixel only
const BG_TILE = 3;     // colour 1 everywhere
const TALL_TOP = 4;    // colour 1, top half of an 8x16 sprite
const TALL_BOTTOM = 5; // colour 2, bottom half of an 8x16 sprite

const HIDDEN = 0xFF;
const FLIP_H = 0x40;
const FLIP_V = 0x80;
const BEHIND_BG = 0x20;

beforeAll(muteConsole);

function buildChr(): Uint8Array {
    const chr = new Uint8Array(0x2000);
    for (let row = 0; row < 8; row++) {
        chr[SOLID * 16 + row] = 0xFF;
        chr[BG_TILE * 16 + row] = 0xFF;
        chr[TALL_TOP * 16 + row] = 0xFF;
        chr[TALL_BOTTOM * 16 + 8 + row] = 0xFF;
    }
    chr[CORNER * 16] = 0x80;
    return chr;
}

function createPpu(): Ppu {
    const bus = new Bus();
    bus.insertCartridge(new Cartridge(buildRom({ chr: buildChr() })));
    const ppu = bus.ppu;
    ppu.reset();
    ppu.ppuWrite(0x3F00, BACKDROP);
    ppu.ppuWrite(0x3F01, BG_COLOUR);
    ppu.ppuWrite(0x3F11, SPRITE_COLOUR_1);
    ppu.ppuWrite(0x3F12, SPRITE_COLOUR_2);
    ppu.oam.fill(HIDDEN);
    ppu.cpuWrite(0x0001, 0x1E); // Show background and sprites, including the left 8 pixels
    return ppu;
}

function setSprite(ppu: Ppu, n: number, x: number, y: number, id: number, attribute = 0): void {
    ppu.oam.set([y, id, attribute, x], n * 4);
}

function setBackgroundTile(ppu: Ppu, column: number, row: number, id: number): void {
    ppu.ppuWrite(0x2000 + row * 32 + column, id);
}

// Renders only the PPU, the CPU is not needed
function render(ppu: Ppu): void {
    runFrames(ppu, 2);
}

function colourAt(ppu: Ppu, x: number, y: number): number {
    return ppu.screen.getPixel(x, y);
}

describe('sprites', () => {
    test('are drawn one scanline below their OAM y position', () => {
        const ppu = createPpu();
        setSprite(ppu, 0, 16, 31, SOLID);
        render(ppu);

        expect(colourAt(ppu, 16, 32)).toBe(SPRITE_COLOUR_1);
        expect(colourAt(ppu, 23, 39)).toBe(SPRITE_COLOUR_1);
        expect(colourAt(ppu, 16, 31)).toBe(BACKDROP);
        expect(colourAt(ppu, 16, 40)).toBe(BACKDROP);
        expect(colourAt(ppu, 15, 32)).toBe(BACKDROP);
        expect(colourAt(ppu, 24, 32)).toBe(BACKDROP);
    });

    test.each([
        ['no flip', 0, 0, 0],
        ['horizontal flip', FLIP_H, 7, 0],
        ['vertical flip', FLIP_V, 0, 7],
        ['both flips', FLIP_H | FLIP_V, 7, 7],
    ])('%s', (_name, attribute, dx, dy) => {
        const ppu = createPpu();
        setSprite(ppu, 0, 40, 39, CORNER, attribute);
        render(ppu);

        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const expected = x === dx && y === dy ? SPRITE_COLOUR_1 : BACKDROP;
                expect(colourAt(ppu, 40 + x, 40 + y)).toBe(expected);
            }
        }
    });

    test('8x16 sprites use two tiles, swapped by a vertical flip', () => {
        const ppu = createPpu();
        ppu.cpuWrite(0x0000, 0x20); // 8x16 sprites
        setSprite(ppu, 0, 16, 31, TALL_TOP);
        setSprite(ppu, 1, 32, 31, TALL_TOP, FLIP_V);
        render(ppu);

        expect(colourAt(ppu, 16, 32)).toBe(SPRITE_COLOUR_1);
        expect(colourAt(ppu, 16, 47)).toBe(SPRITE_COLOUR_2);
        expect(colourAt(ppu, 32, 32)).toBe(SPRITE_COLOUR_2);
        expect(colourAt(ppu, 32, 47)).toBe(SPRITE_COLOUR_1);
    });

    test('are drawn in front of the background, or behind it with the priority bit', () => {
        const ppu = createPpu();
        setBackgroundTile(ppu, 2, 4, BG_TILE);
        setBackgroundTile(ppu, 4, 4, BG_TILE);
        setSprite(ppu, 0, 16, 31, SOLID);
        setSprite(ppu, 1, 32, 31, SOLID, BEHIND_BG);
        setSprite(ppu, 2, 48, 31, SOLID, BEHIND_BG);
        render(ppu);

        expect(colourAt(ppu, 16, 32)).toBe(SPRITE_COLOUR_1);
        expect(colourAt(ppu, 32, 32)).toBe(BG_COLOUR);
        // Behind a transparent background pixel the sprite is still visible
        expect(colourAt(ppu, 48, 32)).toBe(SPRITE_COLOUR_1);
    });

    test('earlier sprites in OAM are drawn on top', () => {
        const ppu = createPpu();
        ppu.ppuWrite(0x3F15, SPRITE_COLOUR_2); // Palette 1 of the sprites
        setSprite(ppu, 0, 16, 31, SOLID, 0x01);
        setSprite(ppu, 1, 16, 31, SOLID, 0x00);
        render(ppu);

        expect(colourAt(ppu, 16, 32)).toBe(SPRITE_COLOUR_2);
    });

    test('only 8 are drawn per scanline, more set the overflow flag', () => {
        const ppu = createPpu();
        for (let n = 0; n < 9; n++) {
            setSprite(ppu, n, n * 16, 31, SOLID);
        }
        runFrames(ppu, 1);
        clockUntil(ppu, () => ppu.scanline === 100);

        expect(ppu.status.spriteOverflow).toBe(1);
        expect(colourAt(ppu, 7 * 16, 32)).toBe(SPRITE_COLOUR_1);
        expect(colourAt(ppu, 8 * 16, 32)).toBe(BACKDROP);
    });

    test('8 sprites on a scanline do not set the overflow flag', () => {
        const ppu = createPpu();
        for (let n = 0; n < 8; n++) {
            setSprite(ppu, n, n * 16, 31, SOLID);
        }
        runFrames(ppu, 1);
        clockUntil(ppu, () => ppu.scanline === 100);

        expect(ppu.status.spriteOverflow).toBe(0);
    });

    test('the left 8 pixels are hidden when the mask says so', () => {
        const ppu = createPpu();
        ppu.cpuWrite(0x0001, 0x18); // Background and sprites, but not in the left 8 pixels
        setSprite(ppu, 0, 4, 31, SOLID);
        render(ppu);

        expect(colourAt(ppu, 7, 32)).toBe(BACKDROP);
        expect(colourAt(ppu, 8, 32)).toBe(SPRITE_COLOUR_1);
    });
});

describe('sprite zero hit', () => {
    function hitAfterFrame(setup: (ppu: Ppu) => void): number {
        const ppu = createPpu();
        setBackgroundTile(ppu, 2, 4, BG_TILE);
        setup(ppu);
        runFrames(ppu, 1);
        clockUntil(ppu, () => ppu.scanline === 100);
        return ppu.status.spriteZeroHit;
    }

    test('is set when sprite 0 overlaps the background', () => {
        expect(hitAfterFrame(ppu => setSprite(ppu, 0, 16, 31, SOLID))).toBe(1);
    });

    test('is set even when sprite 0 is behind the background', () => {
        expect(hitAfterFrame(ppu => setSprite(ppu, 0, 16, 31, SOLID, BEHIND_BG))).toBe(1);
    });

    test('is not set when sprite 0 only overlaps transparent background', () => {
        expect(hitAfterFrame(ppu => setSprite(ppu, 0, 64, 31, SOLID))).toBe(0);
    });

    test('is not set by other sprites', () => {
        expect(hitAfterFrame(ppu => {
            setSprite(ppu, 0, 64, 31, SOLID);
            setSprite(ppu, 1, 16, 31, SOLID);
        })).toBe(0);
    });

    test('is cleared at the start of the next frame', () => {
        const ppu = createPpu();
        setBackgroundTile(ppu, 2, 4, BG_TILE);
        setSprite(ppu, 0, 16, 31, SOLID);
        runFrames(ppu, 1);
        clockUntil(ppu, () => ppu.scanline === 100);
        expect(ppu.status.spriteZeroHit).toBe(1);

        clockUntil(ppu, () => ppu.scanline === -1 && ppu.cycle === 2);
        expect(ppu.status.spriteZeroHit).toBe(0);
    });
});

describe('OAM', () => {
    test('is written through $2003/$2004 and the address increments', () => {
        const ppu = createPpu();
        ppu.cpuWrite(0x0003, 0x10);
        ppu.cpuWrite(0x0004, 0xAB);
        ppu.cpuWrite(0x0004, 0xCD);
        expect([...ppu.oam.subarray(0x10, 0x12)]).toEqual([0xAB, 0xCD]);

        ppu.cpuWrite(0x0003, 0x11);
        expect(ppu.cpuRead(0x0004)).toBe(0xCD);
    });

    test('is filled by DMA when the CPU writes to $4014', () => {
        const prg = new Uint8Array(0x4000);
        prg.set([
            0xA9, 0x02,       // LDA #$02
            0x8D, 0x14, 0x40, // STA $4014
            0x4C, 0x05, 0x80, // JMP $8005
        ]);
        prg.set([0x00, 0x80], 0x3FFC); // Reset vector: $8000

        const bus = new Bus();
        bus.insertCartridge(new Cartridge(buildRom({ prg })));
        for (let i = 0; i < 256; i++) {
            bus.cpuRam[0x0200 + i] = i ^ 0x5A;
        }
        bus.reset();
        runFrames(bus, 1);

        expect([...bus.ppu.oam]).toEqual(Array.from({ length: 256 }, (_, i) => i ^ 0x5A));
    });
});

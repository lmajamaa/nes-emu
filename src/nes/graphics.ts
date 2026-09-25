import { hex } from '../utils';

// The RGB of each of the 64 colours the PPU can output
export const PALETTE: readonly number[] = [
    0x545454, 0x001E74, 0x081090, 0x300088, 0x440064, 0x5C0030, 0x540400, 0x3C1800,
    0x202A00, 0x083A00, 0x004000, 0x003C00, 0x00323C, 0x000000, 0x000000, 0x000000,
    0x989698, 0x084CC4, 0x3032EC, 0x5C1EE4, 0x8814B0, 0xA01464, 0x982220, 0x783C00,
    0x545A00, 0x287200, 0x087C00, 0x007628, 0x006678, 0x000000, 0x000000, 0x000000,
    0xECEEEC, 0x4C9AEC, 0x787CEC, 0xB062EC, 0xE454EC, 0xEC58B4, 0xEC6A64, 0xD48820,
    0xA0AA00, 0x74C400, 0x4CD020, 0x38CC6C, 0x38B4CC, 0x3C3C3C, 0x000000, 0x000000,
    0xECEEEC, 0xA8CCEC, 0xBCBCEC, 0xD4B2EC, 0xECAEEC, 0xECAED4, 0xECB4B0, 0xE4C490,
    0xCCD278, 0xB4DE78, 0xA8E290, 0x98E2B4, 0xA0D6E4, 0xA0A2A0, 0x000000, 0x000000,
];

// As RGBA pixels of ImageData, which are ABGR words on little-endian machines
const PALETTE_ABGR = Uint32Array.from(PALETTE, rgb => 0xFF000000 | ((rgb & 0xFF) << 16) | (rgb & 0xFF00) | (rgb >> 16));

export function cssColor(color: number): string {
    return `#${hex(PALETTE[color & 0x3F], 6)}`;
}

// An image in the colours of PALETTE, like the PPU outputs
export class IndexedImage {
    readonly width: number;
    readonly height: number;
    readonly pixels: Uint8Array;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.pixels = new Uint8Array(width * height);
    }

    getPixel(x: number, y: number): number {
        return this.pixels[y * this.width + x];
    }

    setPixel(x: number, y: number, color: number): void {
        if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
            this.pixels[y * this.width + x] = color;
        }
    }

    // Into ImageData's pixels, which must be the same size
    toRgba(target: Uint8ClampedArray): void {
        const out = new Uint32Array(target.buffer, target.byteOffset, this.pixels.length);
        for (let i = 0; i < this.pixels.length; i++) out[i] = PALETTE_ABGR[this.pixels[i]];
    }
}

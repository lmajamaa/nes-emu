// Decodes the reference screenshots of test ROMs: 8-bit PNG (RGB, RGBA, palette or grayscale)
// and 24-bit BMP, into RGB pixels.

import { inflateSync } from 'node:zlib';

export interface RgbImage {
    width: number;
    height: number;
    // 3 bytes per pixel
    pixels: Uint8Array;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function decodeImage(data: Uint8Array): RgbImage {
    if (PNG_SIGNATURE.every((byte, i) => data[i] === byte)) return decodePng(data);
    if (data[0] === 0x42 && data[1] === 0x4D) return decodeBmp(data);
    throw new Error('Unsupported image format');
}

function decodePng(data: Uint8Array): RgbImage {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const idat: Uint8Array[] = [];
    let width = 0;
    let height = 0;
    let colorType = 0;
    let palette: Uint8Array | null = null;
    for (let offset = 8; offset < data.length;) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
        const chunk = data.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            width = view.getUint32(offset + 8);
            height = view.getUint32(offset + 12);
            if (chunk[8] !== 8 || chunk[12] !== 0) throw new Error('Only 8-bit, non-interlaced PNGs are supported');
            colorType = chunk[9];
        } else if (type === 'PLTE') {
            palette = chunk;
        } else if (type === 'IDAT') {
            idat.push(chunk);
        }
        offset += 12 + length;
    }

    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
    if (!channels) throw new Error(`Unsupported PNG color type ${colorType}`);
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const pixels = new Uint8Array(width * height * 3);
    let previous = new Uint8Array(stride);

    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let x = 0; x < stride; x++) {
            const left = x >= channels ? line[x - channels] : 0;
            const up = previous[x];
            const upLeft = x >= channels ? previous[x - channels] : 0;
            switch (filter) {
                case 1: line[x] += left; break;
                case 2: line[x] += up; break;
                case 3: line[x] += (left + up) >> 1; break;
                case 4: {
                    const p = left + up - upLeft;
                    const pa = Math.abs(p - left);
                    const pb = Math.abs(p - up);
                    const pc = Math.abs(p - upLeft);
                    line[x] += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
                    break;
                }
            }
        }
        for (let x = 0; x < width; x++) {
            for (let c = 0; c < 3; c++) {
                let value: number;
                if (colorType === 3) value = palette![line[x] * 3 + c];
                else if (colorType === 0 || colorType === 4) value = line[x * channels];
                else value = line[x * channels + c];
                pixels[(y * width + x) * 3 + c] = value;
            }
        }
        previous = line;
    }
    return { width, height, pixels };
}

function decodeBmp(data: Uint8Array): RgbImage {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const dataOffset = view.getUint32(10, true);
    const width = view.getInt32(18, true);
    const rawHeight = view.getInt32(22, true);
    if (view.getUint16(28, true) !== 24) throw new Error('Only 24-bit BMPs are supported');
    const height = Math.abs(rawHeight);
    const stride = Math.ceil(width * 3 / 4) * 4;
    const pixels = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
        // Rows are stored bottom up, unless the height is negative
        const row = rawHeight > 0 ? height - 1 - y : y;
        for (let x = 0; x < width; x++) {
            const source = dataOffset + row * stride + x * 3;
            const target = (y * width + x) * 3;
            pixels[target] = data[source + 2];
            pixels[target + 1] = data[source + 1];
            pixels[target + 2] = data[source];
        }
    }
    return { width, height, pixels };
}

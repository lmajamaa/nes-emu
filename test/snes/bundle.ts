// A gzipped bundle of files, to keep test data sets in one file: for each file, the path's
// length (16-bit) and UTF-8 bytes, the data's length (32-bit) and bytes, all little endian.

import { gunzipSync, gzipSync } from 'node:zlib';

export function packBundle(files: Map<string, Uint8Array>): Uint8Array {
    const encoder = new TextEncoder();
    const parts: Uint8Array[] = [];
    for (const [path, data] of files) {
        const name = encoder.encode(path);
        const header = new DataView(new ArrayBuffer(6));
        header.setUint16(0, name.length, true);
        header.setUint32(2, data.length, true);
        parts.push(new Uint8Array(header.buffer, 0, 2), name, new Uint8Array(header.buffer, 2, 4), data);
    }
    return gzipSync(Buffer.concat(parts), { level: 9 });
}

export function unpackBundle(bundle: Uint8Array): Map<string, Uint8Array> {
    const data = gunzipSync(bundle);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const decoder = new TextDecoder();
    const files = new Map<string, Uint8Array>();
    for (let offset = 0; offset < data.length;) {
        const nameLength = view.getUint16(offset, true);
        const path = decoder.decode(data.subarray(offset + 2, offset + 2 + nameLength));
        offset += 2 + nameLength;
        const size = view.getUint32(offset, true);
        offset += 4;
        // A copy, so each file has its own buffer (Buffer's slice would share the whole bundle's)
        files.set(path, new Uint8Array(data.subarray(offset, offset + size)));
        offset += size;
    }
    return files;
}

// Regenerates test/fixtures/spc700/opcodes.json.gz from Tom Harte's SPC700 SingleStepTests
// (https://github.com/SingleStepTests/spc700): downloads the start of every opcode's file, keeps
// a small sample of each and bundles them into one gzipped file. See test/fixtures/README.md.
//
// Usage: bun scripts/fetch-spc700-tests.ts [casesPerOpcode=100]

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import type { Spc700Bundle, Spc700State } from '../src/systems/snes/core/test-helpers';

interface UpstreamCase {
    name: string;
    initial: Spc700State;
    final: Spc700State;
    cycles: [addr: number | null, value: number | null, type: string][];
}

const BASE_URL = 'https://raw.githubusercontent.com/SingleStepTests/spc700/main/';
const OUT_DIR = new URL('../test/fixtures/spc700/', import.meta.url);
const casesPerOpcode = Number(process.argv[2] ?? 100);

// The files hold 10,000 cases each, all on one line, so only download the start
const CHUNK_BYTES = 64 * 1024;

// Cuts the complete objects out of the start of a JSON array
function completeObjects(text: string): string[] {
    const objects: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inString) {
            if (c === '\\') i++;
            else if (c === '"') inString = false;
        } else if (c === '"') {
            inString = true;
        } else if (c === '{') {
            if (depth++ === 0) start = i;
        } else if (c === '}') {
            if (--depth === 0) objects.push(text.slice(start, i + 1));
        }
    }
    return objects;
}

async function download(name: string): Promise<UpstreamCase[]> {
    let text = '';
    let objects: string[] = [];
    for (let start = 0; objects.length < casesPerOpcode; start += CHUNK_BYTES) {
        const response = await fetch(`${BASE_URL}v1/${name}.json`, {
            // A range of a compressed response can't be decompressed on its own
            headers: { 'Range': `bytes=${start}-${start + CHUNK_BYTES - 1}`, 'Accept-Encoding': 'identity' },
        });
        if (response.status === 416) break;
        if (!response.ok) {
            throw new Error(`Failed to download ${name}.json: ${response.status}`);
        }
        text += await response.text();
        objects = completeObjects(text);
        if (response.status !== 206) break;
    }
    return objects.slice(0, casesPerOpcode).map(json => JSON.parse(json));
}

if (import.meta.main) {
    await mkdir(OUT_DIR, { recursive: true });

    const bundle: Spc700Bundle = {};
    for (let opcode = 0; opcode < 256; opcode++) {
        const name = opcode.toString(16).padStart(2, '0');
        // The emulator doesn't run cycle by cycle, so only keep the cycle count
        bundle[name] = (await download(name)).map(({ name, initial, final, cycles }) => ({
            name,
            initial,
            final,
            cycles: cycles.length,
        }));
        console.log(`${name}.json: ${bundle[name].length} cases`);
    }

    await writeFile(new URL('opcodes.json.gz', OUT_DIR), gzipSync(JSON.stringify(bundle), { level: 9 }));
    const license = await fetch(`${BASE_URL}LICENSE`);
    if (license.ok) await writeFile(new URL('LICENSE', OUT_DIR), await license.text());
    console.log(`Wrote ${fileURLToPath(OUT_DIR)}`);
}

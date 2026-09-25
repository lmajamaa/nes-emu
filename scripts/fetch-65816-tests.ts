// Regenerates test/fixtures/65816/opcodes.json.gz from Tom Harte's 65816 SingleStepTests
// (https://github.com/SingleStepTests/65816): downloads the start of every opcode's emulation
// and native mode files, keeps a small sample of each and bundles them into one gzipped file.
// See test/fixtures/README.md.
//
// Usage: bun scripts/fetch-65816-tests.ts [casesPerFile=50]

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import type { Snes65816Bundle, Snes65816State } from '../src/systems/snes/core/test-helpers';

interface UpstreamCase {
    name: string;
    initial: Snes65816State;
    final: Snes65816State;
    // Address is null for the cycles where the CPU has stopped, after WAI and STP
    cycles: [addr: number | null, value: number | null, flags: string][];
}

const BASE_URL = 'https://raw.githubusercontent.com/SingleStepTests/65816/main/v1/';
const OUT_DIR = new URL('../test/fixtures/65816/', import.meta.url);
const OUT_FILE = new URL('opcodes.json.gz', OUT_DIR);
const casesPerFile = Number(process.argv[2] ?? 50);

// The files hold 10,000 cases each (about 6 MB), so only download the start
const CHUNK_BYTES = 128 * 1024;

// MVN and MVP cases stop partway through a block move, after a fixed number of cycles
const SKIPPED_OPCODES = new Set([0x44, 0x54]);

// One case per line, as "[{...}," or "{...}," or "{...}]"
async function download(name: string): Promise<UpstreamCase[]> {
    const cases: UpstreamCase[] = [];
    let text = '';
    for (let start = 0; cases.length < casesPerFile; start += CHUNK_BYTES) {
        const response = await fetch(`${BASE_URL}${name}.json`, {
            // A range of a compressed response can't be decompressed on its own
            headers: { 'Range': `bytes=${start}-${start + CHUNK_BYTES - 1}`, 'Accept-Encoding': 'identity' },
        });
        if (response.status === 416) break;
        if (!response.ok) {
            throw new Error(`Failed to download ${name}.json: ${response.status}`);
        }
        text += await response.text();
        const lines = text.split('\n');
        text = lines.pop()!;
        for (const line of lines) {
            const json = line.replace(/^\[/, '').replace(/[,\]]\s*$/, '');
            if (json) cases.push(JSON.parse(json));
        }
        if (response.status !== 206) break;
    }
    return cases.slice(0, casesPerFile);
}

if (import.meta.main) {
    await mkdir(OUT_DIR, { recursive: true });

    const bundle: Snes65816Bundle = {};
    for (let opcode = 0; opcode < 256; opcode++) {
        if (SKIPPED_OPCODES.has(opcode)) continue;
        for (const mode of ['e', 'n']) {
            const name = `${opcode.toString(16).padStart(2, '0')}.${mode}`;
            // The emulator doesn't run cycle by cycle, so only keep the cycle count
            bundle[name] = (await download(name)).map(({ name, initial, final, cycles }) => ({
                name,
                initial,
                final,
                cycles: cycles.filter(([addr]) => addr !== null).length,
            }));
            console.log(`${name}.json: ${bundle[name].length} cases`);
        }
    }

    await writeFile(OUT_FILE, gzipSync(JSON.stringify(bundle), { level: 9 }));
    console.log(`Wrote ${fileURLToPath(OUT_FILE)}`);
}

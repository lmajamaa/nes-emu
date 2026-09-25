// Regenerates test/fixtures/6502/opcodes.json.gz from Tom Harte's 6502 SingleStepTests
// (https://github.com/SingleStepTests/65x02): downloads the opcodes, keeps a small sample
// of each and bundles them into one gzipped file. See test/fixtures/README.md.
//
// Usage: bun scripts/fetch-cpu-tests.ts [casesPerOpcode=100]

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import type { SingleStepBundle, SingleStepState } from '../src/systems/nes/core/test-helpers';

// Upstream format: cycles holds the bus activity of every cycle
interface UpstreamCase {
    name: string;
    initial: SingleStepState;
    final: SingleStepState;
    cycles: [addr: number, value: number, type: 'read' | 'write'][];
}

const BASE_URL = 'https://raw.githubusercontent.com/SingleStepTests/65x02/main/6502/v1/';
const OUT_DIR = new URL('../test/fixtures/6502/', import.meta.url);
const OUT_FILE = new URL('opcodes.json.gz', OUT_DIR);
const casesPerOpcode = Number(process.argv[2] ?? 100);

// JAM locks up the CPU, so there's nothing to test in a single step
const JAM_OPCODES = new Set([0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xB2, 0xD2, 0xF2]);
const TESTED_OPCODES = Array.from({ length: 256 }, (_, opcode) => opcode).filter(opcode => !JAM_OPCODES.has(opcode));

// The NES 2A03 has no decimal mode, so skip cases with the D flag set for instructions
// affected by it: ADC and SBC, the unofficial ones using them (RRA, ISC, SBC $EB), and ARR
const DECIMAL_SENSITIVE = new Set([
    0x61, 0x65, 0x69, 0x6D, 0x71, 0x75, 0x79, 0x7D,
    0xE1, 0xE5, 0xE9, 0xED, 0xF1, 0xF5, 0xF9, 0xFD, 0xEB,
    0x63, 0x67, 0x6F, 0x73, 0x77, 0x7B, 0x7F,
    0xE3, 0xE7, 0xEF, 0xF3, 0xF7, 0xFB, 0xFF,
    0x6B,
]);
const FLAG_D = 0x08;

if (import.meta.main) {
    await mkdir(OUT_DIR, { recursive: true });

    const bundle: SingleStepBundle = {};
    for (const opcode of TESTED_OPCODES) {
        const name = opcode.toString(16).padStart(2, '0');
        const response = await fetch(`${BASE_URL}${name}.json`);
        if (!response.ok) {
            throw new Error(`Failed to download ${name}.json: ${response.status}`);
        }

        let cases: UpstreamCase[] = await response.json();
        if (DECIMAL_SENSITIVE.has(opcode)) {
            cases = cases.filter(c => (c.initial.p & FLAG_D) === 0);
        }
        // The emulator doesn't run cycle by cycle, so only keep the cycle count
        // instead of the bus activity of every cycle
        bundle[name] = cases.slice(0, casesPerOpcode)
            .map(({ name, initial, final, cycles }) => ({ name, initial, final, cycles: cycles.length }));
        console.log(`${name}.json: ${bundle[name].length} cases`);
    }

    await writeFile(OUT_FILE, gzipSync(JSON.stringify(bundle), { level: 9 }));
    console.log(`Wrote ${fileURLToPath(OUT_FILE)}`);
}

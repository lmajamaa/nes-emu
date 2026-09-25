// Runs Tom Harte's 65816 SingleStepTests (sampled by scripts/fetch-65816-tests.ts) against the
// CPU: each case sets up registers and RAM, executes one instruction and checks registers, RAM
// and the cycle count.

import { describe, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import Cpu65816, { MNEMONICS } from './cpu';
import { fmt } from '../../nes/core/test-helpers';
import { FlatBus24, SINGLE_STEP_65816_TESTS, type Snes65816Bundle, type Snes65816Case } from './test-helpers';

const MAX_REPORTED_CASES = 3;

const bus = new FlatBus24();

function runCase(testCase: Snes65816Case): string[] {
    const cpu = new Cpu65816(bus);
    const { initial, final } = testCase;

    cpu.e = initial.e === 1;
    cpu.a = initial.a;
    cpu.x = initial.x;
    cpu.y = initial.y;
    cpu.s = initial.s;
    cpu.d = initial.d;
    cpu.pc = initial.pc;
    cpu.pbr = initial.pbr;
    cpu.dbr = initial.dbr;
    cpu.setP(initial.p);
    for (const [addr, value] of initial.ram) {
        bus.ram[addr] = value;
    }

    const cycles = cpu.step();

    const errors: string[] = [];
    const check = (label: string, actual: number, expected: number, length = 2) => {
        if (actual !== expected) {
            errors.push(`${label}: got ${fmt(actual, length)}, expected ${fmt(expected, length)}`);
        }
    };
    check('PC', cpu.pc, final.pc, 4);
    check('S', cpu.s, final.s, 4);
    check('P', cpu.getP(), final.p);
    check('E', cpu.e ? 1 : 0, final.e);
    check('A', cpu.a, final.a, 4);
    check('X', cpu.x, final.x, 4);
    check('Y', cpu.y, final.y, 4);
    check('D', cpu.d, final.d, 4);
    check('DBR', cpu.dbr, final.dbr);
    check('PBR', cpu.pbr, final.pbr);
    for (const [addr, value] of final.ram) {
        check(`RAM[${fmt(addr, 6)}]`, bus.ram[addr], value);
    }
    check('cycles', cycles, testCase.cycles, 0);

    // Clean up for the next case instead of clearing all 16 MB
    for (const [addr] of initial.ram) bus.ram[addr] = 0;
    for (const [addr] of final.ram) bus.ram[addr] = 0;
    return errors;
}

// { "00.e": [cases...], "00.n": [...], ... }
const bundle: Snes65816Bundle = JSON.parse(gunzipSync(readFileSync(SINGLE_STEP_65816_TESTS)).toString());

describe('65816 SingleStepTests', () => {
    for (const key of Object.keys(bundle).sort()) {
        const cases = bundle[key];
        const [hex, mode] = key.split('.');
        const opcode = parseInt(hex, 16);

        test(`${fmt(opcode)} ${MNEMONICS[opcode]} ${mode === 'e' ? 'emulation' : 'native'}`, () => {
            const failures = [];
            for (const testCase of cases) {
                let errors;
                try {
                    errors = runCase(testCase);
                } catch (e) {
                    errors = [`threw ${e}`];
                }
                if (errors.length) {
                    failures.push(`  [${testCase.name}] ${errors.join('; ')}`);
                }
            }

            if (failures.length) {
                throw new Error(
                    `${failures.length}/${cases.length} cases failed, e.g.\n` +
                    failures.slice(0, MAX_REPORTED_CASES).join('\n'));
            }
        });
    }
});

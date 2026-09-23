// Runs Tom Harte's 6502 SingleStepTests (sampled by scripts/fetch-cpu-tests.js)
// against the CPU: each case sets up registers and RAM, executes one instruction
// and checks registers, RAM and the cycle count.

import { beforeAll, describe, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import Cpu from '../src/nes/cpu';
import { instructions } from '../src/nes/instructions';
import { FlatBus, fmt, muteConsole, normalizeFlags, SINGLE_STEP_TESTS, step, type SingleStepBundle, type SingleStepCase } from './helpers';

const MAX_REPORTED_CASES = 3;

beforeAll(muteConsole);

function runCase(testCase: SingleStepCase): string[] {
    const bus = new FlatBus();
    const cpu = new Cpu(bus);
    const { initial, final } = testCase;

    cpu.pc = initial.pc;
    cpu.stkp = initial.s;
    cpu.a = initial.a;
    cpu.x = initial.x;
    cpu.y = initial.y;
    cpu.setFlags(initial.p);
    cpu.cycles = 0;
    for (const [addr, value] of initial.ram) {
        bus.ram[addr] = value;
    }

    const cycles = step(cpu);

    const errors: string[] = [];
    const check = (label: string, actual: number, expected: number, length = 2) => {
        if (actual !== expected) {
            errors.push(`${label}: got ${fmt(actual, length)}, expected ${fmt(expected, length)}`);
        }
    };
    check('PC', cpu.pc, final.pc, 4);
    check('SP', cpu.stkp, final.s);
    check('A', cpu.a, final.a);
    check('X', cpu.x, final.x);
    check('Y', cpu.y, final.y);
    check('P', normalizeFlags(cpu.getFlags()), normalizeFlags(final.p));
    for (const [addr, value] of final.ram) {
        check(`RAM[${fmt(addr, 4)}]`, bus.ram[addr], value);
    }
    check('cycles', cycles, testCase.cycles, 0);
    return errors;
}

// { "00": [cases...], "01": [...], ... } keyed by opcode in hex
const bundle: SingleStepBundle = JSON.parse(gunzipSync(readFileSync(SINGLE_STEP_TESTS)).toString());

// The tests model a generic NMOS 6502, which differs from the NES in chip dependent details.
// Marked so that they turn red if they start passing.
const KNOWN_DIFFERENCES: Record<number, string> = {
    // LXA's magic value, the emulator uses the one blargg's NES-verified tests expect
    0xAB: 'LXA magic value of the NES',
};

describe('6502 SingleStepTests', () => {
    // Sort, as object keys like "10" would otherwise be ordered before "0a"
    for (const key of Object.keys(bundle).sort()) {
        const cases = bundle[key];
        const opcode = parseInt(key, 16);
        const [name, addrmode] = instructions[opcode];

        const title = `${fmt(opcode)} ${name} ${addrmode}`;
        const knownDifference = KNOWN_DIFFERENCES[opcode];
        (knownDifference ? test.failing : test)(knownDifference ? `${title} (${knownDifference})` : title, () => {
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

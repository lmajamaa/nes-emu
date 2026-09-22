// Runs Tom Harte's 6502 SingleStepTests (sampled by scripts/fetch-cpu-tests.js)
// against the CPU: each case sets up registers and RAM, executes one instruction
// and checks registers, RAM and the cycle count.

import { beforeAll, describe, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import Cpu from '../src/nes/cpu';
import { instructions } from '../src/nes/instructions';
import { FlatBus, fmt, muteConsole, normalizeFlags, SINGLE_STEP_TESTS, step } from './helpers';

const MAX_REPORTED_CASES = 3;

beforeAll(muteConsole);

function runCase(testCase) {
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

    const errors = [];
    const check = (label, actual, expected, length) => {
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
const bundle = JSON.parse(gunzipSync(readFileSync(SINGLE_STEP_TESTS)));

describe('6502 SingleStepTests', () => {
    // Sort, as object keys like "10" would otherwise be ordered before "0a"
    for (const key of Object.keys(bundle).sort()) {
        const cases = bundle[key];
        const opcode = parseInt(key, 16);
        const [name, addrmode] = instructions[opcode] ?? ['???', '???'];

        test(`${fmt(opcode)} ${name} ${addrmode}`, () => {
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

// Runs Tom Harte's SPC700 SingleStepTests (sampled by scripts/fetch-spc700-tests.ts) against the
// sound CPU: each case sets up registers and RAM, executes one instruction and checks registers,
// RAM and the cycle count.

import { describe, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import Spc700, { type SpcBus } from './spc700';
import { fmt } from '../../../nes/core/test-helpers';
import { SINGLE_STEP_SPC700_TESTS, type Spc700Bundle, type Spc700Case } from '../test-helpers';

const MAX_REPORTED_CASES = 3;
// SLEEP and STOP halt, and the cases keep running for a few cycles after that
const HALTING_OPCODES = new Set([0xEF, 0xFF]);

class FlatBus implements SpcBus {
    readonly ram = new Uint8Array(0x10000);

    read(addr: number): number {
        return this.ram[addr];
    }

    write(addr: number, data: number): void {
        this.ram[addr] = data;
    }

    idle(): void {}
}

const bus = new FlatBus();

function runCase(opcode: number, testCase: Spc700Case): string[] {
    const cpu = new Spc700(bus);
    const { initial, final } = testCase;
    cpu.pc = initial.pc;
    cpu.a = initial.a;
    cpu.x = initial.x;
    cpu.y = initial.y;
    cpu.sp = initial.sp;
    cpu.setPsw(initial.psw);
    for (const [addr, value] of initial.ram) bus.ram[addr] = value;

    const cycles = cpu.step();

    const errors: string[] = [];
    const check = (label: string, actual: number, expected: number, length = 2) => {
        if (actual !== expected) errors.push(`${label}: got ${fmt(actual, length)}, expected ${fmt(expected, length)}`);
    };
    check('PC', cpu.pc, final.pc, 4);
    check('A', cpu.a, final.a);
    check('X', cpu.x, final.x);
    check('Y', cpu.y, final.y);
    check('SP', cpu.sp, final.sp);
    check('PSW', cpu.getPsw(), final.psw);
    for (const [addr, value] of final.ram) check(`RAM[${fmt(addr, 4)}]`, bus.ram[addr], value);
    if (!HALTING_OPCODES.has(opcode)) check('cycles', cycles, testCase.cycles, 0);

    for (const [addr] of initial.ram) bus.ram[addr] = 0;
    for (const [addr] of final.ram) bus.ram[addr] = 0;
    return errors;
}

// { "00": [cases...], "01": [...], ... } keyed by opcode in hex
const bundle: Spc700Bundle = JSON.parse(gunzipSync(readFileSync(SINGLE_STEP_SPC700_TESTS)).toString());

describe('SPC700 SingleStepTests', () => {
    for (const key of Object.keys(bundle).sort()) {
        const opcode = parseInt(key, 16);
        const cases = bundle[key];
        test(fmt(opcode), () => {
            const failures = [];
            for (const testCase of cases) {
                let errors;
                try {
                    errors = runCase(opcode, testCase);
                } catch (e) {
                    errors = [`threw ${e}`];
                }
                if (errors.length) failures.push(`  [${testCase.name}] ${errors.join('; ')}`);
            }
            if (failures.length) {
                throw new Error(`${failures.length}/${cases.length} cases failed, e.g.\n` + failures.slice(0, MAX_REPORTED_CASES).join('\n'));
            }
        });
    }
});

// Runs Tom Harte's 65816 SingleStepTests (sampled by scripts/fetch-65816-tests.ts) against the
// CPU: each case sets up registers and RAM, executes one instruction and checks registers, RAM
// and the cycle count.

import { describe, expect, test } from 'bun:test';
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

// The tests were checked on a WDC 65C816, and the SNES's 5A22 differs in one undocumented case, found
// on a real SNES by gilyon's snes-tests: in emulation mode with the direct page not page aligned,
// (dp,X) reads the pointer's high byte from the same page as its low byte. Those cases are left out.
const DP_X_INDIRECT = new Set([0x01, 0x21, 0x41, 0x61, 0x81, 0xA1, 0xC1, 0xE1]);

function differsOnSnes(opcode: number, { initial }: Snes65816Case): boolean {
    if (!DP_X_INDIRECT.has(opcode) || initial.e !== 1 || (initial.d & 0xFF) === 0) return false;
    const operand = new Map(initial.ram).get((initial.pbr << 16) | ((initial.pc + 1) & 0xFFFF)) ?? 0;
    return ((initial.d + operand + (initial.x & 0xFF)) & 0xFF) === 0xFF;
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
                if (differsOnSnes(opcode, testCase)) continue;
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

describe('65816 on the SNES', () => {
    // Test 0027 of gilyon's cputest: ADC ($F7,X) with D=$011A and X=$EE reads the pointer from $02FF and $0200
    test('(dp,X) in emulation mode reads the pointer within one page when the direct page is not aligned', () => {
        const cpu = new Cpu65816(bus);
        cpu.e = true;
        cpu.setP(0x21);
        cpu.a = 0x1112;
        cpu.x = 0xEE;
        cpu.d = 0x011A;
        cpu.dbr = 0x7F;
        cpu.pbr = 0;
        cpu.pc = 0x8000;
        bus.ram.set([0x61, 0xF7], 0x8000);
        bus.ram[0x02FF] = 0x34;
        bus.ram[0x0200] = 0x12;
        bus.ram[0x0300] = 0x56;
        bus.ram[0x7F1234] = 0xED;

        cpu.step();

        expect(cpu.a).toBe(0x1100);
        expect(cpu.getP()).toBe(0x33);
        for (const addr of [0x8000, 0x8001, 0x02FF, 0x0200, 0x0300, 0x7F1234]) bus.ram[addr] = 0;
    });
});

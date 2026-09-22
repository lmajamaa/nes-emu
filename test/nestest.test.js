// Runs nestest.nes in automation mode (PC = $C000, no PPU needed) and compares
// the CPU state before every instruction with the reference log from Nintendulator.
// Only the official opcode section of the log is used.

import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import Bus from '../src/nes/bus';
import Cartridge from '../src/nes/cartridge';
import { fmt, muteConsole, NESTEST_LOG as LOG, NESTEST_ROM as ROM, normalizeFlags, step } from './helpers';

const CONTEXT_LINES = 3;

// C000  4C F5 C5  JMP $C5F5                       A:00 X:00 Y:00 P:24 SP:FD PPU:  0, 21 CYC:7
const LINE_PATTERN = /^([0-9A-F]{4})  .{9}(.).*A:([0-9A-F]{2}) X:([0-9A-F]{2}) Y:([0-9A-F]{2}) P:([0-9A-F]{2}) SP:([0-9A-F]{2}).*CYC:(\d+)$/;

function parseLog() {
    const entries = [];
    const lines = readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const [index, line] of lines.entries()) {
        const m = line.match(LINE_PATTERN);
        if (!m) throw new Error(`Unparseable nestest.log line ${index + 1}: ${line}`);
        // Unofficial opcodes are marked with '*' - the official tests end there
        if (m[2] === '*') break;
        entries.push({
            line: index + 1,
            text: line,
            pc: parseInt(m[1], 16),
            a: parseInt(m[3], 16),
            x: parseInt(m[4], 16),
            y: parseInt(m[5], 16),
            p: parseInt(m[6], 16),
            sp: parseInt(m[7], 16),
            cyc: Number(m[8]),
        });
    }
    return entries;
}

function stateOf(cpu, cyc) {
    return {
        pc: cpu.pc,
        a: cpu.a,
        x: cpu.x,
        y: cpu.y,
        p: normalizeFlags(cpu.getFlags()),
        sp: cpu.stkp,
        cyc,
    };
}

function describeState(s) {
    return `PC:${fmt(s.pc, 4)} A:${fmt(s.a)} X:${fmt(s.x)} Y:${fmt(s.y)} P:${fmt(s.p)} SP:${fmt(s.sp)} CYC:${s.cyc}`;
}

function context(log, index) {
    return log.slice(Math.max(0, index - CONTEXT_LINES), index + 1)
        .map(e => `  ${String(e.line).padStart(4)}: ${e.text}`).join('\n');
}

describe('nestest.nes (official opcodes)', () => {
    const log = parseLog();
    const trace = [];
    let bus;

    beforeAll(() => {
        muteConsole();
        bus = new Bus();
        bus.insertCartridge(new Cartridge(readFileSync(ROM)));
        const cpu = bus.cpu;
        cpu.pc = 0xC000;
        cpu.stkp = 0xFD;
        cpu.setFlags(0x24);
        cpu.cycles = 0;

        let cyc = 7; // reset sequence
        for (let i = 0; i < log.length; i++) {
            trace.push(stateOf(cpu, cyc));
            cyc += step(cpu);
        }
    });

    test('registers match the log', () => {
        const expected = e => ({ ...e, p: normalizeFlags(e.p) });
        const index = log.findIndex((e, i) =>
            ['pc', 'a', 'x', 'y', 'p', 'sp'].some(k => expected(e)[k] !== trace[i][k]));
        if (index !== -1) {
            throw new Error(
                `First register mismatch at log line ${log[index].line}, after executing:\n` +
                context(log, index) + '\n' +
                `  emulator: ${describeState(trace[index])}`);
        }
    });

    test('cycle counts match the log', () => {
        // Compare the length of each instruction so an early error doesn't cascade
        const index = log.findIndex((e, i) => i > 0 && e.cyc - log[i - 1].cyc !== trace[i].cyc - trace[i - 1].cyc);
        if (index !== -1) {
            throw new Error(
                `First cycle mismatch at log line ${log[index].line}: ` +
                `instruction at line ${log[index - 1].line} took ${trace[index].cyc - trace[index - 1].cyc} cycles, ` +
                `expected ${log[index].cyc - log[index - 1].cyc}\n` + context(log, index));
        }
    });

    test('reports no errors in $0002', () => {
        // nestest stores the number of the first failed official test in $02
        expect(fmt(bus.cpuRam[0x02])).toBe(fmt(0x00));
    });
});

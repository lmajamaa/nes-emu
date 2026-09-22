import { spyOn } from 'bun:test';
import { hex } from '../src/utilities';

// All test data lives in the repo under test/data, see test/data/README.md
export const NESTEST_ROM = new URL('./data/nestest/nestest.nes', import.meta.url);
export const NESTEST_LOG = new URL('./data/nestest/nestest.log', import.meta.url);
export const SINGLE_STEP_TESTS = new URL('./data/6502/official.json.gz', import.meta.url);

/** Plain 64KB RAM bus. Uses a regular Array so non-byte writes are visible to tests. */
export class FlatBus {
    constructor() {
        this.ram = Array(0x10000).fill(0x00);
    }

    cpuRead(addr) {
        return this.ram[addr & 0xFFFF];
    }

    cpuWrite(addr, data) {
        this.ram[addr & 0xFFFF] = data;
    }
}

/** Executes one whole instruction and returns the number of cycles it took. */
export function step(cpu) {
    let cycles = 0;
    do {
        cpu.clock();
        cycles++;
    } while (!cpu.complete() && cycles < 100);
    return cycles;
}

/** B only exists on the stack and U always reads as 1, so ignore both in comparisons. */
export function normalizeFlags(p) {
    return (p | 0x20) & ~0x10;
}

/** Formats a number as $hex, or as decimal when length is 0. */
export function fmt(value, length = 2) {
    if (typeof value !== 'number' || Number.isNaN(value) || length === 0) {
        return String(value);
    }
    return '$' + hex(value, length);
}

/** The CPU logs heavily (JSR, writes to $2000...), silence it while testing. */
export function muteConsole() {
    spyOn(console, 'log').mockImplementation(() => {});
}

import { spyOn } from 'bun:test';
import type Cpu from '../src/nes/cpu';
import type { CpuBus } from '../src/nes/cpu';
import { hex } from '../src/utils';

// All test data lives in the repo under test/data, see test/data/README.md
export const NESTEST_ROM = new URL('./data/nestest/nestest.nes', import.meta.url);
export const NESTEST_LOG = new URL('./data/nestest/nestest.log', import.meta.url);
export const SINGLE_STEP_TESTS = new URL('./data/6502/official.json.gz', import.meta.url);

export interface SingleStepState {
    pc: number;
    s: number;
    a: number;
    x: number;
    y: number;
    p: number;
    ram: [addr: number, value: number][];
}

export interface SingleStepCase {
    name: string;
    initial: SingleStepState;
    final: SingleStepState;
    cycles: number;
}

// Opcode in hex ("00".."ff") -> cases
export type SingleStepBundle = Record<string, SingleStepCase[]>;

// Uses a regular Array rather than a Uint8Array so non-byte writes are visible to tests
export class FlatBus implements CpuBus {
    readonly ram: number[] = Array(0x10000).fill(0x00);

    cpuRead(addr: number): number {
        return this.ram[addr & 0xFFFF];
    }

    cpuWrite(addr: number, data: number): void {
        this.ram[addr & 0xFFFF] = data;
    }
}

// Executes one whole instruction and returns the number of cycles it took
export function step(cpu: Cpu): number {
    let cycles = 0;
    do {
        cpu.clock();
        cycles++;
    } while (!cpu.complete() && cycles < 100);
    return cycles;
}

// B only exists on the stack and U always reads as 1, so ignore both in comparisons
export function normalizeFlags(p: number): number {
    return (p | 0x20) & ~0x10;
}

// Formats a number as $hex, or as decimal when length is 0
export function fmt(value: unknown, length = 2): string {
    if (typeof value !== 'number' || Number.isNaN(value) || length === 0) {
        return String(value);
    }
    return '$' + hex(value, length);
}

export function muteConsole(): void {
    spyOn(console, 'log').mockImplementation(() => {});
}

import { spyOn } from 'bun:test';
import Bus from './bus';
import type Cpu from './cpu';
import type Ppu from './ppu';
import type { CpuBus } from './cpu';
import { hex } from '../../../utils';

// Test data lives under test/fixtures, see its README, apart from nestest.nes, which the app also loads from public/roms
export const NESTEST_ROM = new URL('../../../../public/roms/nestest.nes', import.meta.url);
export const NESTEST_LOG = new URL(import.meta.resolve('@test/fixtures/nestest/nestest.log'));
export const SINGLE_STEP_TESTS = new URL(import.meta.resolve('@test/fixtures/6502/opcodes.json.gz'));
export const BLARGG_APU_DIR = new URL('.', import.meta.resolve('@test/fixtures/blargg-apu/readme.txt'));
export const BLARGG_MMC3_DIR = new URL('.', import.meta.resolve('@test/fixtures/blargg-mmc3/readme.txt'));
export const BLARGG_INSTR_ROM = new URL(import.meta.resolve('@test/fixtures/blargg-instr/all_instrs.nes'));

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

// Builds an iNES image, by default one 16KB PRG bank and one 8KB CHR bank using mapper 0.
// An empty CHR means the board has CHR RAM.
export function buildRom({ prg, chr, mapper = 0, battery = false }: { prg?: Uint8Array, chr?: Uint8Array, mapper?: number, battery?: boolean } = {}): Uint8Array {
    prg ??= new Uint8Array(0x4000);
    chr ??= new Uint8Array(0x2000);
    const header = [
        0x4E, 0x45, 0x53, 0x1A, prg.length / 0x4000, chr.length / 0x2000,
        ((mapper & 0x0F) << 4) | (battery ? 0x02 : 0), mapper & 0xF0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    return Uint8Array.from([...header, ...prg, ...chr]);
}

// Clocks the whole system, or just the PPU
export function runFrames(target: Bus | Ppu, frames: number): void {
    const ppu = target instanceof Bus ? target.ppu : target;
    for (let f = 0; f < frames; f++) {
        do { target.clock(); } while (!ppu.frameComplete);
        ppu.frameComplete = false;
    }
}

export function clockUntil(ppu: Ppu, done: () => boolean): void {
    do { ppu.clock(); } while (!done());
}

export function muteConsole(): void {
    spyOn(console, 'log').mockImplementation(() => {});
}

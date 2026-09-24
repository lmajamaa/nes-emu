import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import SnesBus from '../../src/systems/snes/core/bus';
import SnesCartridge from '../../src/systems/snes/core/cartridge';
import { disassemble, disassembleFrom } from '../../src/systems/snes/core/disassembler';
import Snes from '../../src/systems/snes/core/snes';
import { SnesEmulator } from '../../src/systems/snes/emulator';
import { buildRom, SINGLE_STEP_65816_TESTS, type Snes65816Bundle } from './helpers';

const memory = (bytes: Record<number, number[]>) => {
    const ram = new Uint8Array(0x1000000);
    for (const [addr, data] of Object.entries(bytes)) ram.set(data, Number(addr));
    return (addr: number) => ram[addr];
};

describe('65816 disassembler', () => {
    test('decodes addressing modes', () => {
        const read = memory({ 0x008000: [0xAD, 0x34, 0x12, 0xB7, 0x10, 0x5C, 0x56, 0x34, 0x12, 0x54, 0x7E, 0x7F] });
        const lines = disassembleFrom(read, 0x008000, { m: true, x: true }, 4).map(line => line.text);
        expect(lines).toEqual([
            '$00:8000  AD 34 12    LDA $1234',
            '$00:8003  B7 10       LDA [$10],Y',
            '$00:8005  5C 56 34 12 JML $123456',
            '$00:8009  54 7E 7F    MVN $7F,$7E',
        ]);
    });

    test('shows where branches go', () => {
        const read = memory({ 0x018000: [0xD0, 0xFE, 0x82, 0x00, 0x80] });
        const lines = disassembleFrom(read, 0x018000, { m: true, x: true }, 2).map(line => line.text);
        expect(lines[0]).toEndWith('BNE $8000');
        expect(lines[1]).toEndWith('BRL $0005');
    });

    test('follows REP and SEP for the size of immediates', () => {
        // REP #$30 ; LDA #$1234 ; LDX #$5678 ; SEP #$20 ; LDA #$12
        const read = memory({ 0x008000: [0xC2, 0x30, 0xA9, 0x34, 0x12, 0xA2, 0x78, 0x56, 0xE2, 0x20, 0xA9, 0x12] });
        const lines = disassembleFrom(read, 0x008000, { m: true, x: true }, 5).map(line => line.text.slice(22));
        expect(lines).toEqual(['REP #$30', 'LDA #$1234', 'LDX #$5678', 'SEP #$20', 'LDA #$12']);
    });

    // The CPU tests move the PC past each instruction, so they check every size
    test('agrees with the CPU on the size of every instruction', () => {
        const bundle: Snes65816Bundle = JSON.parse(gunzipSync(readFileSync(SINGLE_STEP_65816_TESTS)).toString());
        // Instructions that jump, branch, stop or repeat
        const flow = new Set([0x00, 0x02, 0x10, 0x20, 0x22, 0x30, 0x40, 0x4C, 0x50, 0x5C, 0x60, 0x6B, 0x6C, 0x70,
            0x7C, 0x80, 0x82, 0x90, 0xB0, 0xCB, 0xD0, 0xDB, 0xDC, 0xF0, 0xFC]);
        const mismatches: string[] = [];
        for (const [key, cases] of Object.entries(bundle)) {
            const opcode = parseInt(key, 16);
            if (flow.has(opcode)) continue;
            for (const { initial, final } of cases.slice(0, 10)) {
                const ram = new Map(initial.ram);
                const read = (addr: number) => ram.get(addr) ?? 0;
                const e = initial.e === 1;
                const flags = { m: e || (initial.p & 0x20) !== 0, x: e || (initial.p & 0x10) !== 0 };
                const { size } = disassemble(read, (initial.pbr << 16) | initial.pc, flags);
                if (((initial.pc + size) & 0xFFFF) !== final.pc) mismatches.push(`${key}: ${size}`);
            }
        }
        expect(mismatches).toEqual([]);
    });
});

describe('SNES debugging hooks', () => {
    test('peeking reads memory without touching I/O', () => {
        const bus = new SnesBus();
        bus.reset();
        bus.wram[0x10] = 0x42;
        expect(bus.peek(0x7E0010)).toBe(0x42);
        const before = bus.cycles;
        expect(bus.peek(0x002139)).toBe(0);
        expect(bus.peek(0x004210)).toBe(0);
        expect(bus.cycles).toBe(before);
    });

    test('remembers the last instructions run', () => {
        // NOP NOP NOP BRA *
        const rom = buildRom({ patches: { 0: [0xEA, 0xEA, 0xEA, 0x80, 0xFE] } });
        const snes = new Snes(new SnesCartridge(rom.buffer as ArrayBuffer));
        snes.reset();
        for (let i = 0; i < 6; i++) snes.step();
        expect(snes.recentInstructions()).toEqual([0x8000, 0x8001, 0x8002, 0x8003]);
    });

    test('C steps one instruction', () => {
        const emulator = new SnesEmulator();
        emulator.load(buildRom({ patches: { 0: [0xEA, 0xEA] } }).buffer as ArrayBuffer);
        expect(emulator.handleDebugKey('KeyC')).toBe(true);
        expect(emulator.snes!.cpu.pc).toBe(0x8001);
        expect(emulator.handleDebugKey('KeyP')).toBe(false);
    });
});

describe('SNES save RAM', () => {
    // LoROM with 8 KB of battery-backed SRAM: STA $700000 ; BRA *
    const rom = () => buildRom({ chipset: 0x02, sramByte: 0x03, patches: { 0: [0xA9, 0x42, 0x8F, 0x00, 0x00, 0x70, 0x80, 0xFE] } }).buffer as ArrayBuffer;

    test('games without a battery have nothing to save', () => {
        const emulator = new SnesEmulator();
        emulator.load(buildRom().buffer as ArrayBuffer);
        expect(emulator.saveId).toBeNull();
    });

    test('is identified by the ROM', () => {
        const a = new SnesEmulator();
        a.load(rom());
        const b = new SnesEmulator();
        b.load(rom());
        expect(a.saveId).toMatch(/^snes-[0-9a-f]{8}$/);
        expect(b.saveId).toBe(a.saveId);
    });

    test('is taken once after the game writes it', () => {
        const emulator = new SnesEmulator();
        emulator.load(rom());
        expect(emulator.takeSave()).toBeNull();
        emulator.runFrame();
        const save = emulator.takeSave();
        expect(save?.length).toBe(0x2000);
        expect(save?.[0]).toBe(0x42);
        expect(emulator.takeSave()).toBeNull();
    });

    test('is restored into the cartridge', () => {
        const emulator = new SnesEmulator();
        emulator.load(buildRom({ chipset: 0x02, sramByte: 0x03 }).buffer as ArrayBuffer);
        const save = new Uint8Array(0x2000).fill(0x5A);
        emulator.loadSave(save);
        expect(emulator.snes!.bus.peek(0x700123)).toBe(0x5A);
        expect(emulator.takeSave()).toBeNull();
    });
});

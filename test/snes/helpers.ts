import type { MapMode } from '../../src/systems/snes/core/cartridge';
import type { Bus65816 } from '../../src/systems/snes/core/cpu';

export const SINGLE_STEP_65816_TESTS = new URL('../data/65816/opcodes.json.gz', import.meta.url);

export interface Snes65816State {
    pc: number;
    s: number;
    p: number;
    a: number;
    x: number;
    y: number;
    dbr: number;
    d: number;
    pbr: number;
    e: number;
    ram: [addr: number, value: number][];
}

export interface Snes65816Case {
    name: string;
    initial: Snes65816State;
    final: Snes65816State;
    cycles: number;
}

// { "00.e": [cases...], "00.n": [...], ... } keyed by opcode in hex and e(mulation) / n(ative) mode
export type Snes65816Bundle = Record<string, Snes65816Case[]>;

// 16 MB of RAM in a single address space, like the SingleStepTests assume
export class FlatBus24 implements Bus65816 {
    readonly ram = new Uint8Array(0x1000000);

    read(addr: number): number {
        return this.ram[addr];
    }

    write(addr: number, data: number): void {
        this.ram[addr] = data;
    }

    idle(): void {}
}

export interface RomOptions {
    size?: number;
    mapMode?: MapMode;
    mapByte?: number;
    chipset?: number;
    sramByte?: number;
    title?: string;
    // 1 is USA, 2 Europe
    region?: number;
    // Bytes to place at ROM offsets, like code and vectors
    patches?: Record<number, number[]>;
}

const HEADER: Record<MapMode, number> = { LoROM: 0x7FC0, HiROM: 0xFFC0, ExHiROM: 0x40FFC0 };

// A ROM with distinct contents and a valid header, like an assembler would produce
export function buildRom({ size = 0x100000, mapMode = 'LoROM', mapByte = 0x20, chipset = 0x00, sramByte = 0, title = 'TEST ROM', region = 0x01, patches = {} }: RomOptions = {}): Uint8Array {
    const rom = new Uint8Array(size);
    for (let i = 0; i < size; i++) rom[i] = (i * 7 + (i >> 15)) & 0xFF;

    const h = HEADER[mapMode];
    for (let i = 0; i < 21; i++) rom[h + i] = i < title.length ? title.charCodeAt(i) : 0x20;
    rom[h + 0x15] = mapByte;
    rom[h + 0x16] = chipset;
    rom[h + 0x17] = Math.log2(size / 0x400);
    rom[h + 0x18] = sramByte;
    rom[h + 0x19] = region;
    rom[h + 0x1B] = 0x00;
    rom[h + 0x3C] = 0x00;
    rom[h + 0x3D] = 0x80;
    for (const [offset, bytes] of Object.entries(patches)) rom.set(bytes, Number(offset));

    rom[h + 0x1C] = 0xFF;
    rom[h + 0x1D] = 0xFF;
    rom[h + 0x1E] = 0x00;
    rom[h + 0x1F] = 0x00;
    let sum = 0;
    for (const byte of rom) sum = (sum + byte) & 0xFFFF;
    rom[h + 0x1C] = ~sum & 0xFF;
    rom[h + 0x1D] = (~sum >> 8) & 0xFF;
    rom[h + 0x1E] = sum & 0xFF;
    rom[h + 0x1F] = sum >> 8;
    return rom;
}


export const SINGLE_STEP_SPC700_TESTS = new URL('../data/spc700/opcodes.json.gz', import.meta.url);

export interface Spc700State {
    pc: number;
    a: number;
    x: number;
    y: number;
    sp: number;
    psw: number;
    ram: [addr: number, value: number][];
}

export interface Spc700Case {
    name: string;
    initial: Spc700State;
    final: Spc700State;
    cycles: number;
}

// { "00": [cases...], "01": [...], ... } keyed by opcode in hex
export type Spc700Bundle = Record<string, Spc700Case[]>;

import { describe, expect, test } from 'bun:test';
import SnesCartridge, { mirror } from '../../src/systems/snes/core/cartridge';
import { buildRom } from './helpers';

const load = (rom: Uint8Array) => new SnesCartridge(rom.slice().buffer);

describe('SNES cartridge header', () => {
    test('detects a LoROM cartridge', () => {
        const { header } = load(buildRom({ title: 'SUPER TEST' }));
        expect(header.mapMode).toBe('LoROM');
        expect(header.title).toBe('SUPER TEST');
        expect(header.fastRom).toBe(false);
        expect(header.romSize).toBe(0x100000);
        expect(header.coprocessor).toBeNull();
    });

    test('detects a HiROM FastROM cartridge', () => {
        const { header } = load(buildRom({ mapMode: 'HiROM', mapByte: 0x31 }));
        expect(header.mapMode).toBe('HiROM');
        expect(header.fastRom).toBe(true);
    });

    test('detects an ExHiROM cartridge', () => {
        const { header } = load(buildRom({ size: 0x600000, mapMode: 'ExHiROM', mapByte: 0x35 }));
        expect(header.mapMode).toBe('ExHiROM');
    });

    test('skips the header of copier devices', () => {
        const rom = buildRom({ title: 'COPIED' });
        const withHeader = new Uint8Array(rom.length + 512);
        withHeader.set(rom, 512);
        const cartridge = load(withHeader);
        expect(cartridge.header.title).toBe('COPIED');
        expect(cartridge.rom.length).toBe(rom.length);
    });

    test('reads the SRAM size and battery', () => {
        const { header, sram } = load(buildRom({ chipset: 0x02, sramByte: 0x03 }));
        expect(header.sramSize).toBe(0x2000);
        expect(header.battery).toBe(true);
        expect(sram.length).toBe(0x2000);
    });

    test('names enhancement chips', () => {
        expect(load(buildRom({ chipset: 0x15 })).header.coprocessor).toBe('SuperFX');
        expect(load(buildRom({ chipset: 0x35, mapByte: 0x23 })).header.coprocessor).toBe('SA-1');
        expect(load(buildRom({ chipset: 0x03 })).header.coprocessor).toBe('DSP');
    });

    test('rejects files that are not SNES ROMs', () => {
        expect(() => load(new Uint8Array(0x1000))).toThrow('too small');
        expect(() => load(new Uint8Array(0x100000))).toThrow('no valid header');
    });
});

describe('SNES cartridge mapping', () => {
    test('LoROM maps 32 KB per bank in the upper half', () => {
        const rom = buildRom();
        const cartridge = load(rom);
        expect(cartridge.read(0x008000)).toBe(rom[0x0000]);
        expect(cartridge.read(0x01ABCD)).toBe(rom[0x0ABCD]);
        expect(cartridge.read(0x808000)).toBe(rom[0x0000]);
        expect(cartridge.read(0x1FFFFF)).toBe(rom[0x0FFFFF]);
        // Banks $40 and up mirror the upper half into the lower one
        expect(cartridge.read(0x410123)).toBe(rom[(0x41 << 15 | 0x0123) % rom.length]);
        expect(cartridge.read(0x000000)).toBe(-1);
    });

    test('HiROM maps whole banks', () => {
        const rom = buildRom({ mapMode: 'HiROM', mapByte: 0x21 });
        const cartridge = load(rom);
        expect(cartridge.read(0xC00000)).toBe(rom[0x000000]);
        expect(cartridge.read(0xC12345)).toBe(rom[0x012345]);
        expect(cartridge.read(0x418000)).toBe(rom[0x018000]);
        expect(cartridge.read(0x01C000)).toBe(rom[0x01C000]);
        expect(cartridge.read(0x010000)).toBe(-1);
    });

    test('ExHiROM maps the upper 4 MB to banks $40-$7D', () => {
        const rom = buildRom({ size: 0x600000, mapMode: 'ExHiROM', mapByte: 0x35 });
        const cartridge = load(rom);
        expect(cartridge.read(0xC00000)).toBe(rom[0x000000]);
        expect(cartridge.read(0x401234)).toBe(rom[0x401234]);
    });

    test('mirrors ROM sizes that are not a power of two', () => {
        // 3 MB: the 1 MB chip repeats above the 2 MB one
        expect(mirror(0x280000, 0x300000)).toBe(0x280000);
        expect(mirror(0x300000, 0x300000)).toBe(0x200000);
        expect(mirror(0x3FFFFF, 0x300000)).toBe(0x2FFFFF);
        expect(mirror(0x123456, 0x100000)).toBe(0x023456);
    });

    test('LoROM SRAM is at banks $70-$7D, mirrored', () => {
        const cartridge = load(buildRom({ chipset: 0x02, sramByte: 0x03 }));
        expect(cartridge.write(0x700010, 0x42)).toBe(true);
        expect(cartridge.read(0x700010)).toBe(0x42);
        expect(cartridge.read(0x702010)).toBe(0x42);
        expect(cartridge.read(0xF00010)).toBe(0x42);
        expect(cartridge.write(0x600010, 0x42)).toBe(false);
    });

    test('HiROM SRAM is at $6000-$7FFF of banks $20-$3F', () => {
        const cartridge = load(buildRom({ mapMode: 'HiROM', mapByte: 0x21, chipset: 0x02, sramByte: 0x03 }));
        expect(cartridge.write(0x206000, 0x05)).toBe(true);
        expect(cartridge.read(0x306000)).toBe(0x05);
        expect(cartridge.read(0xA06000)).toBe(0x05);
        expect(cartridge.write(0x006000, 0x05)).toBe(false);
    });

    test('ROM is read only', () => {
        const rom = buildRom();
        const cartridge = load(rom);
        expect(cartridge.write(0x008000, 0x99)).toBe(false);
        expect(cartridge.read(0x008000)).toBe(rom[0]);
    });
});

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import Cartridge from '../src/nes/cartridge';
import { buildRom, NESTEST_ROM } from './helpers';

describe('Cartridge', () => {
    test('loads an iNES ROM', () => {
        const cartridge = new Cartridge(readFileSync(NESTEST_ROM));
        expect(cartridge.mapperId).toBe(0);
    });

    test('rejects files that are not iNES ROMs', () => {
        expect(() => new Cartridge(new TextEncoder().encode('<html>Not found</html>'))).toThrow('Not an iNES ROM file');
        expect(() => new Cartridge(new Uint8Array(0))).toThrow('Not an iNES ROM file');
    });

    test('rejects truncated ROMs', () => {
        const rom = buildRom();
        expect(() => new Cartridge(rom.subarray(0, rom.length - 1))).toThrow('ROM file is truncated');
    });

    test('reads the mapper id from the header', () => {
        const rom = buildRom();
        rom[6] = 0x10; // Low nibble of the mapper id
        rom[7] = 0x40; // High nibble
        expect(new Cartridge(rom).mapperId).toBe(0x41);
    });
});

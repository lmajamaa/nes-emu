import { beforeAll, describe, expect, test } from 'bun:test';
import Bus from '../bus';
import Cartridge, { SUPPORTED_MAPPERS } from '../cartridge';
import { MIRROR } from '../constants';
import { buildRom, muteConsole } from '../test-helpers';

beforeAll(muteConsole);

// Every 32KB PRG bank holds its own number at its start and end, with CHR RAM
function createBus(banks = 8): Bus {
    const prg = new Uint8Array(banks * 0x8000);
    for (let bank = 0; bank < banks; bank++) {
        prg[bank * 0x8000] = bank;
        prg[bank * 0x8000 + 0x7FFF] = bank;
    }
    const bus = new Bus();
    bus.insertCartridge(new Cartridge(buildRom({ prg, chr: new Uint8Array(0), mapper: 7 })));
    bus.reset();
    return bus;
}

describe('AxROM (mapper 7)', () => {
    test('is supported', () => {
        expect(SUPPORTED_MAPPERS).toContain(7);
    });

    test('starts with the first 32KB bank', () => {
        const bus = createBus();
        expect([bus.cpuRead(0x8000), bus.cpuRead(0xFFFF)]).toEqual([0, 0]);
    });

    test('a write anywhere in ROM switches all 32KB', () => {
        const bus = createBus();
        bus.cpuWrite(0x8000, 5);
        expect([bus.cpuRead(0x8000), bus.cpuRead(0xFFFF)]).toEqual([5, 5]);
        bus.cpuWrite(0xC123, 2);
        expect(bus.cpuRead(0x8000)).toBe(2);
    });

    test('AOROM uses 4 bits for 16 banks', () => {
        const bus = createBus(16);
        bus.cpuWrite(0x8000, 12);
        expect(bus.cpuRead(0x8000)).toBe(12);
    });

    test('bank numbers past the ROM wrap around', () => {
        const bus = createBus(8);
        bus.cpuWrite(0x8000, 11);
        expect(bus.cpuRead(0x8000)).toBe(3);
    });

    test('bit 4 picks the nametable that every screen area shows', () => {
        const bus = createBus();
        const nametables = () => [0x2000, 0x2400, 0x2800, 0x2C00].map(addr => bus.ppu.ppuRead(addr));

        bus.cpuWrite(0x8000, 0x00);
        [0x2000, 0x2400, 0x2800, 0x2C00].forEach((addr, i) => bus.ppu.ppuWrite(addr, i + 1));
        expect(nametables()).toEqual([4, 4, 4, 4]);

        // The other nametable is separate memory
        bus.cpuWrite(0x8000, 0x10);
        expect(nametables()).toEqual([0, 0, 0, 0]);
        bus.ppu.ppuWrite(0x2C00, 9);
        expect(nametables()).toEqual([9, 9, 9, 9]);

        bus.cpuWrite(0x8000, 0x00);
        expect(nametables()).toEqual([4, 4, 4, 4]);
    });

    test('has 8KB of CHR RAM', () => {
        const bus = createBus();
        bus.ppu.ppuWrite(0x0000, 0x42);
        bus.ppu.ppuWrite(0x1FFF, 0x24);
        expect([bus.ppu.ppuRead(0x0000), bus.ppu.ppuRead(0x1FFF)]).toEqual([0x42, 0x24]);
    });

    test('reset selects bank 0 and the lower nametable', () => {
        const bus = createBus();
        bus.cpuWrite(0x8000, 0x13);
        bus.reset();
        expect(bus.cpuRead(0x8000)).toBe(0);
        expect(bus.cartridge!.mirror).toBe(MIRROR.ONESCREEN_LO);
    });
});

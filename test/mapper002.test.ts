import { beforeAll, describe, expect, test } from 'bun:test';
import Bus from '../src/nes/bus';
import Cartridge, { SUPPORTED_MAPPERS } from '../src/nes/cartridge';
import { buildRom, muteConsole } from './helpers';

beforeAll(muteConsole);

// Every 16KB PRG bank holds its own number at its start and end, with CHR RAM
function createBus(banks = 8): Bus {
    const prg = new Uint8Array(banks * 0x4000);
    for (let bank = 0; bank < banks; bank++) {
        prg[bank * 0x4000] = bank;
        prg[bank * 0x4000 + 0x3FFF] = bank;
    }
    const bus = new Bus();
    bus.insertCartridge(new Cartridge(buildRom({ prg, chr: new Uint8Array(0), mapper: 2 })));
    bus.reset();
    return bus;
}

describe('UxROM (mapper 2)', () => {
    test('is supported', () => {
        expect(SUPPORTED_MAPPERS).toContain(2);
    });

    test('starts with bank 0 at $8000 and the last bank fixed at $C000', () => {
        const bus = createBus();
        expect([bus.cpuRead(0x8000), bus.cpuRead(0xBFFF), bus.cpuRead(0xC000), bus.cpuRead(0xFFFF)]).toEqual([0, 0, 7, 7]);
    });

    test('a write anywhere in ROM switches the bank at $8000', () => {
        const bus = createBus();
        bus.cpuWrite(0x8000, 3);
        expect([bus.cpuRead(0x8000), bus.cpuRead(0xBFFF)]).toEqual([3, 3]);
        bus.cpuWrite(0xFFF0, 5);
        expect(bus.cpuRead(0x8000)).toBe(5);
        expect(bus.cpuRead(0xC000)).toBe(7);
    });

    test('UOROM uses 4 bits for 16 banks', () => {
        const bus = createBus(16);
        bus.cpuWrite(0x8000, 12);
        expect([bus.cpuRead(0x8000), bus.cpuRead(0xC000)]).toEqual([12, 15]);
    });

    test('bank numbers past the ROM wrap around', () => {
        const bus = createBus(8);
        bus.cpuWrite(0x8000, 0x0B);
        expect(bus.cpuRead(0x8000)).toBe(3);
    });

    test('has 8KB of CHR RAM', () => {
        const bus = createBus();
        bus.ppu.ppuWrite(0x0123, 0x42);
        bus.ppu.ppuWrite(0x1FFF, 0x24);
        expect([bus.ppu.ppuRead(0x0123), bus.ppu.ppuRead(0x1FFF)]).toEqual([0x42, 0x24]);
    });

    test('reset selects bank 0 again', () => {
        const bus = createBus();
        bus.cpuWrite(0x8000, 4);
        bus.reset();
        expect(bus.cpuRead(0x8000)).toBe(0);
    });
});

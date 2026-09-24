import { beforeAll, describe, expect, test } from 'bun:test';
import Bus from '../src/nes/bus';
import Cartridge, { SUPPORTED_MAPPERS } from '../src/nes/cartridge';
import { buildRom, muteConsole } from './helpers';

beforeAll(muteConsole);

// Every 8KB CHR bank holds its own number at its start and end, and so do the PRG ROM's halves
function createBus(prgBanks = 2, chrBanks = 4): Bus {
    const prg = new Uint8Array(prgBanks * 0x4000);
    prg[0] = 0x11;
    prg[prg.length - 1] = 0x22;
    const chr = new Uint8Array(chrBanks * 0x2000);
    for (let bank = 0; bank < chrBanks; bank++) {
        chr[bank * 0x2000] = bank;
        chr[bank * 0x2000 + 0x1FFF] = bank;
    }
    const bus = new Bus();
    bus.insertCartridge(new Cartridge(buildRom({ prg, chr, mapper: 3 })));
    bus.reset();
    return bus;
}

describe('CNROM (mapper 3)', () => {
    test('is supported', () => {
        expect(SUPPORTED_MAPPERS).toContain(3);
    });

    test('maps 32KB of PRG ROM, or 16KB in both halves', () => {
        const bus = createBus(2);
        expect([bus.cpuRead(0x8000), bus.cpuRead(0xFFFF)]).toEqual([0x11, 0x22]);
        const small = createBus(1);
        expect([small.cpuRead(0x8000), small.cpuRead(0xC000), small.cpuRead(0xFFFF)]).toEqual([0x11, 0x11, 0x22]);
    });

    test('starts with CHR bank 0', () => {
        const bus = createBus();
        expect([bus.ppu.ppuRead(0x0000), bus.ppu.ppuRead(0x1FFF)]).toEqual([0, 0]);
    });

    test('a write anywhere in ROM switches the whole 8KB of CHR', () => {
        const bus = createBus();
        bus.cpuWrite(0x8000, 2);
        expect([bus.ppu.ppuRead(0x0000), bus.ppu.ppuRead(0x1FFF)]).toEqual([2, 2]);
        bus.cpuWrite(0xFFFF, 3);
        expect(bus.ppu.ppuRead(0x0000)).toBe(3);
    });

    test('bank numbers past the ROM wrap around', () => {
        const bus = createBus(2, 4);
        bus.cpuWrite(0x8000, 6);
        expect(bus.ppu.ppuRead(0x0000)).toBe(2);
    });

    test('CHR ROM and PRG ROM can not be written', () => {
        const bus = createBus();
        bus.ppu.ppuWrite(0x0000, 0x99);
        expect(bus.ppu.ppuRead(0x0000)).toBe(0);
        bus.cpuWrite(0x8000, 0);
        expect(bus.cpuRead(0x8000)).toBe(0x11);
    });

    test('reset selects bank 0 again', () => {
        const bus = createBus();
        bus.cpuWrite(0x8000, 1);
        bus.reset();
        expect(bus.ppu.ppuRead(0x0000)).toBe(0);
    });
});

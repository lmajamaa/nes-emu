import { beforeAll, describe, expect, test } from 'bun:test';
import Bus from '../src/nes/bus';
import Cartridge from '../src/nes/cartridge';
import { MIRROR } from '../src/nes/constants';
import { buildRom, muteConsole } from './helpers';

const PRG_BANK = 0xA000;
const CHR_0_FD = 0xB000;
const CHR_0_FE = 0xC000;
const CHR_1_FD = 0xD000;
const CHR_1_FE = 0xE000;
const MIRRORING = 0xF000;

const PRG_8K_BANKS = 16;
const CHR_4K_BANKS = 32;

beforeAll(muteConsole);

// Every 8KB PRG bank, and every 4KB CHR bank at the start and at the latch trigger addresses,
// holds its own number
function createBus(): Bus {
    const prg = new Uint8Array(PRG_8K_BANKS * 0x2000);
    for (let bank = 0; bank < PRG_8K_BANKS; bank++) prg[bank * 0x2000] = bank;
    const chr = new Uint8Array(CHR_4K_BANKS * 0x1000);
    for (let bank = 0; bank < CHR_4K_BANKS; bank++) {
        for (const offset of [0x0000, 0x0FD8, 0x0FE8]) chr[bank * 0x1000 + offset] = bank;
    }

    const bus = new Bus();
    bus.insertCartridge(new Cartridge(buildRom({ prg, chr, mapper: 9 })));
    bus.reset();
    // Different banks for each latch value
    bus.cpuWrite(CHR_0_FD, 1);
    bus.cpuWrite(CHR_0_FE, 2);
    bus.cpuWrite(CHR_1_FD, 3);
    bus.cpuWrite(CHR_1_FE, 4);
    return bus;
}

// A read by the PPU itself, which the latches react to
const fetch = (bus: Bus, addr: number) => bus.ppu.ppuRead(addr);

describe('MMC2 PRG banking', () => {
    test('$8000 is switchable and the last three banks are fixed', () => {
        const bus = createBus();
        bus.cpuWrite(PRG_BANK, 5);
        expect([0x8000, 0xA000, 0xC000, 0xE000].map(addr => bus.cpuRead(addr))).toEqual([5, 13, 14, 15]);
    });

    test('writes do not modify PRG ROM', () => {
        const bus = createBus();
        bus.cpuWrite(0x8000, 0xAB);
        expect(bus.cpuRead(0x8000)).toBe(0);
    });
});

describe('MMC2 CHR latches', () => {
    test('both start with $FE', () => {
        const bus = createBus();
        expect(fetch(bus, 0x0000)).toBe(2);
        expect(fetch(bus, 0x1000)).toBe(4);
    });

    test('fetching $0FD8 and $0FE8 switch the bank of pattern table 0, after that fetch', () => {
        const bus = createBus();
        expect(fetch(bus, 0x0FD8)).toBe(2);
        expect(fetch(bus, 0x0000)).toBe(1);
        expect(fetch(bus, 0x1000)).toBe(4);

        expect(fetch(bus, 0x0FE8)).toBe(1);
        expect(fetch(bus, 0x0000)).toBe(2);
    });

    test('pattern table 0 only reacts to the exact addresses', () => {
        const bus = createBus();
        fetch(bus, 0x0FD9);
        expect(fetch(bus, 0x0000)).toBe(2);
    });

    test('pattern table 1 reacts to the whole row ranges $1FD8-$1FDF and $1FE8-$1FEF', () => {
        const bus = createBus();
        fetch(bus, 0x1FDD);
        expect(fetch(bus, 0x1000)).toBe(3);
        expect(fetch(bus, 0x0000)).toBe(2);

        fetch(bus, 0x1FEF);
        expect(fetch(bus, 0x1000)).toBe(4);
    });

    test('are not changed by debugger reads', () => {
        const bus = createBus();
        bus.ppu.ppuRead(0x0FD8, true);
        expect(fetch(bus, 0x0000)).toBe(2);
    });
});

describe('MMC2 mirroring', () => {
    test('is selected by $F000', () => {
        const bus = createBus();
        bus.cpuWrite(MIRRORING, 0);
        expect(bus.cartridge!.mirror).toBe(MIRROR.VERTICAL);
        bus.cpuWrite(MIRRORING, 1);
        expect(bus.cartridge!.mirror).toBe(MIRROR.HORIZONTAL);
    });
});

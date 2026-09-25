import { beforeAll, describe, expect, test } from 'bun:test';
import Bus from '../bus';
import Cartridge from '../cartridge';
import { MIRROR } from '../constants';
import { runBlarggTest } from '../test-blargg';
import { BLARGG_INSTR_ROM, buildRom, muteConsole } from '../test-helpers';

const CONTROL = 0x8000;
const CHR_BANK_0 = 0xA000;
const CHR_BANK_1 = 0xC000;
const PRG_BANK = 0xE000;

beforeAll(muteConsole);

// Every 16KB PRG bank and 4KB CHR bank starts with its own number
function createBus({ prgBanks = 8, chrBanks = 4 } = {}): Bus {
    const prg = new Uint8Array(prgBanks * 0x4000);
    for (let bank = 0; bank < prgBanks; bank++) prg[bank * 0x4000] = bank;
    const chr = new Uint8Array(chrBanks * 0x1000);
    for (let bank = 0; bank < chrBanks; bank++) chr[bank * 0x1000] = bank;

    const bus = new Bus();
    bus.insertCartridge(new Cartridge(buildRom({ prg, chr, mapper: 1 })));
    return bus;
}

// Loads a register through the serial port: five writes, LSB first
function writeRegister(bus: Bus, register: number, value: number): void {
    for (let bit = 0; bit < 5; bit++) {
        bus.cpuWrite(register, (value >> bit) & 0x01);
    }
}

const prgBankAt = (bus: Bus, addr: number) => bus.cpuRead(addr);
const chrBankAt = (bus: Bus, addr: number) => bus.ppu.ppuRead(addr);

describe('MMC1 PRG banking', () => {
    test('starts with $8000 switchable and $C000 fixed to the last bank', () => {
        const bus = createBus();
        expect(prgBankAt(bus, 0x8000)).toBe(0);
        expect(prgBankAt(bus, 0xC000)).toBe(7);

        writeRegister(bus, PRG_BANK, 5);
        expect(prgBankAt(bus, 0x8000)).toBe(5);
        expect(prgBankAt(bus, 0xC000)).toBe(7);
    });

    test('mode 2 fixes the first bank at $8000 and switches $C000', () => {
        const bus = createBus();
        writeRegister(bus, CONTROL, 0x08);
        writeRegister(bus, PRG_BANK, 5);
        expect(prgBankAt(bus, 0x8000)).toBe(0);
        expect(prgBankAt(bus, 0xC000)).toBe(5);
    });

    test('32KB mode switches both halves together, ignoring the low bit', () => {
        const bus = createBus();
        writeRegister(bus, CONTROL, 0x00);
        writeRegister(bus, PRG_BANK, 5);
        expect(prgBankAt(bus, 0x8000)).toBe(4);
        expect(prgBankAt(bus, 0xC000)).toBe(5);
    });

    test('the register is selected by the address of the fifth write', () => {
        const bus = createBus();
        for (let bit = 0; bit < 4; bit++) bus.cpuWrite(0x8000, (3 >> bit) & 0x01);
        bus.cpuWrite(0xFFFF, 0);
        expect(prgBankAt(bus, 0x8000)).toBe(3);
    });

    test('writing bit 7 resets the shift register and the PRG mode', () => {
        const bus = createBus();
        writeRegister(bus, CONTROL, 0x08);
        bus.cpuWrite(PRG_BANK, 1);
        bus.cpuWrite(PRG_BANK, 1);
        bus.cpuWrite(PRG_BANK, 0x80);
        writeRegister(bus, PRG_BANK, 2);
        expect(prgBankAt(bus, 0x8000)).toBe(2);
        expect(prgBankAt(bus, 0xC000)).toBe(7);
    });

    test('512KB boards select the 256KB half with bit 4 of CHR bank 0', () => {
        const bus = createBus({ prgBanks: 32, chrBanks: 0 });
        expect(prgBankAt(bus, 0xC000)).toBe(15);
        writeRegister(bus, CHR_BANK_0, 0x10);
        writeRegister(bus, PRG_BANK, 2);
        expect(prgBankAt(bus, 0x8000)).toBe(18);
        expect(prgBankAt(bus, 0xC000)).toBe(31);
    });

    test('writes do not modify PRG ROM', () => {
        const bus = createBus();
        bus.cpuWrite(0x8000, 0x80);
        expect(prgBankAt(bus, 0x8000)).toBe(0);
    });
});

describe('MMC1 CHR banking', () => {
    test('8KB mode switches both pattern tables together, ignoring the low bit', () => {
        const bus = createBus();
        writeRegister(bus, CHR_BANK_0, 3);
        expect(chrBankAt(bus, 0x0000)).toBe(2);
        expect(chrBankAt(bus, 0x1000)).toBe(3);
    });

    test('4KB mode switches the pattern tables separately', () => {
        const bus = createBus();
        writeRegister(bus, CONTROL, 0x1C);
        writeRegister(bus, CHR_BANK_0, 3);
        writeRegister(bus, CHR_BANK_1, 1);
        expect(chrBankAt(bus, 0x0000)).toBe(3);
        expect(chrBankAt(bus, 0x1000)).toBe(1);
    });

    test('boards without CHR ROM have writable CHR RAM', () => {
        const bus = createBus({ chrBanks: 0 });
        bus.ppu.ppuWrite(0x0123, 0xAB);
        bus.ppu.ppuWrite(0x1123, 0xCD);
        expect(bus.ppu.ppuRead(0x0123)).toBe(0xAB);
        expect(bus.ppu.ppuRead(0x1123)).toBe(0xCD);
    });

    test('CHR ROM is not writable', () => {
        const bus = createBus();
        bus.ppu.ppuWrite(0x0000, 0xAB);
        expect(chrBankAt(bus, 0x0000)).toBe(0);
    });
});

describe('MMC1 mirroring', () => {
    test.each([
        [0, MIRROR.ONESCREEN_LO],
        [1, MIRROR.ONESCREEN_HI],
        [2, MIRROR.VERTICAL],
        [3, MIRROR.HORIZONTAL],
    ])('control %i selects mirroring %i', (mode, mirror) => {
        const bus = createBus();
        writeRegister(bus, CONTROL, 0x0C | mode);
        expect(bus.cartridge!.mirror).toBe(mirror);
    });

    // Writes a different value to each of the four nametables, and reads back what survived
    function nametablesWith(mode: number): number[] {
        const bus = createBus();
        writeRegister(bus, CONTROL, 0x0C | mode);
        [0x2000, 0x2400, 0x2800, 0x2C00].forEach((addr, i) => bus.ppu.ppuWrite(addr, i + 1));
        return [0x2000, 0x2400, 0x2800, 0x2C00].map(addr => bus.ppu.ppuRead(addr));
    }

    test('the PPU follows the mirroring', () => {
        expect(nametablesWith(0)).toEqual([4, 4, 4, 4]);
        expect(nametablesWith(1)).toEqual([4, 4, 4, 4]);
        expect(nametablesWith(2)).toEqual([3, 4, 3, 4]);
        expect(nametablesWith(3)).toEqual([2, 2, 4, 4]);
    });

    test('one-screen modes use different nametables', () => {
        const bus = createBus();
        writeRegister(bus, CONTROL, 0x0C);
        bus.ppu.ppuWrite(0x2000, 0x11);
        writeRegister(bus, CONTROL, 0x0D);
        bus.ppu.ppuWrite(0x2000, 0x22);
        writeRegister(bus, CONTROL, 0x0C);
        expect(bus.ppu.ppuRead(0x2000)).toBe(0x11);
    });
});

describe('blargg instr_test-v5 on MMC1', () => {
    // Switches between its 16 tests with MMC1, and runs every official and unofficial instruction.
    // Takes about 10 seconds, so it only runs with SLOW_TESTS=1
    test.skipIf(!process.env.SLOW_TESTS)('all_instrs.nes passes', () => {
        expect(runBlarggTest(BLARGG_INSTR_ROM, 60 * 60)).toEqual({ status: 0, text: 'All 16 tests passed' });
    }, 60000);
});

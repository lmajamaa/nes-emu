import { beforeAll, describe, expect, test } from 'bun:test';
import Bus from '../src/nes/bus';
import Cartridge from '../src/nes/cartridge';
import { MIRROR } from '../src/nes/constants';
import { buildRom, muteConsole, runFrames } from './helpers';

const BANK_SELECT = 0x8000;
const BANK_DATA = 0x8001;
const MIRRORING = 0xA000;
const IRQ_LATCH = 0xC000;
const IRQ_RELOAD = 0xC001;
const IRQ_DISABLE = 0xE000;
const IRQ_ENABLE = 0xE001;

const PRG_8K_BANKS = 16;
const CHR_1K_BANKS = 16;

beforeAll(muteConsole);

// Every 8KB PRG bank and 1KB CHR bank starts with its own number
function createBus(program?: (prg: Uint8Array) => void): Bus {
    const prg = new Uint8Array(PRG_8K_BANKS * 0x2000);
    for (let bank = 0; bank < PRG_8K_BANKS; bank++) prg[bank * 0x2000] = bank;
    program?.(prg);
    const chr = new Uint8Array(CHR_1K_BANKS * 0x0400);
    for (let bank = 0; bank < CHR_1K_BANKS; bank++) chr[bank * 0x0400] = bank;

    const bus = new Bus();
    bus.insertCartridge(new Cartridge(buildRom({ prg, chr, mapper: 4 })));
    bus.reset();
    return bus;
}

function setBank(bus: Bus, register: number, bank: number, bankSelect = 0): void {
    bus.cpuWrite(BANK_SELECT, bankSelect | register);
    bus.cpuWrite(BANK_DATA, bank);
}

const prgBankAt = (bus: Bus, addr: number) => bus.cpuRead(addr);
const chrBankAt = (bus: Bus, addr: number) => bus.ppu.ppuRead(addr);

describe('MMC3 PRG banking', () => {
    test('R6 and R7 select $8000 and $A000, the last two banks are fixed at $C000 and $E000', () => {
        const bus = createBus();
        setBank(bus, 6, 3);
        setBank(bus, 7, 5);
        expect([0x8000, 0xA000, 0xC000, 0xE000].map(addr => prgBankAt(bus, addr))).toEqual([3, 5, 14, 15]);
    });

    test('bit 6 of bank select swaps $8000 and $C000', () => {
        const bus = createBus();
        setBank(bus, 6, 3, 0x40);
        setBank(bus, 7, 5, 0x40);
        expect([0x8000, 0xA000, 0xC000, 0xE000].map(addr => prgBankAt(bus, addr))).toEqual([14, 5, 3, 15]);
    });

    test('writes do not modify PRG ROM', () => {
        const bus = createBus();
        bus.cpuWrite(0xE000, 0xAB);
        expect(prgBankAt(bus, 0xE000)).toBe(15);
    });
});

describe('MMC3 CHR banking', () => {
    const CHR_ADDRESSES = [0x0000, 0x0400, 0x0800, 0x0C00, 0x1000, 0x1400, 0x1800, 0x1C00];

    function chrBanks(bankSelect: number): number[] {
        const bus = createBus();
        // R0 and R1 are 2KB banks, so their low bit is ignored
        [5, 9, 1, 2, 3, 4].forEach((bank, register) => setBank(bus, register, bank, bankSelect));
        return CHR_ADDRESSES.map(addr => chrBankAt(bus, addr));
    }

    test('R0-R1 select 2KB banks at $0000, R2-R5 1KB banks at $1000', () => {
        expect(chrBanks(0x00)).toEqual([4, 5, 8, 9, 1, 2, 3, 4]);
    });

    test('bit 7 of bank select swaps the two halves', () => {
        expect(chrBanks(0x80)).toEqual([1, 2, 3, 4, 4, 5, 8, 9]);
    });
});

describe('MMC3 mirroring', () => {
    test('is selected by $A000', () => {
        const bus = createBus();
        bus.cpuWrite(MIRRORING, 0);
        expect(bus.cartridge!.mirror).toBe(MIRROR.VERTICAL);
        bus.cpuWrite(MIRRORING, 1);
        expect(bus.cartridge!.mirror).toBe(MIRROR.HORIZONTAL);
    });
});

describe('MMC3 scanline IRQ', () => {
    // PPU cycles, only needs to keep increasing
    let time = 0;

    // Raises PPU address line A12 after it has been low long enough to count
    function clockScanlines(bus: Bus, count: number): boolean[] {
        return Array.from({ length: count }, () => {
            bus.cartridge!.ppuAddress(0x0000, time += 20);
            bus.cartridge!.ppuAddress(0x1000, time += 20);
            return bus.cartridge!.irq;
        });
    }

    test('fires when the counter reaches 0, after reloading from the latch', () => {
        const bus = createBus();
        bus.cpuWrite(IRQ_LATCH, 3);
        bus.cpuWrite(IRQ_RELOAD, 0);
        bus.cpuWrite(IRQ_ENABLE, 0);
        // Reload to 3, then 2, 1, 0
        expect(clockScanlines(bus, 4)).toEqual([false, false, false, true]);
    });

    test('is acknowledged and disabled by $E000', () => {
        const bus = createBus();
        bus.cpuWrite(IRQ_LATCH, 1);
        bus.cpuWrite(IRQ_ENABLE, 0);
        clockScanlines(bus, 2);
        expect(bus.cartridge!.irq).toBe(true);

        bus.cpuWrite(IRQ_DISABLE, 0);
        expect(bus.cartridge!.irq).toBe(false);
        expect(clockScanlines(bus, 4)).toEqual([false, false, false, false]);
    });

    test('a latch of 0 fires on every scanline', () => {
        const bus = createBus();
        bus.cpuWrite(IRQ_LATCH, 0);
        bus.cpuWrite(IRQ_ENABLE, 0);
        expect(clockScanlines(bus, 3)).toEqual([true, true, true]);
    });

    test('ignores A12 rising again soon after falling, like between sprite fetches', () => {
        const bus = createBus();
        bus.cpuWrite(IRQ_LATCH, 0);
        bus.cpuWrite(IRQ_ENABLE, 0);
        expect(clockScanlines(bus, 1)).toEqual([true]);
        bus.cpuWrite(IRQ_DISABLE, 0);
        bus.cpuWrite(IRQ_ENABLE, 0);

        bus.cartridge!.ppuAddress(0x0000, time += 4);
        bus.cartridge!.ppuAddress(0x1000, time += 4);
        expect(bus.cartridge!.irq).toBe(false);
    });

    // Rendering raises A12 once per scanline when the background and sprites use different pattern tables
    test.each([
        ['sprites', 0x08],
        ['the background', 0x10],
    ])('interrupts the CPU, with %s using pattern table 1', (_name, ppuCtrl) => {
        const bus = createBus(prg => {
            // The program lives in the last bank, which is fixed at $E000
            const last = (PRG_8K_BANKS - 1) * 0x2000;
            prg.set([
                0xA9, 0x40,       // LDA #$40
                0x8D, 0x17, 0x40, // STA $4017: no APU frame IRQ
                0xA9, 0x09,       // LDA #$09
                0x8D, 0x00, 0xC0, // STA $C000: IRQ every 10 scanlines
                0x8D, 0x01, 0xC0, // STA $C001
                0x8D, 0x01, 0xE0, // STA $E001: enable
                0xA9, ppuCtrl,    // LDA #ppuCtrl
                0x8D, 0x00, 0x20, // STA $2000
                0xA9, 0x18,       // LDA #$18
                0x8D, 0x01, 0x20, // STA $2001: rendering on
                0x58,             // CLI
                0x4C, 0x1B, 0xE0, // JMP $E01B
            ], last);
            prg.set([
                0xE6, 0x00,       // INC $00
                0x8D, 0x00, 0xE0, // STA $E000: acknowledge
                0x8D, 0x01, 0xE0, // STA $E001: enable again
                0x40,             // RTI
            ], last + 0x20);
            prg.set([0x28, 0xE0, 0x00, 0xE0, 0x20, 0xE0], last + 0x1FFA); // NMI (unused), reset, IRQ
        });
        runFrames(bus, 1);
        bus.cpuRam[0x00] = 0;
        runFrames(bus, 10);
        // 241 counted scanlines per frame
        expect(bus.cpuRam[0x00]).toBeGreaterThanOrEqual(240);
        expect(bus.cpuRam[0x00]).toBeLessThanOrEqual(242);
    });
});

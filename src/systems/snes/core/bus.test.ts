import { describe, expect, test } from 'bun:test';
import SnesBus, { accessCycles } from './bus';
import SnesCartridge from './cartridge';
import { buildRom } from './test-helpers';

function busWithRom() {
    const rom = buildRom();
    const bus = new SnesBus();
    bus.cartridge = new SnesCartridge(rom.slice().buffer);
    return { bus, rom };
}

function cyclesOf(bus: SnesBus, access: () => void): number {
    const start = bus.cycles;
    access();
    return bus.cycles - start;
}

describe('SNES memory map', () => {
    test('work RAM: banks $7E-$7F, and the first 8 KB in the system banks', () => {
        const bus = new SnesBus();
        bus.write(0x7E0010, 0x42);
        expect(bus.read(0x000010)).toBe(0x42);
        expect(bus.read(0x3F0010)).toBe(0x42);
        expect(bus.read(0x800010)).toBe(0x42);
        expect(bus.read(0x7F0010)).toBe(0x00);
        bus.write(0x001FFF, 0x55);
        expect(bus.read(0x7E1FFF)).toBe(0x55);
        expect(bus.read(0x7E2000)).toBe(0x00);
    });

    test('cartridge ROM', () => {
        const { bus, rom } = busWithRom();
        expect(bus.read(0x008000)).toBe(rom[0]);
        expect(bus.read(0x808123)).toBe(rom[0x123]);
    });

    test('unmapped addresses read the last value on the bus', () => {
        const bus = new SnesBus();
        bus.write(0x7E0000, 0xAB);
        bus.read(0x7E0000);
        expect(bus.read(0x003000)).toBe(0xAB);
        expect(bus.read(0x005000)).toBe(0xAB);
    });

    test('the work RAM port increments its 17-bit address', () => {
        const bus = new SnesBus();
        bus.write(0x002181, 0xFF);
        bus.write(0x002182, 0xFF);
        bus.write(0x002183, 0x01);
        bus.write(0x002180, 0x11);
        bus.write(0x002180, 0x22);
        expect(bus.wram[0x1FFFF]).toBe(0x11);
        expect(bus.wram[0x00000]).toBe(0x22);
        bus.write(0x002181, 0xFF);
        bus.write(0x002182, 0xFF);
        bus.write(0x002183, 0x01);
        expect(bus.read(0x002180)).toBe(0x11);
        expect(bus.read(0x002180)).toBe(0x22);
    });

    test('APU ports are separate in each direction', () => {
        const bus = new SnesBus();
        bus.reset();
        bus.write(0x002140, 0x12);
        expect(bus.apu.inputs[0]).toBe(0x12);
        bus.apu.outputs[1] = 0xBB;
        expect(bus.read(0x002141)).toBe(0xBB);
        // Mirrored up to $217F
        expect(bus.read(0x00217D)).toBe(0xBB);
    });

    test('CPU registers are reached through the bus', () => {
        const bus = new SnesBus();
        bus.write(0x004202, 12);
        bus.write(0x804203, 12);
        expect(bus.read(0x004216)).toBe(144);
    });
});

describe('SNES memory speed', () => {
    test('depends on the region', () => {
        expect(accessCycles(0x7E0000, 8)).toBe(8);
        expect(accessCycles(0x000000, 8)).toBe(8);
        expect(accessCycles(0x002100, 8)).toBe(6);
        expect(accessCycles(0x004016, 8)).toBe(12);
        expect(accessCycles(0x004200, 8)).toBe(6);
        expect(accessCycles(0x006000, 8)).toBe(8);
        expect(accessCycles(0x008000, 8)).toBe(8);
        expect(accessCycles(0x400000, 8)).toBe(8);
    });

    test('FastROM speeds up banks $80-$FF once enabled with MEMSEL', () => {
        const { bus } = busWithRom();
        expect(cyclesOf(bus, () => bus.read(0x808000))).toBe(8);
        bus.write(0x00420D, 0x01);
        expect(cyclesOf(bus, () => bus.read(0x808000))).toBe(6);
        expect(cyclesOf(bus, () => bus.read(0xC00000))).toBe(6);
        expect(cyclesOf(bus, () => bus.read(0x008000))).toBe(8);
    });

    test('internal CPU cycles take 6 master cycles', () => {
        const bus = new SnesBus();
        expect(cyclesOf(bus, () => bus.idle())).toBe(6);
    });
});

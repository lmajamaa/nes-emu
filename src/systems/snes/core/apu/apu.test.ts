import { describe, expect, test } from 'bun:test';
import Apu from './apu';
import SnesBus from '../bus';

// Master cycles for a number of SPC700 cycles, rounded up
const spcCycles = (cycles: number) => Math.ceil(cycles * 21_477_272 / (24_606_720 / 24));

// The main CPU's side of the IPL upload protocol, through the bus, which catches the APU up
function upload(bus: SnesBus, address: number, program: number[], entry = address): void {
    const port = (i: number) => bus.read(0x2140 + i);
    const waitFor = (i: number, value: number) => {
        for (let tries = 0; port(i) !== value; tries++) {
            if (tries > 100_000) throw new Error(`Port ${i} never became ${value}`);
        }
    };
    waitFor(0, 0xAA);
    waitFor(1, 0xBB);
    bus.write(0x2142, address & 0xFF);
    bus.write(0x2143, address >> 8);
    bus.write(0x2141, 0x01);
    bus.write(0x2140, 0xCC);
    waitFor(0, 0xCC);
    program.forEach((byte, i) => {
        bus.write(0x2141, byte);
        bus.write(0x2140, i & 0xFF);
        waitFor(0, i & 0xFF);
    });
    // A zero in port 1 starts the program at the address in ports 2 and 3
    bus.write(0x2142, entry & 0xFF);
    bus.write(0x2143, entry >> 8);
    bus.write(0x2141, 0x00);
    bus.write(0x2140, (program.length + 1) & 0xFF);
    waitFor(0, (program.length + 1) & 0xFF);
}

function bootedBus(): SnesBus {
    const bus = new SnesBus();
    bus.reset();
    return bus;
}

describe('SNES APU', () => {
    test('the IPL says it is ready with $AA $BB', () => {
        const apu = new Apu();
        apu.reset();
        // It clears the direct page first, about 2400 cycles
        apu.catchUp(spcCycles(5000));
        expect([apu.cpuRead(0), apu.cpuRead(1)]).toEqual([0xAA, 0xBB]);
    });

    test('runs a program uploaded through the IPL', () => {
        const bus = bootedBus();
        // MOV $F5,#$42 ; MOV A,$F4 ; MOV $F6,A ; BRA -2
        upload(bus, 0x0300, [0x8F, 0x42, 0xF5, 0xE4, 0xF4, 0xC4, 0xF6, 0x2F, 0xFE]);
        for (let i = 0; i < 100; i++) bus.idle();
        expect(bus.read(0x2141)).toBe(0x42);
        expect(bus.apu.ram[0x0300]).toBe(0x8F);
    });

    test('timers count at their rate up to the target, and clear on read', () => {
        const apu = new Apu();
        apu.reset();
        // Timer 0 (8 kHz, every 128 cycles) with a target of 4, keeping the IPL mapped
        apu.write(0xFA, 4);
        apu.write(0xF1, 0x81);
        apu.catchUp(spcCycles(128 * 4 + 64));
        expect(apu.read(0xFD)).toBe(1);
        expect(apu.read(0xFD)).toBe(0);
        // Timer 2 counts 8 times faster
        apu.write(0xFC, 4);
        apu.write(0xF1, 0x84);
        apu.catchUp(spcCycles(128 * 4 + 64) + spcCycles(16 * 4 * 3));
        expect(apu.read(0xFF)).toBe(3);
    });

    test('CONTROL clears the input ports and unmaps the IPL', () => {
        const apu = new Apu();
        apu.reset();
        apu.cpuWrite(0, 0x12);
        apu.cpuWrite(2, 0x34);
        apu.write(0xF1, 0x90);
        expect([apu.read(0xF4), apu.read(0xF6)]).toEqual([0x00, 0x34]);
        expect(apu.read(0xFFC0)).toBe(0xCD);
        apu.ram[0xFFC0] = 0x55;
        apu.write(0xF1, 0x00);
        expect(apu.read(0xFFC0)).toBe(0x55);
    });

    test('writes go to RAM under the registers too', () => {
        const apu = new Apu();
        apu.reset();
        apu.write(0xF4, 0x99);
        expect(apu.cpuRead(0)).toBe(0x99);
        expect(apu.ram[0xF4]).toBe(0x99);
    });

    test('the DSP registers are reached through $F2 and $F3', () => {
        const apu = new Apu();
        apu.reset();
        apu.write(0xF2, 0x0C);
        apu.write(0xF3, 0x7F);
        expect(apu.dsp.read(0x0C)).toBe(0x7F);
        expect(apu.read(0xF3)).toBe(0x7F);
        // $80-$FF only mirror for reading
        apu.write(0xF2, 0x8C);
        apu.write(0xF3, 0x11);
        expect(apu.dsp.read(0x0C)).toBe(0x7F);
    });
});

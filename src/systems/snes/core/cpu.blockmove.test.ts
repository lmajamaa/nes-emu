import { describe, expect, test } from 'bun:test';
import Cpu65816 from './cpu';
import { FlatBus24 } from './test-helpers';

const PROGRAM = 0x008000;

function setup(opcode: number, count: number, x: number, y: number, indexes16 = true) {
    const bus = new FlatBus24();
    const cpu = new Cpu65816(bus);
    cpu.e = false;
    cpu.setP(indexes16 ? 0x00 : 0x10);
    cpu.pc = PROGRAM;
    cpu.a = count - 1;
    cpu.x = x;
    cpu.y = y;
    // MVN/MVP destination bank, source bank
    bus.ram.set([opcode, 0x02, 0x01], PROGRAM);
    for (let i = 0; i < 0x100; i++) bus.ram[0x010000 + i] = 0x80 + i;
    return { bus, cpu };
}

function run(cpu: Cpu65816): number {
    let cycles = 0;
    do { cycles += cpu.step(); } while (cpu.pc === PROGRAM);
    return cycles;
}

describe('65816 block moves', () => {
    test('MVN copies upwards, one byte every 7 cycles', () => {
        const { bus, cpu } = setup(0x54, 4, 0x0010, 0x0020);
        expect(run(cpu)).toBe(4 * 7);
        expect([...bus.ram.subarray(0x020020, 0x020024)]).toEqual([0x90, 0x91, 0x92, 0x93]);
        expect(cpu.a).toBe(0xFFFF);
        expect(cpu.x).toBe(0x0014);
        expect(cpu.y).toBe(0x0024);
        expect(cpu.dbr).toBe(0x02);
        expect(cpu.pc).toBe(PROGRAM + 3);
    });

    test('MVP copies downwards', () => {
        const { bus, cpu } = setup(0x44, 3, 0x0012, 0x0022);
        run(cpu);
        expect([...bus.ram.subarray(0x020020, 0x020023)]).toEqual([0x90, 0x91, 0x92]);
        expect(cpu.x).toBe(0x000F);
        expect(cpu.y).toBe(0x001F);
    });

    test('8-bit index registers wrap within the page', () => {
        const { cpu } = setup(0x54, 2, 0x00FF, 0x00FF, false);
        run(cpu);
        expect(cpu.x).toBe(0x0001);
        expect(cpu.y).toBe(0x0001);
    });
});

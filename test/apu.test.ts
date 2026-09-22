import { beforeAll, describe, expect, test } from 'bun:test';
import Apu, { CPU_CLOCK_NTSC } from '../src/nes/apu';
import Bus from '../src/nes/bus';
import Cartridge from '../src/nes/cartridge';
import { buildRom, muteConsole, runFrames } from './helpers';

beforeAll(muteConsole);

// CPU cycles after the frame counter (re)starts, in 4-step mode
const QUARTER_FRAME = 7457;
const HALF_FRAME = 14913;
const FRAME_IRQ = 29828;
const SECOND_HALF_FRAME = 29829;

function clock(apu: Apu, cycles: number): void {
    for (let i = 0; i < cycles; i++) apu.clock();
}

function createApu(memory: Record<number, number> = {}): Apu {
    const apu = new Apu(addr => memory[addr] ?? 0, 48000);
    apu.reset();
    // Reset writes $4017, and the frame counter only restarts 3 cycles later
    clock(apu, 3);
    return apu;
}

// CPU cycles between the output going from 0 to non-zero, which happens once per waveform
function measurePeriod(apu: Apu, output: () => number, maxCycles = 100000): number {
    const edges: number[] = [];
    let previous = output();
    for (let cycle = 0; cycle < maxCycles && edges.length < 3; cycle++) {
        apu.clock();
        const value = output();
        if (previous === 0 && value > 0) edges.push(cycle);
        previous = value;
    }
    return edges[2] - edges[1];
}

// The highest output over a window, which for a square wave is its volume
function maxOutput(apu: Apu, output: () => number, cycles: number): number {
    let max = 0;
    for (let i = 0; i < cycles; i++) {
        apu.clock();
        max = Math.max(max, output());
    }
    return max;
}

describe('length counter', () => {
    test('is loaded from the table when the channel is enabled', () => {
        const apu = createApu();
        apu.cpuWrite(0x4015, 0x01);
        apu.cpuWrite(0x4003, 0x08); // Index 1: 254
        expect(apu.pulse1.length.value).toBe(254);
        expect(apu.cpuRead(0x4015) & 0x01).toBe(0x01);
    });

    test('is not loaded while the channel is disabled, and disabling clears it', () => {
        const apu = createApu();
        apu.cpuWrite(0x4003, 0x08);
        expect(apu.pulse1.length.value).toBe(0);

        apu.cpuWrite(0x4015, 0x01);
        apu.cpuWrite(0x4003, 0x08);
        apu.cpuWrite(0x4015, 0x00);
        expect(apu.pulse1.length.value).toBe(0);
    });

    test('counts down on half frames unless halted', () => {
        const apu = createApu();
        apu.cpuWrite(0x4015, 0x03);
        apu.cpuWrite(0x4003, 0x18); // Index 3: 2
        apu.cpuWrite(0x4004, 0x20); // Pulse 2 halted
        apu.cpuWrite(0x4007, 0x18);

        clock(apu, HALF_FRAME - 1);
        expect(apu.pulse1.length.value).toBe(2);
        clock(apu, 1);
        expect(apu.pulse1.length.value).toBe(1);
        clock(apu, SECOND_HALF_FRAME - HALF_FRAME);
        expect(apu.pulse1.length.value).toBe(0);
        expect(apu.pulse2.length.value).toBe(2);
        expect(apu.cpuRead(0x4015) & 0x03).toBe(0x02);
    });
});

describe('frame counter', () => {
    test('raises the frame IRQ in 4-step mode, cleared by reading $4015', () => {
        const apu = createApu();
        clock(apu, FRAME_IRQ - 1);
        expect(apu.irq).toBe(false);
        clock(apu, 1);
        expect(apu.irq).toBe(true);
        expect(apu.cpuRead(0x4015) & 0x40).toBe(0x40);
        expect(apu.irq).toBe(false);
    });

    test('does not raise the IRQ when inhibited', () => {
        const apu = createApu();
        apu.cpuWrite(0x4017, 0x40);
        clock(apu, 2 * FRAME_IRQ);
        expect(apu.irq).toBe(false);
    });

    test('never raises the IRQ in 5-step mode', () => {
        const apu = createApu();
        apu.cpuWrite(0x4017, 0x80);
        clock(apu, 3 * FRAME_IRQ);
        expect(apu.irq).toBe(false);
    });

    test('5-step mode clocks a half frame as soon as the frame counter restarts', () => {
        const apu = createApu();
        apu.cpuWrite(0x4015, 0x01);
        apu.cpuWrite(0x4003, 0x18); // 2
        apu.cpuWrite(0x4017, 0x80);
        clock(apu, 4);
        expect(apu.pulse1.length.value).toBe(1);
    });

    test('a debugger read of $4015 does not clear the IRQ', () => {
        const apu = createApu();
        clock(apu, FRAME_IRQ);
        apu.cpuRead(0x4015, true);
        expect(apu.irq).toBe(true);
    });
});

describe('pulse', () => {
    function playPulse(apu: Apu, period: number, sweep = 0x00): void {
        apu.cpuWrite(0x4015, 0x01);
        apu.cpuWrite(0x4000, 0xBF); // 50% duty, halted, constant volume 15
        apu.cpuWrite(0x4001, sweep);
        apu.cpuWrite(0x4002, period & 0xFF);
        apu.cpuWrite(0x4003, (period >> 8) | 0x08);
    }

    test('plays at CPU clock / (16 * (period + 1))', () => {
        const apu = createApu();
        playPulse(apu, 253);
        expect(measurePeriod(apu, () => apu.pulse1.output())).toBe(16 * 254);
    });

    test('uses the constant volume', () => {
        const apu = createApu();
        playPulse(apu, 253);
        let max = 0;
        for (let i = 0; i < 16 * 254; i++) {
            apu.clock();
            max = Math.max(max, apu.pulse1.output());
        }
        expect(max).toBe(15);
    });

    test('is muted when the period is below 8', () => {
        const apu = createApu();
        playPulse(apu, 7);
        let max = 0;
        for (let i = 0; i < 1000; i++) {
            apu.clock();
            max = Math.max(max, apu.pulse1.output());
        }
        expect(max).toBe(0);
    });

    test('is muted when the sweep target overflows, even with the sweep disabled', () => {
        const apu = createApu();
        playPulse(apu, 0x7FF, 0x01); // Disabled, shift 1: target 0xBFE
        let max = 0;
        for (let i = 0; i < 100000; i++) {
            apu.clock();
            max = Math.max(max, apu.pulse1.output());
        }
        expect(max).toBe(0);
    });

    test('sweeps the period up on half frames', () => {
        const apu = createApu();
        playPulse(apu, 0x100, 0x81); // Enabled, divider 0, shift 1
        clock(apu, HALF_FRAME);
        expect(apu.pulse1.period).toBe(0x180);
    });

    test('negates with ones\' complement on pulse 1 and two\'s complement on pulse 2', () => {
        const apu = createApu();
        apu.cpuWrite(0x4015, 0x03);
        for (const base of [0x4000, 0x4004]) {
            apu.cpuWrite(base + 1, 0x89); // Enabled, negate, shift 1
            apu.cpuWrite(base + 2, 0x00);
            apu.cpuWrite(base + 3, 0x09); // Period 0x100
        }
        clock(apu, HALF_FRAME);
        expect(apu.pulse1.period).toBe(0x100 - 0x80 - 1);
        expect(apu.pulse2.period).toBe(0x100 - 0x80);
    });

    test('the envelope decays from 15 by one every (volume + 1) quarter frames', () => {
        const apu = createApu();
        apu.cpuWrite(0x4015, 0x01);
        apu.cpuWrite(0x4000, 0x81); // 50% duty, envelope with divider period 1
        apu.cpuWrite(0x4002, 0xFD);
        apu.cpuWrite(0x4003, 0x08);

        const window = 16 * 254;
        // Quarter frames at 7457, 14913 and 22371: the first starts the envelope at 15,
        // then it decays every 2 quarter frames
        clock(apu, QUARTER_FRAME);
        expect(maxOutput(apu, () => apu.pulse1.output(), window)).toBe(15);
        clock(apu, 22371 - QUARTER_FRAME - window);
        expect(maxOutput(apu, () => apu.pulse1.output(), window)).toBe(14);
    });
});

describe('triangle', () => {
    test('plays at CPU clock / (32 * (period + 1)) once the linear counter is loaded', () => {
        const apu = createApu();
        apu.cpuWrite(0x4015, 0x04);
        apu.cpuWrite(0x4008, 0xFF); // Control flag, linear counter 127
        apu.cpuWrite(0x400A, 0x7F);
        apu.cpuWrite(0x400B, 0x08); // Period 0x7F
        clock(apu, QUARTER_FRAME);
        expect(measurePeriod(apu, () => apu.triangle.output())).toBe(32 * 0x80);
    });

    test('does not advance while the linear counter is 0', () => {
        const apu = createApu();
        apu.cpuWrite(0x4015, 0x04);
        apu.cpuWrite(0x4008, 0x80); // Linear counter 0
        apu.cpuWrite(0x400A, 0x10);
        apu.cpuWrite(0x400B, 0x08);
        clock(apu, QUARTER_FRAME);
        const value = apu.triangle.output();
        for (let i = 0; i < 5000; i++) {
            apu.clock();
            expect(apu.triangle.output()).toBe(value);
        }
    });
});

describe('noise', () => {
    function lfsrLength(apu: Apu, mode: number): number {
        apu.cpuWrite(0x400E, mode | 0x00); // Period 4
        const start = apu.noise.shift;
        for (let steps = 1; steps < 40000; steps++) {
            clock(apu, 4);
            if (apu.noise.shift === start) return steps;
        }
        return -1;
    }

    test('the LFSR repeats every 32767 steps in normal mode', () => {
        expect(lfsrLength(createApu(), 0x00)).toBe(32767);
    });

    test('the LFSR repeats every 93 steps in short mode', () => {
        expect(lfsrLength(createApu(), 0x80)).toBe(93);
    });
});

describe('DMC', () => {
    test('plays a sample from memory, raising the IRQ at the end', () => {
        const apu = createApu({ 0xC000: 0xFF, 0xC001: 0x00 });
        apu.cpuWrite(0x4010, 0x8F); // IRQ, fastest rate (54 cycles)
        apu.cpuWrite(0x4011, 0x40);
        apu.cpuWrite(0x4012, 0x00); // $C000
        apu.cpuWrite(0x4013, 0x00); // 1 byte
        apu.cpuWrite(0x4015, 0x10);
        expect(apu.cpuRead(0x4015) & 0x10).toBe(0x10);

        // A rate change does not restart the running timer, which still has the slowest rate (428) from reset
        clock(apu, 428 + 54 * 20);
        expect(apu.cpuRead(0x4015) & 0x10).toBe(0x00);
        expect(apu.irq).toBe(true);
        // All 8 bits of $FF raise the level by 2
        expect(apu.dmc.output()).toBe(0x40 + 16);
    });

    test('loops without raising the IRQ', () => {
        const apu = createApu({ 0xC000: 0xFF });
        apu.cpuWrite(0x4010, 0xCF); // IRQ, loop
        apu.cpuWrite(0x4015, 0x10);
        clock(apu, 54 * 100);
        expect(apu.irq).toBe(false);
        expect(apu.cpuRead(0x4015) & 0x10).toBe(0x10);
        // Steps of 2 from 0 top out at 126
        expect(apu.dmc.output()).toBe(126);
    });

    test('writing $4015 clears the DMC IRQ', () => {
        const apu = createApu();
        apu.cpuWrite(0x4010, 0x8F);
        apu.cpuWrite(0x4015, 0x10);
        clock(apu, 428 + 54 * 20);
        expect(apu.dmc.irq).toBe(true);
        apu.cpuWrite(0x4015, 0x00);
        expect(apu.dmc.irq).toBe(false);
    });
});

describe('output', () => {
    test('produces samples at the configured sample rate', () => {
        const apu = createApu();
        clock(apu, CPU_CLOCK_NTSC / 10);
        expect(Math.abs(apu.takeSamples().length - 4800)).toBeLessThanOrEqual(1);
    });

    test('is silent with every channel disabled', () => {
        const apu = createApu();
        clock(apu, CPU_CLOCK_NTSC / 10);
        const loudest = apu.takeSamples().reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
        expect(loudest).toBeLessThan(1e-9);
    });

    test('is not silent while a pulse is playing', () => {
        const apu = createApu();
        apu.cpuWrite(0x4015, 0x01);
        apu.cpuWrite(0x4000, 0xBF);
        apu.cpuWrite(0x4002, 0xFD);
        apu.cpuWrite(0x4003, 0x08);
        clock(apu, CPU_CLOCK_NTSC / 10);
        const samples = apu.takeSamples();
        const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
        expect(rms).toBeGreaterThan(0.05);
    });
});

describe('APU on the bus', () => {
    test('the frame IRQ interrupts the CPU once it enables interrupts', () => {
        const prg = new Uint8Array(0x4000);
        prg.set([
            0x58,             // CLI
            0x4C, 0x01, 0x80, // JMP $8001
        ]);
        prg.set([
            0xA9, 0x42,       // LDA #$42
            0x85, 0x00,       // STA $00
            0x4C, 0x04, 0x81, // JMP $8104
        ], 0x0100);
        prg.set([0x00, 0x80, 0x00, 0x81], 0x3FFC); // Reset: $8000, IRQ: $8100

        const bus = new Bus();
        bus.insertCartridge(new Cartridge(buildRom({ prg })));
        bus.reset();
        runFrames(bus, 1);
        expect(bus.cpuRam[0x00]).toBe(0x00);
        runFrames(bus, 1);
        expect(bus.cpuRam[0x00]).toBe(0x42);
    });

    test('reset leaves interrupts disabled', () => {
        const bus = new Bus();
        bus.insertCartridge(new Cartridge(buildRom()));
        bus.reset();
        expect(bus.cpu.i).toBe(1);
    });
});

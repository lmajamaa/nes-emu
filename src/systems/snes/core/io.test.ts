import { describe, expect, test } from 'bun:test';
import CpuIo, { CYCLES_PER_LINE, LINES_PER_FRAME } from './io';
import { Button } from '..';

// Advances like a CPU doing fast accesses, until the condition holds
function runUntil(io: CpuIo, condition: () => boolean, limit = CYCLES_PER_LINE * LINES_PER_FRAME * 2): void {
    for (let cycles = 0; !condition(); cycles += 6) {
        if (cycles > limit) throw new Error('Condition never became true');
        io.advance(6);
    }
}

function toLine(io: CpuIo, line: number): void {
    runUntil(io, () => io.v === line);
}

describe('SNES timing', () => {
    test('a frame is 262 lines of 1364 master cycles', () => {
        const io = new CpuIo();
        let cycles = 0;
        while (io.frame === 0) cycles += io.advance(8);
        expect(cycles).toBeGreaterThanOrEqual(CYCLES_PER_LINE * LINES_PER_FRAME);
        expect(cycles).toBeLessThan(CYCLES_PER_LINE * LINES_PER_FRAME + 8);
    });

    test('interlace alternates fields, the even one a line longer', () => {
        const io = new CpuIo();
        io.interlace = true;
        const frameLength = () => {
            let cycles = 0;
            const frame = io.frame;
            while (io.frame === frame) cycles += io.advance(4);
            return cycles;
        };
        expect(io.field).toBe(0);
        const even = frameLength();
        expect(io.field).toBe(1);
        const odd = frameLength();
        expect(io.field).toBe(0);
        expect(Math.round((even - odd) / CYCLES_PER_LINE)).toBe(1);
    });

    test('vblank starts at line 225, or 240 with overscan', () => {
        const io = new CpuIo();
        toLine(io, 224);
        expect(io.vblank).toBe(false);
        toLine(io, 225);
        expect(io.vblank).toBe(true);
        expect(io.frameComplete).toBe(true);

        const overscan = new CpuIo();
        overscan.overscan = true;
        toLine(overscan, 239);
        expect(overscan.frameComplete).toBe(false);
        toLine(overscan, 240);
        expect(overscan.frameComplete).toBe(true);
    });

    test('HVBJOY reports vblank and hblank', () => {
        const io = new CpuIo();
        runUntil(io, () => io.h >= 300);
        expect(io.read(0x4212, 0) & 0xC0).toBe(0x00);
        runUntil(io, () => io.h >= 274 * 4);
        expect(io.read(0x4212, 0) & 0xC0).toBe(0x40);
        toLine(io, 230);
        expect(io.read(0x4212, 0) & 0x80).toBe(0x80);
    });
});

describe('SNES NMI', () => {
    test('is raised at vblank when enabled, and RDNMI clears on read', () => {
        const io = new CpuIo();
        io.write(0x4200, 0x80);
        toLine(io, 225);
        expect(io.nmiPending).toBe(true);
        expect(io.read(0x4210, 0)).toBe(0x82);
        expect(io.read(0x4210, 0)).toBe(0x02);
    });

    test('is not raised when disabled, but RDNMI is still set', () => {
        const io = new CpuIo();
        toLine(io, 225);
        expect(io.nmiPending).toBe(false);
        expect(io.read(0x4210, 0) & 0x80).toBe(0x80);
    });

    test('enabling it during vblank raises it straight away', () => {
        const io = new CpuIo();
        toLine(io, 230);
        io.write(0x4200, 0x80);
        expect(io.nmiPending).toBe(true);
    });

    test('RDNMI is cleared when vblank ends', () => {
        const io = new CpuIo();
        toLine(io, 225);
        toLine(io, 0);
        expect(io.read(0x4210, 0) & 0x80).toBe(0);
    });
});

describe('SNES H/V IRQ', () => {
    test('V IRQ fires at the start of VTIME', () => {
        const io = new CpuIo();
        io.write(0x4209, 100);
        io.write(0x420A, 0);
        io.write(0x4200, 0x20);
        runUntil(io, () => io.irqLine);
        expect(io.v).toBe(100);
        expect(io.h).toBeLessThan(12);
    });

    test('H IRQ fires at HTIME on every line, TIMEUP acknowledges it', () => {
        const io = new CpuIo();
        io.write(0x4207, 200);
        io.write(0x4208, 0);
        io.write(0x4200, 0x10);
        runUntil(io, () => io.irqLine);
        const line = io.v;
        expect(io.h).toBeGreaterThanOrEqual(800);
        expect(io.h).toBeLessThan(806 + 40);
        expect(io.read(0x4211, 0)).toBe(0x80);
        expect(io.read(0x4211, 0)).toBe(0x00);
        runUntil(io, () => io.irqLine);
        expect(io.v).toBe(line + 1);
    });

    test('H and V IRQ together fire only at HTIME of line VTIME', () => {
        const io = new CpuIo();
        io.write(0x4207, 100);
        io.write(0x4208, 0);
        io.write(0x4209, 50);
        io.write(0x420A, 0);
        io.write(0x4200, 0x30);
        runUntil(io, () => io.irqLine);
        expect(io.v).toBe(50);
        expect(io.h).toBeGreaterThanOrEqual(400);
    });

    test('9-bit VTIME reaches the lines past 255', () => {
        const io = new CpuIo();
        io.write(0x4209, 4);
        io.write(0x420A, 1);
        io.write(0x4200, 0x20);
        runUntil(io, () => io.irqLine);
        expect(io.v).toBe(260);
    });

    test('VTIME resets to $1FF, so it needs both halves written', () => {
        const io = new CpuIo();
        io.write(0x4209, 100);
        io.write(0x4200, 0x20);
        expect(() => runUntil(io, () => io.irqLine)).toThrow();
    });

    test('disabling the IRQ drops the line', () => {
        const io = new CpuIo();
        io.write(0x4209, 10);
        io.write(0x420A, 0);
        io.write(0x4200, 0x20);
        runUntil(io, () => io.irqLine);
        io.write(0x4200, 0x00);
        expect(io.irqLine).toBe(false);
    });
});

describe('SNES math registers', () => {
    test('multiplies 8 by 8 bits', () => {
        const io = new CpuIo();
        io.write(0x4202, 200);
        io.write(0x4203, 150);
        const product = io.read(0x4216, 0) | (io.read(0x4217, 0) << 8);
        expect(product).toBe(30000);
    });

    test('divides 16 by 8 bits', () => {
        const io = new CpuIo();
        io.write(0x4204, 1000 & 0xFF);
        io.write(0x4205, 1000 >> 8);
        io.write(0x4206, 7);
        expect(io.read(0x4214, 0) | (io.read(0x4215, 0) << 8)).toBe(142);
        expect(io.read(0x4216, 0) | (io.read(0x4217, 0) << 8)).toBe(6);
    });

    test('dividing by zero gives $FFFF and the dividend as remainder', () => {
        const io = new CpuIo();
        io.write(0x4204, 0x34);
        io.write(0x4205, 0x12);
        io.write(0x4206, 0);
        expect(io.read(0x4214, 0) | (io.read(0x4215, 0) << 8)).toBe(0xFFFF);
        expect(io.read(0x4216, 0) | (io.read(0x4217, 0) << 8)).toBe(0x1234);
    });
});

describe('SNES controllers', () => {
    test('auto joypad read fills JOY1 at vblank', () => {
        const io = new CpuIo();
        io.controllers[0].buttons = Button.B | Button.Start | Button.A | Button.R;
        io.write(0x4200, 0x01);
        toLine(io, 225);
        expect(io.read(0x4212, 0) & 0x01).toBe(1);
        expect(io.read(0x4219, 0)).toBe(0x90);
        expect(io.read(0x4218, 0)).toBe(0x90);
        toLine(io, 229);
        expect(io.read(0x4212, 0) & 0x01).toBe(0);
    });

    test('reads serially through $4016, B first, then ones', () => {
        const io = new CpuIo();
        io.controllers[0].buttons = Button.B | Button.Up | Button.X;
        io.writeJoypadLatch(1);
        io.writeJoypadLatch(0);
        const bits = Array.from({ length: 16 }, () => io.readJoypad(0, 0));
        expect(bits).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
        expect(io.readJoypad(0, 0)).toBe(1);
    });

    test('$4017 has bits 2-4 set', () => {
        const io = new CpuIo();
        io.writeJoypadLatch(1);
        expect(io.readJoypad(1, 0x00)).toBe(0x1C);
    });
});

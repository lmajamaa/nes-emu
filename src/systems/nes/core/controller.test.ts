import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import Bus from './bus';
import Cartridge from './cartridge';
import { Button } from './controller';
import { muteConsole, NESTEST_ROM, runFrames } from './test-helpers';

beforeAll(muteConsole);

function readBits(bus: Bus, port: number, count: number): number[] {
    return Array.from({ length: count }, () => bus.cpuRead(port));
}

function strobe(bus: Bus): void {
    bus.cpuWrite(0x4016, 1);
    bus.cpuWrite(0x4016, 0);
}

describe('controller ports', () => {
    test('buttons are read one bit at a time, A first, then 1s', () => {
        const bus = new Bus();
        bus.controller[0] = Button.A | Button.Start | Button.Right;
        strobe(bus);
        expect(readBits(bus, 0x4016, 10)).toEqual([1, 0, 0, 1, 0, 0, 0, 1, 1, 1]);
    });

    test('the state is captured when strobed', () => {
        const bus = new Bus();
        bus.controller[0] = Button.B;
        strobe(bus);
        bus.controller[0] = Button.A;
        expect(readBits(bus, 0x4016, 2)).toEqual([0, 1]);
    });

    test('while the strobe is held, A is read repeatedly', () => {
        const bus = new Bus();
        bus.controller[0] = Button.A | Button.B;
        bus.cpuWrite(0x4016, 1);
        expect(readBits(bus, 0x4016, 3)).toEqual([1, 1, 1]);
    });

    test('the second controller is read from $4017', () => {
        const bus = new Bus();
        bus.controller[0] = Button.A;
        bus.controller[1] = Button.Select;
        strobe(bus);
        expect(readBits(bus, 0x4017, 4)).toEqual([0, 0, 1, 0]);
        expect(readBits(bus, 0x4016, 1)).toEqual([1]);
    });

    test('read-only (debugger) reads do not shift the state', () => {
        const bus = new Bus();
        bus.controller[0] = Button.A;
        strobe(bus);
        bus.cpuRead(0x4016, true);
        expect(readBits(bus, 0x4016, 2)).toEqual([1, 0]);
    });
});

describe('nestest.nes menu', () => {
    function boot(): Bus {
        const bus = new Bus();
        bus.insertCartridge(new Cartridge(readFileSync(NESTEST_ROM)));
        bus.reset();
        runFrames(bus, 10);
        return bus;
    }

    function press(bus: Bus, button: number): void {
        bus.controller[0] = button;
        runFrames(bus, 2);
        bus.controller[0] = 0;
        runFrames(bus, 2);
    }

    function menuRow(bus: Bus, row: number): string {
        return String.fromCharCode(...bus.ppu.nametables[0].slice(row * 32, row * 32 + 32));
    }

    test('Down moves the cursor', () => {
        const bus = boot();
        expect(menuRow(bus, 4)).toContain('* -- Run all tests');
        press(bus, Button.Down);
        expect(menuRow(bus, 4)).not.toContain('*');
        expect(menuRow(bus, 5)).toContain('* -- Branch tests');
    });

    test('Start runs all tests and every test passes', () => {
        const bus = boot();
        press(bus, Button.Start);
        runFrames(bus, 60);
        for (let row = 4; row <= 17; row++) {
            expect(menuRow(bus, row)).toMatch(/ OK /);
        }
        expect(bus.cpuRam[0x02]).toBe(0x00);
    });
});

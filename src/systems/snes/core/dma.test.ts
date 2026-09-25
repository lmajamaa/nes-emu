import { describe, expect, test } from 'bun:test';
import SnesBus from './bus';
import SnesCartridge from './cartridge';
import Dma, { type DmaBus } from './dma';
import { buildRom } from './test-helpers';

// Flat A-bus memory, and a log of B-bus writes
class RecordingBus implements DmaBus {
    readonly memory = new Uint8Array(0x1000000);
    readonly bWrites: [addr: number, data: number][] = [];
    bValue = 0x5A;
    cycles = 0;

    readA(addr: number): number {
        return this.memory[addr];
    }

    writeA(addr: number, data: number): void {
        this.memory[addr] = data;
    }

    readB(): number {
        return this.bValue;
    }

    writeB(addr: number, data: number): void {
        this.bWrites.push([addr, data]);
    }

    tick(cycles: number): void {
        this.cycles += cycles;
    }
}

function setupChannel(dma: Dma, channel: number, registers: Record<number, number>): void {
    for (const [reg, value] of Object.entries(registers)) {
        dma.writeRegister(0x4300 | (channel << 4) | Number(reg), value);
    }
}

// Source in bank $7E at $1000, count bytes
function dmaSetup(control: number, count: number, bAddress = 0x18) {
    const bus = new RecordingBus();
    for (let i = 0; i < 0x100; i++) bus.memory[0x7E1000 + i] = i;
    const dma = new Dma(bus);
    setupChannel(dma, 0, { 0x0: control, 0x1: bAddress, 0x2: 0x00, 0x3: 0x10, 0x4: 0x7E, 0x5: count, 0x6: 0 });
    return { bus, dma };
}

describe('SNES DMA', () => {
    test('registers read back', () => {
        const dma = new Dma(new RecordingBus());
        for (let reg = 0; reg <= 0xA; reg++) dma.writeRegister(0x4350 + reg, 0x10 + reg);
        dma.writeRegister(0x435B, 0x77);
        for (let reg = 0; reg <= 0xA; reg++) expect(dma.readRegister(0x4350 + reg)).toBe(0x10 + reg);
        expect(dma.readRegister(0x435F)).toBe(0x77);
        expect(dma.readRegister(0x4340)).toBe(0xFF);
    });

    test.each([
        [0, [0, 0, 0, 0, 0, 0, 0, 0]],
        [1, [0, 1, 0, 1, 0, 1, 0, 1]],
        [2, [0, 0, 0, 0, 0, 0, 0, 0]],
        [3, [0, 0, 1, 1, 0, 0, 1, 1]],
        [4, [0, 1, 2, 3, 0, 1, 2, 3]],
        [5, [0, 1, 0, 1, 0, 1, 0, 1]],
        [6, [0, 0, 0, 0, 0, 0, 0, 0]],
        [7, [0, 0, 1, 1, 0, 0, 1, 1]],
    ])('transfer mode %i writes B-bus offsets %j', (mode, offsets) => {
        const { bus, dma } = dmaSetup(mode, 8);
        dma.start(0x01);
        expect(bus.bWrites).toEqual(offsets.map((offset, i) => [0x18 + offset, i]));
    });

    test('updates the address and ends with a count of 0', () => {
        const { dma } = dmaSetup(0x01, 6);
        dma.start(0x01);
        expect(dma.readRegister(0x4302)).toBe(0x06);
        expect(dma.readRegister(0x4305)).toBe(0x00);
        expect(dma.readRegister(0x4306)).toBe(0x00);
    });

    test('a fixed address repeats the same byte', () => {
        const { bus, dma } = dmaSetup(0x08, 3);
        dma.start(0x01);
        expect(bus.bWrites.map(([, data]) => data)).toEqual([0, 0, 0]);
    });

    test('a decrementing address goes backwards', () => {
        const { bus, dma } = dmaSetup(0x10, 3);
        dma.writeRegister(0x4302, 0x05);
        dma.start(0x01);
        expect(bus.bWrites.map(([, data]) => data)).toEqual([5, 4, 3]);
    });

    test('a count of 0 transfers 64 KB, wrapping within the bank', () => {
        const { bus, dma } = dmaSetup(0x00, 0);
        dma.writeRegister(0x4303, 0xFF);
        dma.start(0x01);
        expect(bus.bWrites.length).toBe(0x10000);
        expect(dma.readRegister(0x4303)).toBe(0xFF);
        expect(dma.readRegister(0x4304)).toBe(0x7E);
    });

    test('B-bus to A-bus direction', () => {
        const { bus, dma } = dmaSetup(0x80, 4);
        dma.start(0x01);
        expect([...bus.memory.subarray(0x7E1000, 0x7E1004)]).toEqual([0x5A, 0x5A, 0x5A, 0x5A]);
    });

    test('the A-bus side cannot reach the B-bus or DMA registers', () => {
        const bus = new RecordingBus();
        bus.memory[0x002118] = 0x11;
        const dma = new Dma(bus);
        setupChannel(dma, 0, { 0x0: 0x00, 0x1: 0x18, 0x2: 0x18, 0x3: 0x21, 0x4: 0x00, 0x5: 1, 0x6: 0 });
        dma.start(0x01);
        expect(bus.bWrites).toEqual([[0x18, 0x00]]);
    });

    test('runs the enabled channels in order', () => {
        const bus = new RecordingBus();
        bus.memory[0x7E0000] = 0xAA;
        bus.memory[0x7E0100] = 0xBB;
        const dma = new Dma(bus);
        setupChannel(dma, 3, { 0x0: 0, 0x1: 0x22, 0x2: 0x00, 0x3: 0x01, 0x4: 0x7E, 0x5: 1, 0x6: 0 });
        setupChannel(dma, 1, { 0x0: 0, 0x1: 0x11, 0x2: 0x00, 0x3: 0x00, 0x4: 0x7E, 0x5: 1, 0x6: 0 });
        dma.start(0x0A);
        expect(bus.bWrites).toEqual([[0x11, 0xAA], [0x22, 0xBB]]);
    });

    test('takes 8 master cycles per byte, plus 8 per channel and 8 to start', () => {
        const { bus, dma } = dmaSetup(0x01, 16);
        dma.start(0x01);
        expect(bus.cycles).toBe(8 + 8 + 16 * 8);
    });
});

// HDMA table in bank $7E at $2000, B-bus address $21
function hdmaSetup(control: number, table: number[], extra: Record<number, number[]> = {}) {
    const bus = new RecordingBus();
    bus.memory.set(table, 0x7E2000);
    for (const [addr, bytes] of Object.entries(extra)) bus.memory.set(bytes, Number(addr));
    const dma = new Dma(bus);
    setupChannel(dma, 2, { 0x0: control, 0x1: 0x21, 0x2: 0x00, 0x3: 0x20, 0x4: 0x7E, 0x7: 0x7E });
    dma.hdmaEnable = 0x04;
    dma.hdmaInit();
    return { bus, dma };
}

// Runs HDMA for each line, returning what was written on each
function runLines(bus: RecordingBus, dma: Dma, lines: number): number[][] {
    const written: number[][] = [];
    for (let line = 0; line < lines; line++) {
        bus.bWrites.length = 0;
        dma.hdmaRun();
        written.push(bus.bWrites.map(([, data]) => data));
    }
    return written;
}

describe('SNES HDMA', () => {
    test('a line count below $80 transfers once, then waits', () => {
        const { bus, dma } = hdmaSetup(0x00, [0x03, 0xAA, 0x02, 0xBB, 0x00]);
        expect(runLines(bus, dma, 7)).toEqual([[0xAA], [], [], [0xBB], [], [], []]);
    });

    test('a line count with bit 7 set transfers every line', () => {
        const { bus, dma } = hdmaSetup(0x00, [0x83, 0x01, 0x02, 0x03, 0x01, 0x04, 0x00]);
        expect(runLines(bus, dma, 5)).toEqual([[0x01], [0x02], [0x03], [0x04], []]);
    });

    test('transfers a whole unit per line in the other modes', () => {
        const { bus, dma } = hdmaSetup(0x03, [0x82, 1, 2, 3, 4, 5, 6, 7, 8, 0x00]);
        dma.hdmaRun();
        expect(bus.bWrites).toEqual([[0x21, 1], [0x21, 2], [0x22, 3], [0x22, 4]]);
    });

    test('indirect mode reads the data from the address in the table', () => {
        const { bus, dma } = hdmaSetup(0x40, [0x82, 0x00, 0x30, 0x01, 0x00, 0x31, 0x00], {
            0x7E3000: [0x10, 0x11],
            0x7E3100: [0x20],
        });
        expect(runLines(bus, dma, 4)).toEqual([[0x10], [0x11], [0x20], []]);
    });

    test('a line count of 0 ends the channel for the frame', () => {
        const { bus, dma } = hdmaSetup(0x00, [0x00, 0xAA]);
        expect(runLines(bus, dma, 2)).toEqual([[], []]);
    });

    test('starts over at the table each frame', () => {
        const { bus, dma } = hdmaSetup(0x00, [0x01, 0xAA, 0x00]);
        runLines(bus, dma, 3);
        dma.hdmaInit();
        expect(runLines(bus, dma, 1)).toEqual([[0xAA]]);
    });

    test('disabled channels do nothing', () => {
        const { bus, dma } = hdmaSetup(0x00, [0x81, 0xAA, 0x00]);
        dma.hdmaEnable = 0;
        expect(runLines(bus, dma, 1)).toEqual([[]]);
    });
});

describe('SNES DMA through the bus', () => {
    function busWithRom() {
        const rom = buildRom();
        const bus = new SnesBus();
        bus.cartridge = new SnesCartridge(rom.slice().buffer);
        bus.reset();
        return { bus, rom };
    }

    test('copies ROM to work RAM through the work RAM port', () => {
        const { bus, rom } = busWithRom();
        // WMADD = $7E:4000
        bus.write(0x002181, 0x00);
        bus.write(0x002182, 0x40);
        bus.write(0x002183, 0x00);
        // Channel 0: mode 0 to $2180, from $00:8100, 32 bytes
        for (const [reg, value] of [[0x0, 0x00], [0x1, 0x80], [0x2, 0x00], [0x3, 0x81], [0x4, 0x00], [0x5, 32], [0x6, 0]]) {
            bus.write(0x004300 + reg, value);
        }
        const start = bus.cycles;
        bus.write(0x00420B, 0x01);
        expect([...bus.wram.subarray(0x4000, 0x4020)]).toEqual([...rom.subarray(0x100, 0x120)]);
        // The write itself, then the transfer
        expect(bus.cycles - start).toBeGreaterThanOrEqual(6 + 8 + 8 + 32 * 8);
    });

    test('HDMA runs once per visible line', () => {
        const { bus } = busWithRom();
        // Table in work RAM at $7E:0100: repeat 4 lines of 1-4, then end
        bus.wram.set([0x84, 1, 2, 3, 4, 0x00], 0x0100);
        bus.write(0x002181, 0x00);
        bus.write(0x002182, 0x50);
        bus.write(0x002183, 0x00);
        for (const [reg, value] of [[0x0, 0x00], [0x1, 0x80], [0x2, 0x00], [0x3, 0x01], [0x4, 0x7E]]) {
            bus.write(0x004310 + reg, value);
        }
        bus.write(0x00420C, 0x02);
        // Idle through the rest of this frame and all of the next
        while (bus.io.frame < 2) bus.idle();
        expect([...bus.wram.subarray(0x5000, 0x5006)]).toEqual([1, 2, 3, 4, 0, 0]);
    });
});

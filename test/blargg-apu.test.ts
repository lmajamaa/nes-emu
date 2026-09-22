// Runs blargg's APU tests (test/data/blargg-apu, see its readme.txt). They report
// through PRG RAM: a status at $6000 and a text message from $6004.

import { beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import Bus from '../src/nes/bus';
import Cartridge from '../src/nes/cartridge';
import { BLARGG_APU_DIR, muteConsole, runFrames } from './helpers';

const STATUS_RUNNING = 0x80;
const STATUS_NEEDS_RESET = 0x81;
const MAX_FRAMES = 60 * 30;
// "Reset needed" asks for a delay of at least 100 ms before pressing it
const RESET_DELAY_FRAMES = 10;
// The message is printed after the status is set
const TEXT_DELAY_FRAMES = 30;

beforeAll(muteConsole);

function hasSignature(bus: Bus): boolean {
    return bus.cpuRead(0x6001) === 0xDE && bus.cpuRead(0x6002) === 0xB0 && bus.cpuRead(0x6003) === 0x61;
}

function readText(bus: Bus): string {
    let text = '';
    for (let addr = 0x6004; addr < 0x8000; addr++) {
        const c = bus.cpuRead(addr);
        if (c === 0) break;
        text += String.fromCharCode(c);
    }
    return text.trim();
}

function runTest(rom: string): { status: number, text: string } {
    const bus = new Bus();
    bus.insertCartridge(new Cartridge(readFileSync(new URL(rom, BLARGG_APU_DIR))));
    bus.reset();

    for (let frame = 0; frame < MAX_FRAMES; frame++) {
        runFrames(bus, 1);
        if (!hasSignature(bus)) continue;

        const status = bus.cpuRead(0x6000);
        if (status === STATUS_NEEDS_RESET) {
            runFrames(bus, RESET_DELAY_FRAMES);
            bus.reset();
        } else if (status !== STATUS_RUNNING) {
            runFrames(bus, TEXT_DELAY_FRAMES);
            return { status, text: readText(bus) };
        }
    }
    return { status: -1, text: `Timed out, output so far: ${readText(bus)}` };
}

const roms = readdirSync(BLARGG_APU_DIR).filter(file => file.endsWith('.nes')).sort();

describe('blargg APU tests', () => {
    for (const rom of roms) {
        test(rom, () => {
            const { status, text } = runTest(rom);
            // Status 0 is a pass, anything else is a failure code explained by the text
            expect({ status, text }).toEqual({ status: 0, text: expect.stringContaining('Passed') });
        });
    }
});

// Runs blargg's test ROMs, which report through PRG RAM: a status at $6000
// ($80 running, $81 reset needed, below $80 the result where 0 is a pass) and a text
// message from $6004. See test/data/blargg-apu/readme.txt.

import { readFileSync } from 'node:fs';
import Bus from '../src/nes/bus';
import Cartridge from '../src/nes/cartridge';
import { runFrames } from './helpers';

const STATUS_RUNNING = 0x80;
const STATUS_NEEDS_RESET = 0x81;
// "Reset needed" asks for a delay of at least 100 ms before pressing it
const RESET_DELAY_FRAMES = 10;
// The message is printed after the status is set
const TEXT_DELAY_FRAMES = 30;

export interface BlarggResult {
    status: number;
    text: string;
}

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

export function runBlarggTest(rom: URL, maxFrames = 60 * 30): BlarggResult {
    const bus = new Bus();
    bus.insertCartridge(new Cartridge(readFileSync(rom)));
    bus.reset();

    for (let frame = 0; frame < maxFrames; frame++) {
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

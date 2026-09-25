import { beforeAll, describe, expect, test } from 'bun:test';
import { runBlarggTest } from '../test-blargg';
import { BLARGG_MMC3_DIR, muteConsole } from '../test-helpers';

beforeAll(muteConsole);

const PASSING = ['1-clocking.nes', '2-details.nes', '3-A12_clocking.nes', '5-MMC3.nes'];

// Known failures, marked so that they turn red once they start passing
const KNOWN_FAILURES: Record<string, string> = {
    // Checks the IRQ to the exact PPU cycle, which needs a CPU that does its memory
    // accesses on the right cycle within each instruction
    '4-scanline_timing.nes': 'needs a cycle-accurate CPU',
    // The emulated MMC3 is revision B (Super Mario Bros. 3, Mega Man 3), this tests revision A
    '6-MMC3_alt.nes': 'tests the other MMC3 revision',
};

const passes = (rom: string) =>
    expect(runBlarggTest(new URL(rom, BLARGG_MMC3_DIR))).toEqual({ status: 0, text: expect.stringContaining('Passed') });

describe('blargg MMC3 tests', () => {
    for (const rom of PASSING) {
        test(rom, () => passes(rom));
    }
    for (const [rom, reason] of Object.entries(KNOWN_FAILURES)) {
        test.failing(`${rom} (${reason})`, () => passes(rom));
    }
});

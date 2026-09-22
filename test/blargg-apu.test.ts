import { beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { runBlarggTest } from './blargg';
import { BLARGG_APU_DIR, muteConsole } from './helpers';

beforeAll(muteConsole);

const roms = readdirSync(BLARGG_APU_DIR).filter(file => file.endsWith('.nes')).sort();

describe('blargg APU tests', () => {
    for (const rom of roms) {
        test(rom, () => {
            // Status 0 is a pass, anything else is a failure code explained by the text
            expect(runBlarggTest(new URL(rom, BLARGG_APU_DIR))).toEqual({ status: 0, text: expect.stringContaining('Passed') });
        });
    }
});

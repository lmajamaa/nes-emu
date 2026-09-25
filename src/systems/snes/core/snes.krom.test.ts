// Runs krom's SNES test ROMs and demos, and compares the screen with their reference
// screenshots. The CPU tests print a PASS or FAIL per case, so matching the screenshot means
// every case passed. `bun run fetch-krom-tests` downloads them again.

import { describe, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import SnesCartridge from './cartridge';
import { FRAME_WIDTH } from './ppu';
import Snes from './snes';
import { unpackBundle } from './test-bundle';
import { decodeImage, type RgbImage } from './test-image';
import { KROM_BUNDLE, KROM_CASES, referenceOf, type KromCase } from './test-krom-cases';

// The screenshots come from emulators that convert colors from 5 to 8 bits slightly differently
const TOLERANCE = 4;
// Long running cases only compare now and then
const LONG_RUN_FRAMES = 300;
const LONG_RUN_COMPARE_EVERY = 10;

const files = unpackBundle(readFileSync(KROM_BUNDLE));

function load(path: string): Uint8Array {
    const data = files.get(path);
    if (!data) throw new Error(`${path} is not in the bundle, run bun run fetch-krom-tests`);
    return data;
}

// Differing channels, over the lines both have. A 225 line screenshot includes line 0 at the top.
// A 256 wide screenshot is compared with the main screen, the odd columns of the frame, and a
// 448 line one has every line twice unless the frame is interlaced too.
function difference(snes: Snes, reference: RgbImage, mainScreenOnly = false): number {
    const frame = new Uint8Array(snes.bus.ppu.frame.buffer);
    const skip = reference.height === 225 ? 1 : 0;
    const hires = reference.width === FRAME_WIDTH;
    const lineStep = reference.height >= snes.bus.ppu.height * 2 ? 2 : 1;
    const height = Math.min((reference.height - skip) / lineStep, snes.bus.ppu.height);
    let differing = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < reference.width; x++) {
            if (mainScreenOnly && hires && !(x & 1)) continue;
            const frameX = hires ? x : (x << 1) | 1;
            for (let c = 0; c < 3; c++) {
                const actual = frame[(y * FRAME_WIDTH + frameX) * 4 + c];
                const expected = reference.pixels[((y * lineStep + skip) * reference.width + x) * 3 + c];
                if (Math.abs(actual - expected) > TOLERANCE) differing++;
            }
        }
    }
    return differing;
}

function run(testCase: KromCase): void {
    const reference = decodeImage(load(referenceOf(testCase)));
    const rom = load(testCase.rom);
    const snes = new Snes(new SnesCartridge(rom.buffer as ArrayBuffer));
    snes.reset();
    snes.bus.io.controllers[0].buttons = testCase.hold ?? 0;

    let best = Infinity;
    for (let frame = 1; frame <= testCase.frames; frame++) {
        snes.runFrame();
        // The STP test asks for a reset to show that it passed
        if (snes.cpu.stopped) snes.reset();
        if (testCase.frames > LONG_RUN_FRAMES && frame % LONG_RUN_COMPARE_EVERY) continue;
        const differing = difference(snes, reference, testCase.mainScreenOnly);
        if (differing === 0) return;
        best = Math.min(best, differing);
    }
    throw new Error(`The screen never matched the screenshot in ${testCase.frames} frames, at best ${best} color channels differed`);
}

describe("krom's SNES tests", () => {
    for (const testCase of KROM_CASES) {
        const name = testCase.rom.replace(/\.sfc$/, '');
        if (testCase.knownFailure) {
            test.failing(`${name} (${testCase.knownFailure})`, () => run(testCase));
        } else if (testCase.slow) {
            test.skipIf(!process.env.SLOW_TESTS)(name, () => run(testCase), 60000);
        } else {
            test(name, () => run(testCase));
        }
    }
});

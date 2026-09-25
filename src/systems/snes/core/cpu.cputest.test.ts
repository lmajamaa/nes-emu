// Runs gilyon's 65C816 test ROM, which tests every instruction in every addressing mode, including
// undocumented behavior of the SNES's CPU. When a test fails, the screen shows its number, which is
// described in tests-full.txt of the ROM's release: https://github.com/gilyon/snes-tests

import { expect, test } from 'bun:test';
import { CPU_TEST_ROM, runGilyonTest } from './test-helpers';

test("gilyon's cputest passes", () => {
    const screen = runGilyonTest(CPU_TEST_ROM);
    expect(screen.join('\n')).toContain('Running tests... Success');
});

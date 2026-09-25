// Runs gilyon's SPC-700 test ROM, which uploads its tests to the sound CPU and checks every
// instruction. A failing test's number is on the screen: https://github.com/gilyon/snes-tests

import { expect, test } from 'bun:test';
import { runGilyonTest, SPC_TEST_ROM } from '../test-helpers';

test("gilyon's spctest passes", () => {
    const screen = runGilyonTest(SPC_TEST_ROM);
    expect(screen.join('\n')).toContain('Running tests... Success');
});

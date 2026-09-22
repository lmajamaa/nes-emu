# Test data

Third-party test data used by `bun test`. Everything the tests need is checked in,
so they run offline from a fresh clone.

## `nestest/`

- `nestest.nes` – CPU test ROM by kevtris. Also a copy of `public/roms/nestest.nes`,
  which is not in version control.
- `nestest.log` – Reference trace of the ROM running in automation mode (PC = `$C000`),
  produced with Nintendulator.

Source: https://github.com/christopherpow/nes-test-roms/tree/master/other

## `6502/`

`official.json.gz` is a sample of Tom Harte's 6502 SingleStepTests for the 151 official
opcodes, bundled as gzipped JSON keyed by opcode (`{ "00": [...], "01": [...], ... }`).
Each opcode has 100 cases. Two changes from upstream:

- The per-cycle bus activity is replaced by the cycle count (`"cycles": 7`), because the
  emulator doesn't run cycle by cycle.
- ADC/SBC cases with the decimal flag set are left out, because the NES CPU has no
  decimal mode.

Source: https://github.com/SingleStepTests/65x02 (`6502/v1`), MIT licensed, see `6502/LICENSE`.

Run `bun run fetch-cpu-tests [casesPerOpcode]` to download the sample again,
optionally with a different number of cases.

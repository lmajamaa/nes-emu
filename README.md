# NES Emulator

[![CI](https://github.com/lmajamaa/nes-emu/actions/workflows/ci.yml/badge.svg)](https://github.com/lmajamaa/nes-emu/actions/workflows/ci.yml)

A Nintendo Entertainment System (NES) emulator that runs in the browser, written in TypeScript
with a React debugger UI. It started in 2019 following javidx9's [NES emulator series](https://github.com/OneLoneCoder/olcNES) but was forgotten. Implementation was restarted in 2026, adding controllers, more cartridge mappers and a test suite built on well-known NES test ROMs.

It can run official games like Super Mario Bros., Super Mario Bros. 2 and 3, Donkey Kong, Bubble Bobble and Mike Tyson's Punch-Out!!.

## Features

- **CPU**: the 6502 (2A03) with all 256 opcodes, including the unofficial ones, and correct
  cycle counts per instruction.
- **PPU**: backgrounds with scrolling, 8x8 and 8x16 sprites with flipping and priority,
  sprite zero hit and sprite overflow, and nametable mirroring.
- **APU**: both pulse channels, triangle, noise and DMC, the frame counter and its IRQ, played
  through the Web Audio API.
- **Controllers**: player 1 on the keyboard.
- **Cartridges**: iNES ROMs using mapper 0 (NROM), 1 (MMC1), 4 (MMC3, including its scanline
  IRQ) or 9 (MMC2), with PRG RAM and CHR RAM.
- **Debugger**: step one instruction or frame at a time, and see the CPU registers,
  disassembly around the program counter, RAM, palettes and pattern tables.

### Not supported (yet)

- Cycle-accurate CPU timing: instructions run all at once on their first cycle, so memory
  accesses within an instruction happen a few cycles early. Games don't notice, but a few
  timing test ROMs do.
- Other mappers. ROMs with an unsupported mapper load as mapper 0, with a warning.
- A second controller, PAL timing and save states.

## Getting started

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

Then open http://localhost:3000. The emulator starts with the `nestest` test ROM loaded and
paused. Press **Space** to run it. Click the console logo to pick another game, or **Open ROM
file…** to load a `.nes` file from your computer. ROMs are read in the browser and not uploaded
anywhere. No games are included, but ROMs you put in `public/roms` (git ignored) are listed in
the menu, grouped by console.

Sound starts when you first run the emulator with Space, or use the Sound button or M, as
browsers don't let pages play audio before the user interacts with them.

## Controls

| Key | Controller |
|---|---|
| Arrow keys | D-pad |
| X | A |
| Z | B |
| A | Select |
| S | Start |

| Key | Emulator |
|---|---|
| Space | Run / pause |
| C | Step one instruction |
| F | Step one frame |
| R | Reset the console |
| I / N | Trigger an IRQ / NMI |
| P | Cycle the palette used by the pattern table view |
| M | Mute / unmute |

## Scripts

| Command | |
|---|---|
| `bun run dev` | Development server at http://localhost:3000 |
| `bun run build` | Production build into `build/` |
| `bun run preview` | Serve the production build |
| `bun test` | Run the tests |
| `bun run typecheck` | Type check with TypeScript |
| `bun run fetch-cpu-tests` | Download the 6502 test sample again, see `test/data/README.md` |

## Testing

The tests run the emulator headlessly against established NES test suites, plus unit tests of
its parts. Everything they need is in the repository, so they run offline.

- **nestest**: runs kevtris's CPU test ROM and compares every instruction with the reference log.
- **6502 SingleStepTests**: Tom Harte's per-opcode tests of registers, memory and cycle counts.
- **blargg's test ROMs**: `instr_test` (every instruction), `apu_test` and `mmc3_test`.

A few tests are marked as known failures, which turn red if they start passing: an MMC3 test
that needs a cycle-accurate CPU, one for a different MMC3 chip revision, and the unstable `LXA`
opcode, whose result depends on the chip and differs between the SingleStepTests and the NES.
- **Unit tests** for the PPU, sprites, APU channels, controllers and mappers.

CI runs the type check, the tests and the build on every push to `main` and on pull requests.

## Project structure

```
src/
  nes/          The NES emulator: CPU, PPU, APU, bus, cartridge, mappers
  systems/      One adapter per console, implementing the Emulator interface in types.ts
    nes/        NES adapter, logo and debugger views
    snes/       SNES placeholder, listed in the menu as coming soon
  shell/        Console independent UI: game menu, screen, keyboard, emulation loop, audio
test/           Tests, and test ROMs in test/data (with their sources)
scripts/        Test data tooling
```

## Credits

- javidx9 / OneLoneCoder's [olcNES](https://github.com/OneLoneCoder/olcNES), which this emulator
  is based on, and [fredericcambon/nes](https://github.com/fredericcambon/nes).
- The [NESdev wiki](https://www.nesdev.org/wiki/), for most of the hardware details.
- Test ROMs and data by kevtris (nestest), Tom Harte ([SingleStepTests](https://github.com/SingleStepTests/65x02))
  and blargg (Shay Green), via [christopherpow/nes-test-roms](https://github.com/christopherpow/nes-test-roms).

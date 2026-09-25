# NES / SNES Emulator

[![CI](https://github.com/lmajamaa/nes-emu/actions/workflows/ci.yml/badge.svg)](https://github.com/lmajamaa/nes-emu/actions/workflows/ci.yml)

An emulator for the Nintendo Entertainment System (NES) and the Super Nintendo Entertainment
System (SNES) that runs in the browser, written in TypeScript with a React debugger UI. It
started in 2019 following javidx9's [NES emulator series](https://github.com/OneLoneCoder/olcNES) but wasn't fully completed. Implementation was restarted in September 2026, adding controllers, more cartridge mappers, the full SNES implementation and a test suite built on well-known test ROMs.

## Consoles

- **NES**: the 6502 CPU, the PPU, all five sound channels and the common cartridge boards
  (mappers 0, 1, 2, 3, 4, 7 and 9). See [docs/nes.md](docs/nes.md) for the details, what's
  missing and the plan.
- **SNES**: the 65816 CPU, the PPU with all background modes and mode 7, DMA and HDMA, and the
  SPC700 and DSP for sound. Cartridges with enhancement chips aren't supported yet. See
  [docs/snes.md](docs/snes.md) for the details.

Both have a debugger next to the screen, and keep games' battery-backed saves in the browser
(IndexedDB) between sessions. The documents in `docs/` can also be read in the app, from the docs
icon in the top right corner or with **D**. Each has its own address, like
`#/docs/docs/nes.md#progress`, to link to.

## Getting started

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

Then open http://localhost:3000. The emulator starts running the `nestest` test ROM, and
**Space** pauses it. Click the console logo to pick another game, which starts playing right
away, or **Open ROM file…** to load a `.nes`, `.sfc` or `.smc` file from your computer. ROMs are read in the browser and not uploaded
anywhere. Only publicly available user-made ROMs are included, like `nestest.nes`.

The screen has controls over its bottom edge, like a video player: run and pause, step a frame,
reset, sound with a volume slider that pops up above it on hover (remembered), theater mode (the screen
across the page, with the debugger below it, remembered) and full screen. Clicking the screen runs or pauses it, double-clicking goes full screen, and the controls hide while the game runs and the mouse is still.

Sound starts with your first click or key press, as browsers don't let pages play audio before
the user interacts with them.

## Controls

| Key | NES controller | SNES controller |
|---|---|---|
| Arrow keys | D-pad | D-pad |
| X | A | A |
| Z | B | B |
| S | Start | X |
| A | Select | Y |
| Q / W | | L / R |
| Enter | | Start |
| Right Shift | | Select |

| Key | Emulator |
|---|---|
| Space | Run / pause |
| F | Step one frame |
| R | Reset the console |
| M | Mute / unmute |
| T | Theater mode |
| D | Documentation |
| C | Step one instruction |
| I / N | Trigger an IRQ / NMI (NES) |
| P | Cycle the palette used by the pattern table view (NES) |

## Scripts

| Command | |
|---|---|
| `bun run dev` | Development server at http://localhost:3000 |
| `bun run build` | Production build into `build/` (`BASE_PATH=/nes-emu/` to serve it from a subpath) |
| `bun run preview` | Serve the production build |
| `bun test` | Run the tests (`SLOW_TESTS=1 bun test` includes the slow tests) |
| `bun run typecheck` | Type check with TypeScript |
| `bun run fetch-cpu-tests` | Download the 6502 test sample again, see `test/fixtures/README.md` |
| `bun run fetch-65816-tests` | Download the 65816 (SNES CPU) test sample again, see `test/fixtures/README.md` |
| `bun run fetch-spc700-tests` | Download the SPC700 (SNES sound CPU) test sample again, see `test/fixtures/README.md` |

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
- **SNES** (see [docs/snes.md](docs/snes.md)): Tom Harte's 65816 and SPC700
  SingleStepTests, and unit tests of the cartridge, bus, timing, DMA, PPU, APU and DSP.

CI runs the type check, the tests and the build on every push to `main` and on pull requests.
Publishing a release deploys the app to GitHub Pages, under `/<repository>/`.

The docs are rendered from markdown at build time with [Bun's markdown API](https://bun.com/docs/runtime/markdown),
so Vite runs on Bun (`bun --bun vite`) rather than Node.

## Project structure

```
src/
  systems/      One adapter per console, implementing the Emulator interface in types.ts
    nes/        NES: the adapter, logo and debugger views, and core/ with the CPU, PPU, APU, bus, cartridge and mappers
    snes/       SNES: the adapter, and core/ with the 65816 CPU, bus, timing, DMA, PPU, APU and cartridge
  shell/        Console independent UI: game menu, screen, keyboard, emulation loop, audio, docs
plugins/        Vite plugins: the ROM list of public/roms, and the docs rendered to HTML
docs/           Documents shown in the app
test/fixtures/  Test ROMs and data (with their sources), imported as @test/fixtures/...
scripts/        Test data tooling
```

Tests sit next to the code they test as `*.test.ts`, with shared test code in `test-*.ts` files.

## Credits

- javidx9 / OneLoneCoder's [olcNES](https://github.com/OneLoneCoder/olcNES), which this emulator
  is based on, and [fredericcambon/nes](https://github.com/fredericcambon/nes).
- The [NESdev wiki](https://www.nesdev.org/wiki/), for most of the hardware details.
- Test ROMs and data by kevtris (nestest), Tom Harte (SingleStepTests for the [6502](https://github.com/SingleStepTests/65x02)
  and [65816](https://github.com/SingleStepTests/65816)) and blargg (Shay Green), via
  [christopherpow/nes-test-roms](https://github.com/christopherpow/nes-test-roms).

## License

[MIT](LICENSE), for the emulator's own code. The test ROMs and test data in `test/fixtures` belong
to their authors and keep their own terms, see [test/fixtures/README.md](test/fixtures/README.md).

## Trademarks

Nintendo, Nintendo Entertainment System, NES, Super Nintendo Entertainment System and SNES are
trademarks of Nintendo. This project is not affiliated with, endorsed or sponsored by Nintendo.
The names are only used to say which consoles it emulates, and only publicly available user-made
ROMs are included.

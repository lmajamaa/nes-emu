# SNES emulation plan

The SNES slots into the multi-system frontend: the core lives in `src/systems/snes/core/`, and
once it runs games, `src/systems/snes/index.ts` gets a `create()` that returns an `Emulator`
(see `src/systems/types.ts`), which makes the SNES selectable in the console menu.

References: the [emudev.de SNES series](https://emudev.de/q00-snes/65816-the-cpu/) (65816,
memory mapping and LoROM, cartridge header, DMA, PPU, SPC700), the
[SNESdev wiki](https://snes.nesdev.org/wiki/) and fullsnes.

## Layout

```
src/systems/snes/
  core/
    cartridge.ts      header detection, LoROM/HiROM, SRAM
    bus.ts            24-bit memory map, WRAM, memory speed per region
    cpu.ts            65816
    io.ts             the 5A22's I/O: H/V counters, NMI/IRQ, multiply/divide, joypads
    controller.ts     joypad shift register
    snes.ts           the console: runs the CPU and takes interrupts
    dma.ts            general DMA + HDMA
    ppu/              registers, VRAM/CGRAM/OAM, background renderer, sprites, color math
    apu/              spc700.ts, dsp.ts, apu.ts (ARAM, timers, ports)
  ui/                 logo, debugger views
  index.tsx           SnesEmulator adapter
test/snes/            + test/data/snes/
```

## Milestones

Each milestone ends with tests that run automatically, like the NES side.

### 1. Cartridge (small)

- Strip the 512-byte copier header of `.smc` files.
- Score the internal header at `$7FC0` / `$FFC0` to tell LoROM from HiROM, and read the ROM
  and SRAM sizes, the FastROM bit and the chip type.
- Warn about enhancement chips (SuperFX, SA-1, DSP-1…) the same way unsupported NES mappers
  are warned about.
- Tests: unit tests with synthetic headers.

### 2. 65816 CPU (large, everything depends on it)

- A/X/Y switch between 8 and 16 bits with the M and X flags, the E flag switches between
  6502 emulation and native mode, DBR/PBR/D, stack relative and long addressing, all 256 opcodes.
- A new class, not an extension of the NES 6502: they share little beyond the mnemonics, and
  the NES core stays untouched.
- Cycle counts per instruction, including 16-bit accesses, direct page with a nonzero low
  byte of D and page crossings. The memory speed (6, 8 or 12 master cycles) comes from the bus.
- Tests: Tom Harte's [SingleStepTests/65816](https://github.com/SingleStepTests/65816),
  emulation and native mode files per opcode, sampled and gzipped like the 6502 ones.
- Later, once the PPU shows text: krom's CPU test ROMs
  ([PeterLemon/SNES](https://github.com/PeterLemon/SNES)).

### 3. Bus, timing and CPU registers (medium)

- Memory map: 128 KB WRAM and its mirrors, the B-bus at `$2100–$21FF`, the CPU registers at
  `$4200–$43FF` (multiply/divide, NMITIMEN, H/V IRQ, HVBJOY, MEMSEL FastROM), open bus.
- Master clock at 21.477 MHz: 1364 master cycles per scanline, 262 scanlines, driving VBlank
  NMI, the H/V IRQ and the automatic joypad read.
- Tests: unit tests for the map (LoROM, HiROM, mirrors), multiply/divide, NMI/IRQ timing.

### 4. DMA and HDMA (medium)

- 8 channels, all transfer modes, fixed and decrementing addresses, indirect HDMA.
- HDMA runs every scanline and is used for gradients, wavy effects and window shapes, so it
  is needed early.
- Tests: unit tests, then krom's DMA/HDMA demos.

### 5. PPU (largest)

- 64 KB VRAM, 512 B CGRAM, 544 B OAM, and each register's latch and write order (VRAM
  address remapping and increment, CGRAM/OAM double writes, access only during blanking).
- Rendered a scanline at a time into a `Uint32Array`: per-dot accuracy isn't needed for
  nearly all games, and it keeps JavaScript fast enough.
- In this order:
  1. Backgrounds in modes 0 and 1: tile maps, 2/4/8 bpp, scrolling, priorities.
  2. Sprites: the OBSEL sizes, priority, the 32 per line and 34 tile limits.
  3. Main and sub screen, color math and fixed color, windows 1 and 2 with their masks.
  4. Modes 2–4 (offset per tile, 8 bpp), then mode 7 (affine, EXTBG).
  5. Mosaic, interlace, hi-res modes 5 and 6 (512 pixels wide).
- Tests: krom's PPU demos, comparing a hash of the frame against a reference stored in the
  repo. The krom CPU ROMs from milestone 2 can run from here on.

### 6. APU (large, can be built alongside 3–5)

- SPC700 CPU with 64 KB ARAM, the 64-byte IPL boot ROM, three timers and the four ports at
  `$2140–$2143` to the main CPU. Tests: [SingleStepTests/spc700](https://github.com/SingleStepTests/spc700).
- Kept in sync by catching up: run the SPC700 up to the main CPU's time when a port is
  accessed, and at the end of each scanline.
- DSP: 8 voices with BRR decoding, pitch, Gaussian interpolation, ADSR and GAIN envelopes,
  noise, pitch modulation, echo with its 8-tap FIR filter. Output is 32 kHz stereo, which
  `takeSamples()` resamples to the audio context's rate. Tests: unit tests for BRR and the
  envelopes, comparing samples against a known good output.
- The audio worklet is mono today, so stereo needs a small change to `AudioOutput`, with the
  NES sending the same signal to both channels.

### 7. Controllers and adapter (small)

- 12 buttons (already in `snes/index.ts`), automatic joypad read and manual `$4016/$4017`.
- `SnesEmulator` implementing `Emulator`. The PPU's frame is always 512 wide (lo-res lines
  draw every pixel twice), so only `height` changes at runtime, with overscan and later
  interlace: it becomes a getter, and the `<canvas>` size follows it like `drawScreen`'s
  image buffer already does.
- `create()` on the SNES system, which makes it selectable in the menu.

### 8. Debugger and saves (medium)

- 65816 registers (including E, M and X) and disassembly. It depends on M and X, so it is
  decoded around the PC as it runs instead of all at once on load like the NES.
- VRAM tile viewer, CGRAM palette, OAM list, the current BG mode and layers.
- Battery-backed SRAM kept in IndexedDB, keyed by a hash of the ROM: many SNES games need saves.

### 9. Later

- Enhancement chips: DSP-1 (Super Mario Kart, Pilotwings), SuperFX (Star Fox, Yoshi's
  Island), SA-1 (Super Mario RPG).
- Emulation in a Web Worker, PAL timing.

## Risks and decisions

- **Speed** is the main risk: the SNES does roughly 10× the work of the NES per frame. No
  allocation per pixel (the NES `Sprite`/`Pixel` objects wouldn't hold up), typed arrays
  everywhere, a `switch` or function table per opcode, rendering a scanline at a time.
  Measure against a budget as soon as the CPU and PPU mode 1 work, and keep a Web Worker in
  reserve (it needs COOP/COEP headers for `SharedArrayBuffer`).
- **Accuracy**: each instruction runs at once with correct cycle counts, like the NES core,
  and the other components catch up by timestamp. That gives up bsnes-level accuracy, but
  reaches snes9x-level compatibility.
- **First target games**, without enhancement chips and exercising a lot of the hardware:
  Super Mario World (LoROM, mode 1, lots of HDMA), Donkey Kong Country (HiROM), F-Zero
  (mode 7), Super Metroid (color math, windows).
- **Order**: 1 → 2 → 3 → 4 → 5 (backgrounds only) for the first visible frame, then sprites
  and the APU, then the adapter to make games playable, then the rest of the PPU.

## Progress

- [x] 1. Cartridge
- [x] 2. 65816 CPU (SingleStepTests and krom's CPU test ROMs)
- [x] 3. Bus, timing and CPU registers (multiply/divide results are ready at once instead of
  after 8/16 CPU cycles; latching the H/V counters waits for the PPU)
- [x] 4. DMA and HDMA (timing is 8 master cycles per byte plus fixed overheads, without the
  alignment to the CPU clock; a channel used for DMA and HDMA at once isn't handled; krom's
  DMA/HDMA demos wait for the PPU)
- [x] 5. PPU. Hi-res (modes 5 and 6, pseudo hi-res) outputs 512 wide, the sub screen in the
  even columns like bsnes, and interlace draws the fields into alternate rows of a 448 or 478
  line frame. krom's CPU tests and 28 of their PPU demos match their screenshots; the
  128-colors-per-tile-row demos need cycle-accurate IRQ and DMA timing, the pseudo hi-res
  screenshots only match in the main screen's columns, and the PPU/Interlace screenshots aren't
  exact enough to compare with (in InterlaceRPG the sprite is a line lower than here, worth
  checking against another reference)
- [ ] 6. APU
- [ ] 7. Controllers and adapter
- [ ] 8. Debugger and saves

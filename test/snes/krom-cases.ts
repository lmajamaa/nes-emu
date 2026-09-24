// krom's (Peter Lemon's) SNES test ROMs and demos that are compared with their reference
// screenshots, see test/snes/krom.test.ts. Paths are in https://github.com/PeterLemon/SNES, and
// in the bundle made by scripts/fetch-krom-tests.ts. The screenshot is next to the ROM, with the
// same name.

export const KROM_BUNDLE = new URL('../data/krom/krom.bundle.gz', import.meta.url);

export interface KromCase {
    rom: string;
    // Screenshot, when it isn't the ROM's name with .png
    reference?: string;
    // Frames to run before giving up on matching the screenshot
    frames: number;
    // Controller buttons to hold, for demos that change with input
    hold?: number;
    // Marked as a known failure, which turns red if it starts passing
    knownFailure?: string;
    // Compare only the main screen's columns of a hi-res screenshot
    mainScreenOnly?: boolean;
    // Takes seconds, so only runs with SLOW_TESTS=1
    slow?: boolean;
}

const cpu = (name: string, frames = 90): KromCase => ({ rom: `CPUTest/CPU/${name}/CPU${name}.sfc`, frames });
// The main CPU uploads each test to the SPC700 through the IPL, and shows its results. The
// SPC700 plays a sound and waits a second after each of its up to 28 tests.
const spc700 = (name: string): KromCase => ({ rom: `CPUTest/SPC700/${name}/SPC700${name}.sfc`, frames: 2000, slow: true });
const bank = (name: string): KromCase => ({ rom: `BANK/${name}/BANK${name}.sfc`, frames: 60 });
// The main screen's columns match, but the sub screen's differ from bsnes's hi-res output, which
// the emulator follows: the screenshots seem to come from an emulator that draws it differently
const pseudoHires = (path: string): KromCase => ({
    rom: `PPU/HDMA/HiColor64PerTileRowPseudoHiRes/${path}`,
    frames: 30,
    mainScreenOnly: true,
});
const hiColor128 = (path: string): KromCase => ({
    rom: `PPU/HDMA/HiColor128PerTileRow/${path}`,
    frames: 30,
    knownFailure: 'uploads palettes from a mid-line H-IRQ, which needs cycle-accurate IRQ and DMA timing',
});

// SNES button bits, see src/systems/snes
const BUTTON_R = 0x0010;

export const KROM_CASES: KromCase[] = [
    ...['ADC', 'AND', 'ASL', 'BIT', 'BRA', 'CMP', 'DEC', 'EOR', 'INC', 'JMP', 'LDR', 'LSR', 'MOV',
        'MSC', 'ORA', 'PHL', 'PSR', 'RET', 'ROL', 'ROR', 'SBC', 'STR', 'TRN'].map(name => cpu(name)),
    ...['ADC', 'AND', 'DEC', 'EOR', 'INC', 'ORA', 'SBC'].map(spc700),
    ...['HiROMFastROM', 'HiROMSlowROM', 'LoROMFastROM', 'LoROMSlowROM', 'WRAM'].map(bank),
    { rom: 'HelloWorld/HelloWorld.sfc', frames: 60 },
    { rom: 'PPU/BGMAP/8x8/2BPP/8x8BG1Map2BPP32x328PAL/8x8BG1Map2BPP32x328PAL.sfc', frames: 60 },
    { rom: 'PPU/BGMAP/8x8/2BPP/8x8BG2Map2BPP32x328PAL/8x8BG2Map2BPP32x328PAL.sfc', frames: 60 },
    { rom: 'PPU/BGMAP/8x8/2BPP/8x8BG3Map2BPP32x328PAL/8x8BG3Map2BPP32x328PAL.sfc', frames: 60 },
    { rom: 'PPU/BGMAP/8x8/2BPP/8x8BG4Map2BPP32x328PAL/8x8BG4Map2BPP32x328PAL.sfc', frames: 60 },
    { rom: 'PPU/BGMAP/8x8/4BPP/8x8BGMap4BPP32x328PAL/8x8BGMap4BPP32x328PAL.sfc', frames: 60 },
    { rom: 'PPU/BGMAP/8x8/8BPP/TileFlip/8x8BGMapTileFlip.sfc', frames: 60 },
    { rom: 'PPU/Blend/HiColor/HiColor1241DLair/HiColor1241DLair.sfc', frames: 60 },
    { rom: 'PPU/Blend/HiColor/HiColor3840/HiColor3840.sfc', frames: 60 },
    { rom: 'PPU/Blend/HiColor/HiColor575Myst/HiColor575Myst.sfc', frames: 60 },
    { rom: 'PPU/GreenSpace/GreenSpace.sfc', frames: 30 },
    { rom: 'PPU/HDMA/HiColor64PerTileRow/HiColor64PerTileRow.sfc', frames: 30 },
    { rom: 'PPU/HDMA/HiColor64PerTileRow/TEST/DQ64PerTileRow.sfc', frames: 30 },
    { rom: 'PPU/HDMA/HiColor64PerTileRow/TEST/RGB_24bits_palette_color_test_chart64PerTileRow.sfc', frames: 30 },
    { rom: 'PPU/HDMA/HiColor64PerTileRow/TEST/lenna64PerTileRow.sfc', frames: 30 },
    { rom: 'PPU/HDMA/HiColor64PerTileRow/TEST/mandrill64PerTileRow.sfc', frames: 30 },
    hiColor128('HiColor128PerTileRow.sfc'),
    hiColor128('TEST/DQ128PerTileRow.sfc'),
    hiColor128('TEST/RGB_24bits_palette_color_test_chart128PerTileRow.sfc'),
    hiColor128('TEST/lenna128PerTileRow.sfc'),
    hiColor128('TEST/mandrill128PerTileRow.sfc'),
    pseudoHires('HiColor64PerTileRowPseudoHiRes.sfc'),
    pseudoHires('TEST/RGB_24bits_palette_color_test_chart64PerTileRowHiRes.sfc'),
    pseudoHires('TEST/lenna64PerTileRowHiRes.sfc'),
    pseudoHires('TEST/mandrill64PerTileRowHiRes.sfc'),
    { rom: 'PPU/HDMA/Mode7HDMA/Mode7HDMA.sfc', frames: 30 },
    { rom: 'PPU/HDMA/RedSpace9BitHDMA/RedSpace9BitHDMA.sfc', frames: 30 },
    { rom: 'PPU/HDMA/WaveHDMA/WaveHDMA.sfc', frames: 300 },
    // The screenshot is a BMP, despite its name
    { rom: 'PPU/Mode7/Perspective/Perspective.sfc', frames: 30 },
    // Holding R grows the mosaic, the screenshot has it at 16 pixels
    { rom: 'PPU/Mosaic/Mode3/MosaicMode3.sfc', frames: 300, hold: BUTTON_R },
    // Hi-res and interlace. The PPU/Interlace demos aren't here: their screenshots aren't exact,
    // with colors a few steps off like after lossy compression, and some shifted by a few lines.
    { rom: 'PPU/Mosaic/Mode5/MosaicMode5.sfc', frames: 300, hold: BUTTON_R },
    { rom: 'PPU/Rings/Rings.sfc', frames: 60 },
    { rom: 'PPU/Window/WindowHDMA/WindowHDMA.sfc', frames: 60 },
];

export function referenceOf(testCase: KromCase): string {
    return testCase.reference ?? testCase.rom.replace(/\.sfc$/, '.png');
}

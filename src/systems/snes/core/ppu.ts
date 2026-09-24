// The SNES PPU (both chips, S-PPU1 and S-PPU2): registers $2100-$213F, VRAM, CGRAM and OAM,
// and a renderer that draws a whole scanline at once, like bsnes's fast PPU.

const SCREEN_WIDTH = 256;
// Frames are 512 pixels wide for hi-res, where the sub screen shows in the even columns and the
// main screen in the odd ones. Other lines draw every pixel twice.
export const FRAME_WIDTH = 512;
// Interlace draws the two fields of a frame into alternate rows, for twice the height
export const MAX_SCREEN_HEIGHT = 239 * 2;

// What the PPU needs from the CPU side: the beam position, and where vblank starts
export interface PpuTiming {
    h: number;
    v: number;
    readonly vblank: boolean;
    overscan: boolean;
    interlace: boolean;
    // Alternates every frame, which interlace draws in the odd rows
    readonly field: number;
    // A PAL console, which games check in STAT78
    readonly pal: boolean;
}

// Layers, as used by the registers' bit order
const BG1 = 0;
const BG2 = 1;
const BG3 = 2;
const BG4 = 3;
const OBJ = 4;
const BACKDROP = 5;
const COLOR_WINDOW = 5;
const TRANSPARENT = 0xFF;

// Bits per pixel of BG1-BG4 in modes 0-6
const MODE_BPP = [
    [2, 2, 2, 2],
    [4, 4, 2, 0],
    [4, 4, 0, 0],
    [8, 4, 0, 0],
    [8, 2, 0, 0],
    [4, 2, 0, 0],
    [4, 0, 0, 0],
];

// Layers and priorities from front to back in each mode, as layer * 4 + priority
const at = (layer: number, priority: number) => layer * 4 + priority;
const PRIORITIES = {
    mode0: [at(OBJ, 3), at(BG1, 1), at(BG2, 1), at(OBJ, 2), at(BG1, 0), at(BG2, 0), at(OBJ, 1), at(BG3, 1), at(BG4, 1), at(OBJ, 0), at(BG3, 0), at(BG4, 0)],
    mode1: [at(OBJ, 3), at(BG1, 1), at(BG2, 1), at(OBJ, 2), at(BG1, 0), at(BG2, 0), at(OBJ, 1), at(BG3, 1), at(OBJ, 0), at(BG3, 0)],
    // BGMODE bit 3 brings BG3's high priority tiles in front of everything
    mode1Bg3: [at(BG3, 1), at(OBJ, 3), at(BG1, 1), at(BG2, 1), at(OBJ, 2), at(BG1, 0), at(BG2, 0), at(OBJ, 1), at(OBJ, 0), at(BG3, 0)],
    mode2to5: [at(OBJ, 3), at(BG1, 1), at(OBJ, 2), at(BG2, 1), at(OBJ, 1), at(BG1, 0), at(OBJ, 0), at(BG2, 0)],
    mode6: [at(OBJ, 3), at(BG1, 1), at(OBJ, 2), at(OBJ, 1), at(BG1, 0), at(OBJ, 0)],
    mode7: [at(OBJ, 3), at(OBJ, 2), at(OBJ, 1), at(BG1, 0), at(OBJ, 0)],
    // EXTBG: BG2 shows mode 7's pixels with bit 7 as their priority
    mode7Extbg: [at(OBJ, 3), at(OBJ, 2), at(BG2, 1), at(OBJ, 1), at(BG1, 0), at(OBJ, 0), at(BG2, 0)],
};

// Sprite sizes by OBSEL, small and large
const OBJ_SMALL_WIDTH = [8, 8, 8, 16, 16, 32, 16, 16];
const OBJ_SMALL_HEIGHT = [8, 8, 8, 16, 16, 32, 32, 32];
const OBJ_LARGE_WIDTH = [16, 32, 64, 32, 64, 64, 32, 32];
const OBJ_LARGE_HEIGHT = [16, 32, 64, 32, 64, 64, 64, 32];
const OBJ_RANGE_LIMIT = 32;
const OBJ_TILE_LIMIT = 34;

const VRAM_INCREMENTS = [1, 32, 128, 128];

const signed16 = (value: number) => (value << 16) >> 16;
const signed13 = (value: number) => (value << 19) >> 19;

// 8-bit color from 5-bit, at each of the 16 brightness levels. Brightness scales the analog
// output by (1 + level) / 16, and level 0 is very dark but not black, like bsnes models it.
const BRIGHTNESS = Array.from({ length: 16 }, (_, brightness) =>
    Uint8Array.from({ length: 32 }, (_, c) => {
        const level = (1 + brightness) / 16 * (brightness === 0 ? 0.25 : 1);
        return Math.round(c * 255 / 31 * level);
    }));

class Ppu {
    readonly vram = new Uint16Array(0x8000);
    readonly cgram = new Uint16Array(256);
    readonly oam = new Uint8Array(544);
    // RGBA pixels, as little endian 32-bit words, FRAME_WIDTH wide
    readonly frame = new Uint32Array(FRAME_WIDTH * MAX_SCREEN_HEIGHT);

    // INIDISP
    forceBlank = true;
    brightness = 0;
    // OBSEL
    private objBaseSize = 0;
    private objNameSelect = 0;
    private objTileBase = 0;
    // OAMADDL/H
    private oamBaseAddress = 0;
    private oamAddress = 0;
    private oamPriority = false;
    private oamLatch = 0;
    // BGMODE, MOSAIC
    bgMode = 0;
    private bg3Priority = false;
    private readonly bgTileSize16 = [false, false, false, false];
    private mosaicSize = 1;
    private mosaicEnable = 0;
    // BGnSC, BGnNBA
    private readonly bgScreenAddress = [0, 0, 0, 0];
    private readonly bgScreenSize = [0, 0, 0, 0];
    private readonly bgTileAddress = [0, 0, 0, 0];
    // BGnHOFS/VOFS and their write latches
    readonly bgHOffset = [0, 0, 0, 0];
    readonly bgVOffset = [0, 0, 0, 0];
    private bgOffsetLatch = 0;
    private bgHOffsetLatch = 0;
    // VMAIN, VMADD
    private vramIncrementHigh = false;
    private vramRemap = 0;
    private vramIncrement = 1;
    private vramAddress = 0;
    private vramReadLatch = 0;
    // Mode 7
    private m7Select = 0;
    private m7a = 0;
    private m7b = 0;
    private m7c = 0;
    private m7d = 0;
    private m7x = 0;
    private m7y = 0;
    private m7HOffset = 0;
    private m7VOffset = 0;
    private m7Latch = 0;
    // CGADD, CGDATA
    private cgramAddress = 0;
    private cgramHigh = false;
    private cgramLatch = 0;
    // Windows
    private readonly windowSelect = [0, 0, 0, 0, 0, 0];
    private readonly windowLogic = [0, 0, 0, 0, 0, 0];
    private window1Left = 0;
    private window1Right = 0;
    private window2Left = 0;
    private window2Right = 0;
    // TM, TS, TMW, TSW
    private mainScreen = 0;
    private subScreen = 0;
    private mainWindow = 0;
    private subWindow = 0;
    // CGWSEL, CGADSUB, COLDATA
    private colorSelect = 0;
    private colorMath = 0;
    private fixedColor = 0;
    // SETINI
    private setini = 0;
    // Counter latches and flags
    private hCounterLatch = 0;
    private vCounterLatch = 0;
    private hCounterHigh = false;
    private vCounterHigh = false;
    private countersLatched = false;
    private timeOver = false;
    private rangeOver = false;
    private ppu1OpenBus = 0;
    private ppu2OpenBus = 0;

    // Per line: color (15-bit) and priority (or TRANSPARENT) of each layer, 512 wide for hi-res
    private readonly lineColor = Array.from({ length: 5 }, () => new Uint16Array(512));
    private readonly linePriority = Array.from({ length: 5 }, () => new Uint8Array(512));
    // Whether a sprite pixel takes part in color math, only palettes 4-7 do
    private readonly objMath = new Uint8Array(SCREEN_WIDTH);
    private readonly windowMask = Array.from({ length: 6 }, () => new Uint8Array(SCREEN_WIDTH));
    private readonly windowActive = [false, false, false, false, false, false];

    constructor(private readonly timing: PpuTiming) {}

    // Registers the debugger shows
    debugInfo() {
        return {
            mode: this.bgMode,
            bg3Priority: this.bg3Priority,
            forceBlank: this.forceBlank,
            brightness: this.brightness,
            mainScreen: this.mainScreen,
            subScreen: this.subScreen,
            colorMath: this.colorMath,
            colorSelect: this.colorSelect,
            fixedColor: this.fixedColor,
            setini: this.setini,
            bgScreenAddress: [...this.bgScreenAddress],
            bgTileAddress: [...this.bgTileAddress],
            bgHOffset: [...this.bgHOffset],
            bgVOffset: [...this.bgVOffset],
            objBaseSize: this.objBaseSize,
            objTileBase: this.objTileBase,
        };
    }

    get height(): number {
        const lines = this.timing.overscan ? 239 : 224;
        return this.timing.interlace ? lines * 2 : lines;
    }

    reset(): void {
        this.forceBlank = true;
        this.brightness = 0;
        this.setini = 0;
        this.timing.overscan = false;
        this.timing.interlace = false;
        this.frame.fill(0xFF000000);
    }

    // Called at the start of vblank and at the start of each frame
    vblankStart(): void {
        if (!this.forceBlank) this.oamAddress = this.oamBaseAddress;
    }

    frameStart(): void {
        this.timeOver = false;
        this.rangeOver = false;
    }

    // VRAM, CGRAM and OAM can only be written while the screen isn't being drawn
    private get rendering(): boolean {
        return !this.forceBlank && !this.timing.vblank;
    }

    // $2134-$213F, by the low byte. Returns -1 for open bus.
    read(addr: number): number {
        switch (addr) {
            case 0x34: case 0x35: case 0x36: {
                const product = signed16(this.m7a) * ((this.m7b >> 8) << 24 >> 24);
                return this.ppu1OpenBus = (product >> ((addr - 0x34) * 8)) & 0xFF;
            }
            case 0x38: {
                const data = this.oam[this.oamIndex(this.oamAddress)];
                this.oamAddress = (this.oamAddress + 1) & 0x3FF;
                return this.ppu1OpenBus = data;
            }
            case 0x39: {
                const data = this.vramReadLatch & 0xFF;
                if (!this.vramIncrementHigh) this.vramPrefetchAndIncrement();
                return this.ppu1OpenBus = data;
            }
            case 0x3A: {
                const data = this.vramReadLatch >> 8;
                if (this.vramIncrementHigh) this.vramPrefetchAndIncrement();
                return this.ppu1OpenBus = data;
            }
            case 0x3B: {
                const color = this.cgram[this.cgramAddress];
                let data: number;
                if (!this.cgramHigh) {
                    data = color & 0xFF;
                } else {
                    data = (color >> 8) | (this.ppu2OpenBus & 0x80);
                    this.cgramAddress = (this.cgramAddress + 1) & 0xFF;
                }
                this.cgramHigh = !this.cgramHigh;
                return this.ppu2OpenBus = data;
            }
            case 0x3C: {
                const data = this.hCounterHigh ? (this.hCounterLatch >> 8) | (this.ppu2OpenBus & 0xFE) : this.hCounterLatch & 0xFF;
                this.hCounterHigh = !this.hCounterHigh;
                return this.ppu2OpenBus = data;
            }
            case 0x3D: {
                const data = this.vCounterHigh ? (this.vCounterLatch >> 8) | (this.ppu2OpenBus & 0xFE) : this.vCounterLatch & 0xFF;
                this.vCounterHigh = !this.vCounterHigh;
                return this.ppu2OpenBus = data;
            }
            case 0x3E:
                return this.ppu1OpenBus = (this.timeOver ? 0x80 : 0) | (this.rangeOver ? 0x40 : 0) | (this.ppu1OpenBus & 0x10) | 0x01;
            case 0x3F: {
                // PAL games refuse to run unless bit 4 says the console is PAL, and NTSC ones the other way round
                const data = (this.timing.field ? 0x80 : 0) | (this.countersLatched ? 0x40 : 0) | (this.ppu2OpenBus & 0x20) |
                    (this.timing.pal ? 0x10 : 0) | 0x03;
                this.countersLatched = false;
                this.hCounterHigh = false;
                this.vCounterHigh = false;
                return this.ppu2OpenBus = data;
            }
            default:
                return -1;
        }
    }

    latchCounters(): void {
        this.hCounterLatch = this.timing.h >> 2;
        this.vCounterLatch = this.timing.v;
        this.countersLatched = true;
    }

    // $2100-$2133, by the low byte
    write(addr: number, data: number): void {
        switch (addr) {
            case 0x00: {
                const wasBlank = this.forceBlank;
                this.forceBlank = (data & 0x80) !== 0;
                this.brightness = data & 0x0F;
                // Turning force blank off at the start of vblank reloads the OAM address
                if (wasBlank && !this.forceBlank && this.timing.v === this.vblankLine) this.oamAddress = this.oamBaseAddress;
                break;
            }
            case 0x01:
                this.objBaseSize = data >> 5;
                this.objNameSelect = (data >> 3) & 3;
                this.objTileBase = (data & 7) << 13;
                break;
            case 0x02:
                this.oamBaseAddress = ((this.oamBaseAddress & 0x200) | (data << 1)) & 0x3FF;
                this.oamAddress = this.oamBaseAddress;
                break;
            case 0x03:
                this.oamBaseAddress = ((data & 1) << 9) | (this.oamBaseAddress & 0x1FE);
                this.oamPriority = (data & 0x80) !== 0;
                this.oamAddress = this.oamBaseAddress;
                break;
            case 0x04: this.writeOam(data); break;
            case 0x05:
                this.bgMode = data & 7;
                this.bg3Priority = (data & 0x08) !== 0;
                for (let bg = 0; bg < 4; bg++) this.bgTileSize16[bg] = (data & (0x10 << bg)) !== 0;
                break;
            case 0x06:
                this.mosaicSize = (data >> 4) + 1;
                this.mosaicEnable = data & 0x0F;
                break;
            case 0x07: case 0x08: case 0x09: case 0x0A: {
                const bg = addr - 0x07;
                this.bgScreenAddress[bg] = (data & 0xFC) << 8;
                this.bgScreenSize[bg] = data & 3;
                break;
            }
            case 0x0B:
                this.bgTileAddress[BG1] = (data & 0x0F) << 12;
                this.bgTileAddress[BG2] = (data >> 4) << 12;
                break;
            case 0x0C:
                this.bgTileAddress[BG3] = (data & 0x0F) << 12;
                this.bgTileAddress[BG4] = (data >> 4) << 12;
                break;
            case 0x0D: case 0x0F: case 0x11: case 0x13: {
                const bg = (addr - 0x0D) >> 1;
                if (bg === BG1) this.m7HOffset = this.writeMode7(data);
                this.bgHOffset[bg] = ((data << 8) | (this.bgOffsetLatch & ~7) | (this.bgHOffsetLatch & 7)) & 0x3FF;
                this.bgOffsetLatch = data;
                this.bgHOffsetLatch = data;
                break;
            }
            case 0x0E: case 0x10: case 0x12: case 0x14: {
                const bg = (addr - 0x0E) >> 1;
                if (bg === BG1) this.m7VOffset = this.writeMode7(data);
                this.bgVOffset[bg] = ((data << 8) | this.bgOffsetLatch) & 0x3FF;
                this.bgOffsetLatch = data;
                break;
            }
            case 0x15:
                this.vramIncrementHigh = (data & 0x80) !== 0;
                this.vramRemap = (data >> 2) & 3;
                this.vramIncrement = VRAM_INCREMENTS[data & 3];
                break;
            case 0x16:
                this.vramAddress = (this.vramAddress & 0xFF00) | data;
                this.vramReadLatch = this.vram[this.vramTranslated()];
                break;
            case 0x17:
                this.vramAddress = (this.vramAddress & 0x00FF) | (data << 8);
                this.vramReadLatch = this.vram[this.vramTranslated()];
                break;
            case 0x18: case 0x19: {
                const high = addr === 0x19;
                if (!this.rendering) {
                    const target = this.vramTranslated();
                    const word = this.vram[target];
                    this.vram[target] = high ? (word & 0x00FF) | (data << 8) : (word & 0xFF00) | data;
                }
                if (high === this.vramIncrementHigh) this.vramAddress = (this.vramAddress + this.vramIncrement) & 0xFFFF;
                break;
            }
            case 0x1A: this.m7Select = data; break;
            case 0x1B: this.m7a = this.writeMode7(data); break;
            case 0x1C: this.m7b = this.writeMode7(data); break;
            case 0x1D: this.m7c = this.writeMode7(data); break;
            case 0x1E: this.m7d = this.writeMode7(data); break;
            case 0x1F: this.m7x = this.writeMode7(data); break;
            case 0x20: this.m7y = this.writeMode7(data); break;
            case 0x21:
                this.cgramAddress = data;
                this.cgramHigh = false;
                break;
            case 0x22:
                if (!this.cgramHigh) {
                    this.cgramLatch = data;
                } else {
                    this.cgram[this.cgramAddress] = ((data & 0x7F) << 8) | this.cgramLatch;
                    this.cgramAddress = (this.cgramAddress + 1) & 0xFF;
                }
                this.cgramHigh = !this.cgramHigh;
                break;
            case 0x23:
                this.windowSelect[BG1] = data & 0x0F;
                this.windowSelect[BG2] = data >> 4;
                break;
            case 0x24:
                this.windowSelect[BG3] = data & 0x0F;
                this.windowSelect[BG4] = data >> 4;
                break;
            case 0x25:
                this.windowSelect[OBJ] = data & 0x0F;
                this.windowSelect[COLOR_WINDOW] = data >> 4;
                break;
            case 0x26: this.window1Left = data; break;
            case 0x27: this.window1Right = data; break;
            case 0x28: this.window2Left = data; break;
            case 0x29: this.window2Right = data; break;
            case 0x2A:
                for (let bg = 0; bg < 4; bg++) this.windowLogic[bg] = (data >> (bg * 2)) & 3;
                break;
            case 0x2B:
                this.windowLogic[OBJ] = data & 3;
                this.windowLogic[COLOR_WINDOW] = (data >> 2) & 3;
                break;
            case 0x2C: this.mainScreen = data & 0x1F; break;
            case 0x2D: this.subScreen = data & 0x1F; break;
            case 0x2E: this.mainWindow = data & 0x1F; break;
            case 0x2F: this.subWindow = data & 0x1F; break;
            case 0x30: this.colorSelect = data; break;
            case 0x31: this.colorMath = data; break;
            case 0x32: {
                const intensity = data & 0x1F;
                if (data & 0x20) this.fixedColor = (this.fixedColor & ~0x001F) | intensity;
                if (data & 0x40) this.fixedColor = (this.fixedColor & ~0x03E0) | (intensity << 5);
                if (data & 0x80) this.fixedColor = (this.fixedColor & ~0x7C00) | (intensity << 10);
                break;
            }
            case 0x33:
                this.setini = data;
                this.timing.overscan = (data & 0x04) !== 0;
                this.timing.interlace = (data & 0x01) !== 0;
                break;
        }
    }

    private get vblankLine(): number {
        return this.timing.overscan ? 240 : 225;
    }

    // Mode 7 registers are written twice, low byte first, through their own latch
    private writeMode7(data: number): number {
        const value = (data << 8) | this.m7Latch;
        this.m7Latch = data;
        return value;
    }

    private writeOam(data: number): void {
        const addr = this.oamAddress;
        if (!this.rendering) {
            if (addr & 0x200) {
                this.oam[this.oamIndex(addr)] = data;
            } else if (addr & 1) {
                // The low table is written a word at a time, when its second byte arrives
                this.oam[addr - 1] = this.oamLatch;
                this.oam[addr] = data;
            }
        }
        if (!(addr & 0x200) && !(addr & 1)) this.oamLatch = data;
        this.oamAddress = (addr + 1) & 0x3FF;
    }

    // The high table's 32 bytes repeat over $200-$3FF
    private oamIndex(addr: number): number {
        return addr & 0x200 ? 0x200 | (addr & 0x1F) : addr;
    }

    // VMAIN's address remapping, which lays out bitmap-like data as tiles
    private vramTranslated(): number {
        const addr = this.vramAddress;
        switch (this.vramRemap) {
            case 1: return ((addr & 0xFF00) | ((addr & 0x001F) << 3) | ((addr >> 5) & 7)) & 0x7FFF;
            case 2: return ((addr & 0xFE00) | ((addr & 0x003F) << 3) | ((addr >> 6) & 7)) & 0x7FFF;
            case 3: return ((addr & 0xFC00) | ((addr & 0x007F) << 3) | ((addr >> 7) & 7)) & 0x7FFF;
            default: return addr & 0x7FFF;
        }
    }

    private vramPrefetchAndIncrement(): void {
        this.vramReadLatch = this.vram[this.vramTranslated()];
        this.vramAddress = (this.vramAddress + this.vramIncrement) & 0xFFFF;
    }

    // Rendering

    // Draws line v (1 to 224, or 239 with overscan) into row v - 1 of the frame, or with interlace
    // into row (v - 1) * 2 of the even field and the row below it for the odd one
    renderLine(v: number): void {
        const row = (this.timing.interlace ? ((v - 1) << 1) | this.timing.field : v - 1) * FRAME_WIDTH;
        if (this.forceBlank) {
            this.frame.fill(0xFF000000, row, row + FRAME_WIDTH);
            return;
        }

        const used = this.mainScreen | this.subScreen;
        for (let layer = 0; layer < 5; layer++) this.linePriority[layer].fill(TRANSPARENT);

        if (this.bgMode === 7) {
            if (used & (1 << BG1) || used & (1 << BG2)) this.renderMode7(v);
        } else {
            const bpp = MODE_BPP[this.bgMode];
            for (let bg = 0; bg < 4; bg++) {
                if (bpp[bg] && used & (1 << bg)) this.renderBackground(bg, bpp[bg], v);
            }
        }
        if (used & (1 << OBJ)) this.renderObjects(v);

        for (let layer = 0; layer < 6; layer++) this.windowActive[layer] = this.renderWindow(layer);
        this.compose(row);
    }

    private renderBackground(bg: number, bpp: number, v: number): void {
        const mode = this.bgMode;
        const hires = mode === 5 || mode === 6;
        const offsetPerTile = mode === 2 || mode === 4 || mode === 6;
        const directColor = (this.colorSelect & 1) !== 0 && bg === BG1 && (mode === 3 || mode === 4);
        const tileMode = bpp === 2 ? 0 : bpp === 4 ? 1 : 2;
        const width = hires ? 512 : 256;
        const tileSize16 = this.bgTileSize16[bg];
        const tileHeightShift = tileSize16 ? 4 : 3;
        const tileWidthShift = hires ? 4 : tileHeightShift;
        const screenSize = this.bgScreenSize[bg];
        const hmask = ((width << (tileSize16 ? 1 : 0)) << (screenSize & 1)) - 1;
        const vmask = ((width << (tileSize16 ? 1 : 0)) << ((screenSize >> 1) & 1)) - 1;
        const tileMask = 0x0FFF >> tileMode;
        const tileBase = this.bgTileAddress[bg] >> (3 + tileMode);
        const paletteBase = mode === 0 ? bg << 5 : 0;
        const paletteShift = 2 << tileMode;
        const colorOut = this.lineColor[bg];
        const priorityOut = this.linePriority[bg];
        const { vram, cgram } = this;

        let hscroll = this.bgHOffset[bg];
        const vscroll = this.bgVOffset[bg];
        let y = v;
        if (this.mosaicEnable & (1 << bg)) y -= (v - 1) % this.mosaicSize;
        if (hires) {
            hscroll <<= 1;
            // Interlace doubles the vertical resolution of hi-res backgrounds, each field shows every other line
            if (this.timing.interlace) y = (y << 1) | this.timing.field;
        }

        let x = -(hscroll & 7);
        while (x < width) {
            let hoffset = x + hscroll;
            let voffset = y + vscroll;
            if (offsetPerTile) {
                // BG3's map holds new scroll values for each column of 8 pixels but the first
                const valid = 0x2000 << bg;
                const offsetX = x + (hscroll & 7);
                if (offsetX >= 8) {
                    const lookupX = (offsetX - 8) + (this.bgHOffset[BG3] & ~7);
                    const hlookup = this.tileEntry(BG3, lookupX, this.bgVOffset[BG3]);
                    if (mode === 4) {
                        if (hlookup & valid) {
                            if (!(hlookup & 0x8000)) hoffset = offsetX + (hlookup & ~7);
                            else voffset = y + hlookup;
                        }
                    } else {
                        const vlookup = this.tileEntry(BG3, lookupX, this.bgVOffset[BG3] + 8);
                        if (hlookup & valid) hoffset = offsetX + (hlookup & ~7);
                        if (vlookup & valid) voffset = y + vlookup;
                    }
                }
            }
            hoffset &= hmask;
            voffset &= vmask;

            const entry = this.tileEntry(bg, hoffset, voffset);
            const mirrorY = entry & 0x8000 ? 7 : 0;
            const mirrorX = entry & 0x4000 ? 7 : 0;
            const priority = (entry >> 13) & 1;
            const paletteNumber = (entry >> 10) & 7;
            const paletteIndex = (paletteBase + (paletteNumber << paletteShift)) & 0xFF;

            let tile = entry;
            if (tileWidthShift === 4 && ((hoffset & 8) !== 0) !== (mirrorX !== 0)) tile += 1;
            if (tileHeightShift === 4 && ((voffset & 8) !== 0) !== (mirrorY !== 0)) tile += 16;
            tile = ((tile & 0x03FF) + tileBase) & tileMask;

            const rowAddress = (tile << (3 + tileMode)) + ((voffset & 7) ^ mirrorY);
            const w0 = vram[rowAddress & 0x7FFF];
            const w1 = bpp >= 4 ? vram[(rowAddress + 8) & 0x7FFF] : 0;
            const w2 = bpp === 8 ? vram[(rowAddress + 16) & 0x7FFF] : 0;
            const w3 = bpp === 8 ? vram[(rowAddress + 24) & 0x7FFF] : 0;

            for (let tileX = 0; tileX < 8; tileX++, x++) {
                if (x < 0 || x >= width) continue;
                const shift = 7 - (tileX ^ mirrorX);
                let color = ((w0 >> shift) & 1) | (((w0 >> (shift + 8)) & 1) << 1);
                if (bpp >= 4) color |= (((w1 >> shift) & 1) << 2) | (((w1 >> (shift + 8)) & 1) << 3);
                if (bpp === 8) {
                    color |= (((w2 >> shift) & 1) << 4) | (((w2 >> (shift + 8)) & 1) << 5) |
                        (((w3 >> shift) & 1) << 6) | (((w3 >> (shift + 8)) & 1) << 7);
                }
                if (color === 0) continue;
                colorOut[x] = directColor ? directColorOf(color, paletteNumber) : cgram[(paletteIndex + color) & 0xFF];
                priorityOut[x] = priority;
            }
        }

        if (this.mosaicEnable & (1 << bg)) this.applyMosaic(bg, width);
    }

    // The tile map entry under a point of a background
    private tileEntry(bg: number, hoffset: number, voffset: number): number {
        const hires = this.bgMode === 5 || this.bgMode === 6;
        const tileHeightShift = this.bgTileSize16[bg] ? 4 : 3;
        const tileWidthShift = hires ? 4 : tileHeightShift;
        const screenSize = this.bgScreenSize[bg];
        const tileX = hoffset >> tileWidthShift;
        const tileY = voffset >> tileHeightShift;
        let offset = ((tileY & 0x1F) << 5) | (tileX & 0x1F);
        if (tileX & 0x20 && screenSize & 1) offset += 0x400;
        if (tileY & 0x20 && screenSize & 2) offset += screenSize & 1 ? 0x800 : 0x400;
        return this.vram[(this.bgScreenAddress[bg] + offset) & 0x7FFF];
    }

    private applyMosaic(layer: number, width = SCREEN_WIDTH): void {
        const size = this.mosaicSize;
        if (size === 1) return;
        const color = this.lineColor[layer];
        const priority = this.linePriority[layer];
        for (let x = 0; x < width; x++) {
            const source = x - (x % size);
            color[x] = color[source];
            priority[x] = priority[source];
        }
    }

    private renderMode7(v: number): void {
        const a = signed16(this.m7a);
        const b = signed16(this.m7b);
        const c = signed16(this.m7c);
        const d = signed16(this.m7d);
        const cx = signed13(this.m7x);
        const cy = signed13(this.m7y);
        const hoffset = signed13(this.m7HOffset);
        const voffset = signed13(this.m7VOffset);
        const over = this.m7Select >> 6;
        const hflip = (this.m7Select & 1) !== 0;
        const extbg = (this.setini & 0x40) !== 0;
        const directColor = (this.colorSelect & 1) !== 0;
        const { vram, cgram } = this;

        let y = v;
        if (this.mosaicEnable & 1) y -= (v - 1) % this.mosaicSize;
        if (this.m7Select & 2) y = 255 - (y & 0xFF);
        y &= 0xFF;

        // Clips the scroll relative to the center to 10 bits and a sign
        const clip = (n: number) => (n & 0x2000 ? n | ~0x3FF : n & 0x3FF);
        const hclip = clip(hoffset - cx);
        const vclip = clip(voffset - cy);
        const originX = ((a * hclip) & ~63) + ((b * vclip) & ~63) + ((b * y) & ~63) + (cx << 8);
        const originY = ((c * hclip) & ~63) + ((d * vclip) & ~63) + ((d * y) & ~63) + (cy << 8);

        const bg1Color = this.lineColor[BG1];
        const bg1Priority = this.linePriority[BG1];
        const bg2Color = this.lineColor[BG2];
        const bg2Priority = this.linePriority[BG2];

        for (let x = 0; x < SCREEN_WIDTH; x++) {
            const screenX = hflip ? 255 - x : x;
            let px = (originX + a * screenX) >> 8;
            let py = (originY + c * screenX) >> 8;

            let tile: number;
            if ((px | py) & ~0x3FF) {
                // Outside the 1024x1024 plane
                if (over === 2) continue;
                if (over === 3) {
                    tile = 0;
                } else {
                    px &= 0x3FF;
                    py &= 0x3FF;
                    tile = vram[((py >> 3) << 7) | (px >> 3)] & 0xFF;
                }
            } else {
                tile = vram[((py >> 3) << 7) | (px >> 3)] & 0xFF;
            }
            const color = vram[(tile << 6) | ((py & 7) << 3) | (px & 7)] >> 8;

            if (color !== 0) {
                bg1Color[x] = directColor ? directColorOf(color, 0) : cgram[color];
                bg1Priority[x] = 0;
            }
            if (extbg && (color & 0x7F) !== 0) {
                bg2Color[x] = cgram[color & 0x7F];
                bg2Priority[x] = color >> 7;
            }
        }
        if (this.mosaicEnable & 1) this.applyMosaic(BG1);
        if (extbg && this.mosaicEnable & 2) this.applyMosaic(BG2);
    }

    private renderObjects(v: number): void {
        const { oam, vram, cgram } = this;
        // OBJ interlace draws sprites at half height, each field showing every other line
        const interlace = (this.setini & 0x02) !== 0;
        const field = this.timing.field;
        const colorOut = this.lineColor[OBJ];
        const priorityOut = this.linePriority[OBJ];
        const math = this.objMath;
        math.fill(0);

        // Sprites on this line, up to 32, in priority order
        const first = this.oamPriority ? (this.oamAddress >> 2) & 0x7F : 0;
        const items: number[] = [];
        let rangeCount = 0;
        for (let n = 0; n < 128; n++) {
            const index = (first + n) & 0x7F;
            const { x, y, width, height: fullHeight } = this.objectBounds(index);
            if (x > 256 && x + width - 1 < 512) continue;
            const height = interlace ? fullHeight >> 1 : fullHeight;
            if ((v >= y && v < y + height) || (y + height >= 256 && v < ((y + height) & 0xFF))) {
                if (rangeCount++ >= OBJ_RANGE_LIMIT) break;
                items.push(index);
            }
        }
        if (rangeCount > OBJ_RANGE_LIMIT) this.rangeOver = true;

        // Their 8-pixel slivers, up to 34, fetched from the last sprite to the first
        const tiles: number[] = [];
        let tileCount = 0;
        fetch: for (let n = items.length - 1; n >= 0; n--) {
            const index = items[n];
            const { x, y: top, width, height } = this.objectBounds(index);
            const attributes = oam[index * 4 + 3];
            const character = oam[index * 4 + 2];
            const hflip = (attributes & 0x40) !== 0;
            const vflip = (attributes & 0x80) !== 0;

            let y = (v - top) & 0xFF;
            if (interlace) y <<= 1;
            if (vflip) {
                if (width === height) y = height - 1 - y;
                else if (y < width) y = width - 1 - y;
                else y = width + (width - 1) - (y - width);
            }
            if (interlace) y = vflip ? y - field : y + field;
            y &= 0xFF;

            let tileBase = this.objTileBase;
            if (attributes & 1) tileBase += (1 + this.objNameSelect) << 12;
            const characterX = character & 15;
            const characterY = (((character >> 4) + (y >> 3)) & 15) << 4;
            const tileWidth = width >> 3;
            for (let tileX = 0; tileX < tileWidth; tileX++) {
                const objectX = (x + (tileX << 3)) & 511;
                if (x !== 256 && objectX >= 256 && objectX + 7 < 512) continue;
                if (tileCount++ >= OBJ_TILE_LIMIT) break fetch;
                const mirrorX = hflip ? tileWidth - 1 - tileX : tileX;
                const address = (tileBase + ((characterY + ((characterX + mirrorX) & 15)) << 4)) & 0x7FFF;
                // Packed: address of the row, x, flip, palette, priority
                tiles.push(address + (y & 7), objectX, hflip ? 7 : 0, (attributes >> 1) & 7, (attributes >> 4) & 3);
            }
        }
        if (tileCount > OBJ_TILE_LIMIT) this.timeOver = true;

        for (let t = 0; t < tiles.length; t += 5) {
            const rowAddress = tiles[t];
            const w0 = vram[rowAddress & 0x7FFF];
            const w1 = vram[(rowAddress + 8) & 0x7FFF];
            const mirrorX = tiles[t + 2];
            const palette = tiles[t + 3];
            const priority = tiles[t + 4];
            let screenX = tiles[t + 1];
            for (let px = 0; px < 8; px++, screenX = (screenX + 1) & 511) {
                if (screenX >= 256) continue;
                const shift = 7 - (px ^ mirrorX);
                const color = ((w0 >> shift) & 1) | (((w0 >> (shift + 8)) & 1) << 1) |
                    (((w1 >> shift) & 1) << 2) | (((w1 >> (shift + 8)) & 1) << 3);
                if (color === 0) continue;
                colorOut[screenX] = cgram[128 + (palette << 4) + color];
                priorityOut[screenX] = priority;
                math[screenX] = palette >= 4 ? 1 : 0;
            }
        }
    }

    private objectBounds(index: number): { x: number; y: number; width: number; height: number } {
        const high = this.oam[0x200 + (index >> 2)] >> ((index & 3) * 2);
        const large = (high & 2) !== 0;
        let height = (large ? OBJ_LARGE_HEIGHT : OBJ_SMALL_HEIGHT)[this.objBaseSize];
        // A hardware quirk: small 16x32 sprites are 16x16 with OBJ interlace
        if (!large && this.setini & 0x02 && this.objBaseSize >= 6) height = 16;
        return {
            x: this.oam[index * 4] | ((high & 1) << 8),
            y: this.oam[index * 4 + 1],
            width: (large ? OBJ_LARGE_WIDTH : OBJ_SMALL_WIDTH)[this.objBaseSize],
            height,
        };
    }

    // Returns false when the layer has no window enabled
    private renderWindow(layer: number): boolean {
        const select = this.windowSelect[layer];
        const enable1 = (select & 2) !== 0;
        const enable2 = (select & 8) !== 0;
        const mask = this.windowMask[layer];
        if (!enable1 && !enable2) return false;

        const invert1 = (select & 1) !== 0;
        const invert2 = (select & 4) !== 0;
        const logic = this.windowLogic[layer];
        for (let x = 0; x < SCREEN_WIDTH; x++) {
            const in1 = (x >= this.window1Left && x <= this.window1Right) !== invert1;
            const in2 = (x >= this.window2Left && x <= this.window2Right) !== invert2;
            let inside: boolean;
            if (!enable2) inside = in1;
            else if (!enable1) inside = in2;
            else if (logic === 0) inside = in1 || in2;
            else if (logic === 1) inside = in1 && in2;
            else if (logic === 2) inside = in1 !== in2;
            else inside = in1 === in2;
            mask[x] = inside ? 1 : 0;
        }
        return true;
    }

    private priorityOrder(): number[] {
        switch (this.bgMode) {
            case 0: return PRIORITIES.mode0;
            case 1: return this.bg3Priority ? PRIORITIES.mode1Bg3 : PRIORITIES.mode1;
            case 6: return PRIORITIES.mode6;
            case 7: return this.setini & 0x40 ? PRIORITIES.mode7Extbg : PRIORITIES.mode7;
            default: return PRIORITIES.mode2to5;
        }
    }

    // The front layer at x of the main or sub screen, or BACKDROP. Backgrounds' pixels are at
    // bgIndex, which differs from x when they are drawn 512 wide.
    private topLayer(x: number, bgIndex: number, order: number[], screen: number, windowed: number): number {
        for (let i = 0; i < order.length; i++) {
            const layer = order[i] >> 2;
            if (!(screen & (1 << layer))) continue;
            if (this.linePriority[layer][layer === OBJ ? x : bgIndex] !== (order[i] & 3)) continue;
            if (windowed & (1 << layer) && this.windowActive[layer] && this.windowMask[layer][x]) continue;
            return layer;
        }
        return BACKDROP;
    }

    private layerColor(layer: number, x: number, bgIndex: number, backdrop: number): number {
        if (layer === BACKDROP) return backdrop;
        return this.lineColor[layer][layer === OBJ ? x : bgIndex];
    }

    private layerMath(layer: number, x: number): boolean {
        if (layer === OBJ) return (this.colorMath & 0x10) !== 0 && this.objMath[x] === 1;
        return (this.colorMath & (1 << layer)) !== 0;
    }

    // Color math on one screen's pixel with the other screen's, or with the fixed color
    private shade(color: number, other: number, otherTransparent: boolean, black: boolean, math: boolean,
        addSubscreen: boolean, subtract: boolean, half: boolean): number {
        if (black) color = 0;
        if (!math) return color;
        const transparent = addSubscreen && otherTransparent;
        const addend = addSubscreen && !transparent ? other : this.fixedColor;
        return blend(color, addend, subtract, half && !black && !transparent);
    }

    private compose(row: number): void {
        const order = this.priorityOrder();
        const bgHires = this.bgMode === 5 || this.bgMode === 6;
        const hires = bgHires || (this.setini & 0x08) !== 0;
        const blackRegion = this.colorSelect >> 6;
        const mathRegion = (this.colorSelect >> 4) & 3;
        const addSubscreen = (this.colorSelect & 2) !== 0;
        const subtract = (this.colorMath & 0x80) !== 0;
        const half = (this.colorMath & 0x40) !== 0;
        const colorWindow = this.windowMask[COLOR_WINDOW];
        const colorWindowActive = this.windowActive[COLOR_WINDOW];
        const levels = BRIGHTNESS[this.brightness];
        const rgba = (color: number) => 0xFF000000 | (levels[(color >> 10) & 31] << 16) | (levels[(color >> 5) & 31] << 8) | levels[color & 31];

        for (let x = 0; x < SCREEN_WIDTH; x++) {
            // In modes 5 and 6 the main screen's backgrounds are the odd pixels of 512, the sub screen's the even ones
            const mainIndex = bgHires ? (x << 1) | 1 : x;
            const subIndex = bgHires ? x << 1 : x;
            const mainLayer = this.topLayer(x, mainIndex, order, this.mainScreen, this.mainWindow);
            const subLayer = addSubscreen || hires ? this.topLayer(x, subIndex, order, this.subScreen, this.subWindow) : BACKDROP;
            // The sub screen's backdrop is the fixed color, except in hi-res where it shows like the main screen's
            const mainColor = this.layerColor(mainLayer, x, mainIndex, this.cgram[0]);
            const subColor = this.layerColor(subLayer, x, subIndex, hires ? this.cgram[0] : this.fixedColor);

            const inColorWindow = colorWindowActive && colorWindow[x] === 1;
            const black = blackRegion === 3 || (blackRegion === 2 && inColorWindow) || (blackRegion === 1 && !inColorWindow);
            const mathAllowed = mathRegion === 0 || (mathRegion === 1 && inColorWindow) || (mathRegion === 2 && !inColorWindow);

            const math = mathAllowed && this.layerMath(mainLayer, x);
            const main = rgba(this.shade(mainColor, subColor, subLayer === BACKDROP, black, math, addSubscreen, subtract, half));
            this.frame[row + (x << 1) + 1] = main;
            if (hires) {
                const subMath = mathAllowed && this.layerMath(subLayer, x);
                this.frame[row + (x << 1)] = rgba(this.shade(subColor, mainColor, mainLayer === BACKDROP, black, subMath, addSubscreen, subtract, half));
            } else {
                this.frame[row + (x << 1)] = main;
            }
        }
    }
}

// Direct color: 8-bit BGR 3.3.2 color, with the palette number's bits as the low bits
function directColorOf(color: number, palette: number): number {
    const r = ((color & 0x07) << 2) | ((palette & 1) << 1);
    const g = ((color & 0x38) >> 1) | (palette & 2);
    const b = ((color & 0xC0) >> 3) | (palette & 4);
    return r | (g << 5) | (b << 10);
}

function blend(a: number, b: number, subtract: boolean, half: boolean): number {
    let result = 0;
    for (let shift = 0; shift < 15; shift += 5) {
        const x = (a >> shift) & 31;
        const y = (b >> shift) & 31;
        let c = subtract ? Math.max(0, x - y) : x + y;
        if (half) c >>= 1;
        result |= Math.min(31, c) << shift;
    }
    return result;
}

export default Ppu;

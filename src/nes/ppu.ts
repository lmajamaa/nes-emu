import { IndexedImage } from './graphics';
import LoopyRegister from './registers/loopyRegister';
import { MIRROR } from './constants';
import StatusRegister from './registers/statusRegister';
import type Cartridge from './cartridge';
import ControlRegister from './registers/controlRegister';
import MaskRegister from './registers/maskRegister';

export interface ObjectAttributeEntry {
    y: number;
    id: number;
    attribute: number;
    x: number;
}

const MAX_SPRITES_PER_SCANLINE = 8;

class Ppu {
    private cartridge: Cartridge | null = null;

    // Pattern tables are on the cartridge, the PPU has room for two nametables and the palettes
    readonly nametables = [new Uint8Array(1024), new Uint8Array(1024)];
    readonly paletteRam = new Uint8Array(32);

    // The picture as it's drawn
    readonly screen = new IndexedImage(256, 240);
    private readonly patternTables = [new IndexedImage(128, 128), new IndexedImage(128, 128)];

    frameComplete = false;
    scanline = 0;
    cycle = 0;
    nmi = false;

    readonly status = new StatusRegister();
    readonly control = new ControlRegister();
    readonly mask = new MaskRegister();

    addressLatch = 0x00;
    dataBuffer = 0x00;

    readonly vramAddr = new LoopyRegister();
    readonly tramAddr = new LoopyRegister();
    fineX = 0x00;

    bgNextTileId = 0x00;
    bgNextTileAttrib = 0x00;
    bgNextTileLsb = 0x00;
    bgNextTileMsb = 0x00;

    bgShifterPatternLo = 0x0000;
    bgShifterPatternHi = 0x0000;
    bgShifterAttribLo = 0x0000;
    bgShifterAttribHi = 0x0000;

    // 64 sprites of 4 bytes: y, id, attribute, x
    readonly oam = new Uint8Array(256);
    oamAddr = 0x00;

    private spriteScanline: ObjectAttributeEntry[] = [];
    private readonly spriteShifterPatternLo = new Uint8Array(MAX_SPRITES_PER_SCANLINE);
    private readonly spriteShifterPatternHi = new Uint8Array(MAX_SPRITES_PER_SCANLINE);
    private spriteZeroHitPossible = false;
    private spriteZeroBeingRendered = false;

    // Total PPU cycles, used as the time for the mapper watching the address bus
    private cycleCount = 0;

    connectCartridge(cartridge: Cartridge): void {
        this.cartridge = cartridge;
        for (const nametable of this.nametables) nametable.fill(0x00);
        this.paletteRam.fill(0x00);
    }

    incrementScrollX(): void {
        if (this.mask.renderBackground || this.mask.renderSprites) {

            if (this.vramAddr.coarseX === 31) {
                this.vramAddr.coarseX = 0;
                this.vramAddr.nametableX ^= 1;
            } else {
                this.vramAddr.coarseX++;
            }
        }
    }

    incrementScrollY(): void {
        if (this.mask.renderBackground || this.mask.renderSprites) {

            if (this.vramAddr.fineY < 7) {
                this.vramAddr.fineY++;
            } else {
                this.vramAddr.fineY = 0;

                if (this.vramAddr.coarseY === 29) {
                    this.vramAddr.coarseY = 0;
                    this.vramAddr.nametableY ^= 1;
                } else if (this.vramAddr.coarseY === 31) {
                    this.vramAddr.coarseY = 0;
                } else {
                    this.vramAddr.coarseY++;
                }
            }
        }
    }

    transferAddressX(): void {
        // Ony if rendering is enabled
        if (this.mask.renderBackground || this.mask.renderSprites) {
            this.vramAddr.nametableX = this.tramAddr.nametableX;
            this.vramAddr.coarseX = this.tramAddr.coarseX;
        }
    }

    transferAddressY(): void {
        // Ony if rendering is enabled
        if (this.mask.renderBackground || this.mask.renderSprites) {
            this.vramAddr.fineY = this.tramAddr.fineY;
            this.vramAddr.nametableY = this.tramAddr.nametableY;
            this.vramAddr.coarseY = this.tramAddr.coarseY;
        }
    }

    loadBackgroundShifters(): void {

        this.bgShifterPatternLo = (this.bgShifterPatternLo & 0xFF00) | this.bgNextTileLsb;
        this.bgShifterPatternHi = (this.bgShifterPatternHi & 0xFF00) | this.bgNextTileMsb;
        this.bgShifterAttribLo = (this.bgShifterAttribLo & 0xFF00) | ((this.bgNextTileAttrib & 0b01) ? 0xFF : 0x00);
        this.bgShifterAttribHi = (this.bgShifterAttribHi & 0xFF00) | ((this.bgNextTileAttrib & 0b10) ? 0xFF : 0x00);
    }

    updateShifters(): void {
        if (this.mask.renderBackground) {
            // Shifting background tile pattern row
            this.bgShifterPatternLo <<= 1;
            this.bgShifterPatternHi <<= 1;

            // Shifting palette attributes by 1
            this.bgShifterAttribLo <<= 1;
            this.bgShifterAttribHi <<= 1;
        }

        // Sprites count down their x position, and start shifting out once it reaches 0
        if (this.mask.renderSprites && this.cycle >= 1 && this.cycle < 258) {
            this.spriteScanline.forEach((sprite, i) => {
                if (sprite.x > 0) {
                    sprite.x--;
                } else {
                    this.spriteShifterPatternLo[i] <<= 1;
                    this.spriteShifterPatternHi[i] <<= 1;
                }
            });
        }
    }

    // Finds the sprites visible on the next scanline
    evaluateSprites(): void {
        this.spriteScanline = [];
        this.spriteShifterPatternLo.fill(0);
        this.spriteShifterPatternHi.fill(0);
        this.spriteZeroHitPossible = false;

        const height = this.control.spriteMode ? 16 : 8;
        for (let n = 0; n < 64; n++) {
            const diff = this.scanline - this.oam[n * 4];
            if (diff >= 0 && diff < height) {
                if (this.spriteScanline.length === MAX_SPRITES_PER_SCANLINE) {
                    this.status.spriteOverflow = 1;
                    break;
                }
                if (n === 0) this.spriteZeroHitPossible = true;
                this.spriteScanline.push({
                    y: this.oam[n * 4],
                    id: this.oam[n * 4 + 1],
                    attribute: this.oam[n * 4 + 2],
                    x: this.oam[n * 4 + 3],
                });
            }
        }
    }

    private spritePatternAddress(slot: number): number {
        const sprite = this.spriteScanline[slot];
        // Empty slots still fetch tile $FF, which matters to mappers watching the address bus
        if (!sprite) return this.control.spriteMode ? 0x1FF0 : (this.control.patternSprite << 12) | 0x0FF0;

        const flipVertical = (sprite.attribute & 0x80) !== 0;
        const row = this.scanline - sprite.y;
        if (!this.control.spriteMode) {
            // 8x8 sprites use the pattern table selected in the control register
            return (this.control.patternSprite << 12)
                | (sprite.id << 4)
                | (flipVertical ? 7 - row : row);
        }
        // 8x16 sprites: bit 0 of the id selects the pattern table, and a
        // vertical flip also swaps the top and bottom tiles
        const flippedRow = flipVertical ? 15 - row : row;
        return ((sprite.id & 0x01) << 12)
            | (((sprite.id & 0xFE) + (flippedRow < 8 ? 0 : 1)) << 4)
            | (flippedRow & 0x07);
    }

    // Cycles 257-320 fetch the patterns of the next scanline's 8 sprites, 8 cycles each:
    // two unused nametable reads, then the low and high pattern bytes
    fetchSprites(): void {
        const slot = (this.cycle - 257) >> 3;
        switch ((this.cycle - 257) & 0x07) {
            case 0:
            case 2:
                this.ppuRead(0x2000 | (this.vramAddr.reg & 0x0FFF));
                break;
            case 4:
            case 6: {
                const high = ((this.cycle - 257) & 0x07) === 6;
                let data = this.ppuRead(this.spritePatternAddress(slot) + (high ? 8 : 0));
                const sprite = this.spriteScanline[slot];
                if (!sprite) data = 0;
                else if (sprite.attribute & 0x40) data = flipByte(data);
                if (high) {
                    this.spriteShifterPatternHi[slot] = data;
                } else {
                    this.spriteShifterPatternLo[slot] = data;
                }
                break;
            }
        }
    }

    clock(): void {
        this.cycleCount++;
        const rendering = this.mask.renderBackground || this.mask.renderSprites;

        if (this.scanline >= -1 && this.scanline < 240) {

            if (this.scanline === 0 && this.cycle === 0) {
                // "Odd frame" cycle skip
                this.cycle = 1;
            }

            if (this.scanline === -1 && this.cycle === 1) {
                this.status.verticalBlank = 0;
                this.status.spriteOverflow = 0;
                this.status.spriteZeroHit = 0;
                this.spriteScanline = [];
                this.spriteShifterPatternLo.fill(0);
                this.spriteShifterPatternHi.fill(0);
            }

            if ((this.cycle >= 2 && this.cycle < 258) || (this.cycle >= 321 && this.cycle < 338)) {

                this.updateShifters();

                // Nothing is fetched while rendering is off
                switch (rendering ? (this.cycle - 1) % 8 : -1) {
                    case 0:
                        this.loadBackgroundShifters();
                        this.bgNextTileId = this.ppuRead(0x2000 | (this.vramAddr.reg & 0x0FFF));
                        break;
                    case 2:
                        this.bgNextTileAttrib = this.ppuRead(0x23C0 | (this.vramAddr.nametableY << 11)
                            | (this.vramAddr.nametableX << 10)
                            | ((this.vramAddr.coarseY >> 2) << 3)
                            | (this.vramAddr.coarseX >> 2));
                        if (this.vramAddr.coarseY & 0x02) this.bgNextTileAttrib >>= 4;
                        if (this.vramAddr.coarseX & 0x02) this.bgNextTileAttrib >>= 2;
                        this.bgNextTileAttrib &= 0x03;
                        break;
                    case 4:
                        this.bgNextTileLsb = this.ppuRead((this.control.patternBackground << 12)
                            + (this.bgNextTileId << 4)
                            + (this.vramAddr.fineY + 0));
                        break;
                    case 6:
                        this.bgNextTileMsb = this.ppuRead((this.control.patternBackground << 12)
                            + (this.bgNextTileId << 4)
                            + (this.vramAddr.fineY + 8));
                        break;
                    case 7:
                        this.incrementScrollX();
                        break;
                    default:
                        break;
                }
            }

            if (this.cycle === 256) {
                this.incrementScrollY();
            }

            if (this.cycle === 257) {
                this.loadBackgroundShifters();
                this.transferAddressX();
            }

            if (this.scanline === -1 && this.cycle >= 280 && this.cycle < 305) {
                this.transferAddressY();
            }

            // Sprites are never drawn on scanline 0, as nothing is evaluated on the pre-render line
            if (this.cycle === 257 && this.scanline >= 0) {
                this.evaluateSprites();
            }

            if (rendering && this.cycle >= 257 && this.cycle <= 320) {
                this.fetchSprites();
            }

            // Unused nametable fetch at the end of the scanline
            if (rendering && this.cycle === 339) {
                this.ppuRead(0x2000 | (this.vramAddr.reg & 0x0FFF));
            }
        }

        if (this.scanline === 241 && this.cycle === 1) {
            this.status.verticalBlank = 1;
            if (this.control.enableNmi === 1) {
                this.nmi = true;
            }
        }

        let bgPixel = 0x00;
        let bgPalette = 0x00;

        // We only render backgrounds if the PPU is enabled to do so. Note if 
        // background rendering is disabled, the pixel and palette combine
        // to form 0x00. This will fall through the colour tables to yield
        // the current background colour in effect
        if (this.mask.renderBackground) {
            // Handle Pixel Selection by selecting the relevant bit
            // depending upon fine x scolling. This has the effect of
            // offsetting ALL background rendering by a set number
            // of pixels, permitting smooth scrolling
            const bitMux = 0x8000 >> this.fineX;

            // Select Plane pixels by extracting from the shifter 
            // at the required location. 
            const p0Pixel = (this.bgShifterPatternLo & bitMux) > 0 ? 1 : 0;
            const p1Pixel = (this.bgShifterPatternHi & bitMux) > 0 ? 1 : 0;

            // Combine to form pixel index
            bgPixel = (p1Pixel << 1) | p0Pixel;

            // Get palette
            const bgPal0 = (this.bgShifterAttribLo & bitMux) > 0 ? 1 : 0;
            const bgPal1 = (this.bgShifterAttribHi & bitMux) > 0 ? 1 : 0;
            bgPalette = (bgPal1 << 1) | bgPal0;

            if (!this.mask.renderBackgroundLeft && this.cycle - 1 < 8) bgPixel = 0;
        }

        let fgPixel = 0x00;
        let fgPalette = 0x00;
        let fgPriority = false;

        if (this.mask.renderSprites) {
            this.spriteZeroBeingRendered = false;

            // Sprites earlier in OAM have priority, so the first opaque pixel wins
            for (let i = 0; i < this.spriteScanline.length; i++) {
                const sprite = this.spriteScanline[i];
                if (sprite.x === 0) {
                    const fgPixelLo = (this.spriteShifterPatternLo[i] & 0x80) > 0 ? 1 : 0;
                    const fgPixelHi = (this.spriteShifterPatternHi[i] & 0x80) > 0 ? 1 : 0;
                    fgPixel = (fgPixelHi << 1) | fgPixelLo;
                    fgPalette = (sprite.attribute & 0x03) + 0x04;
                    fgPriority = (sprite.attribute & 0x20) === 0;

                    if (fgPixel !== 0) {
                        if (i === 0) this.spriteZeroBeingRendered = true;
                        break;
                    }
                }
            }

            if (!this.mask.renderSpritesLeft && this.cycle - 1 < 8) fgPixel = 0;
        }

        let pixel = 0x00;
        let palette = 0x00;

        // Transparent pixels always show the backdrop colour at $3F00
        if (bgPixel === 0 && fgPixel > 0) {
            pixel = fgPixel;
            palette = fgPalette;
        } else if (bgPixel > 0 && fgPixel === 0) {
            pixel = bgPixel;
            palette = bgPalette;
        } else if (bgPixel > 0 && fgPixel > 0) {
            pixel = fgPriority ? fgPixel : bgPixel;
            palette = fgPriority ? fgPalette : bgPalette;

            // Sprite zero hit happens when an opaque pixel of sprite 0 overlaps
            // an opaque background pixel, whatever the priority
            if (this.spriteZeroHitPossible && this.spriteZeroBeingRendered
                && this.cycle >= 1 && this.cycle < 256) {
                this.status.spriteZeroHit = 1;
            }
        }

        this.screen.setPixel(this.cycle - 1, this.scanline, this.colorOf(palette, pixel));

        // Advance renderer
        this.cycle++;
        if (this.cycle >= 341) {
            this.cycle = 0;
            this.scanline++;
            if (this.scanline >= 261) {
                this.scanline = -1;
                this.frameComplete = true;
            }
        }
    }

    // Communication with main bus
    cpuRead(addr: number, _readOnly = false): number {
        // Only status, OAM data and PPU data can be read
        switch (addr) {
            case 0x0002: { // Status
                const data = (this.status.reg & 0xE0) | (this.dataBuffer & 0x1F);
                this.status.verticalBlank = 0;
                this.addressLatch = 0;
                return data;
            }
            case 0x0004: // OAM data
                return this.oam[this.oamAddr];
            case 0x0007: { // PPU data
                // Reads are delayed through a buffer, except for the palettes
                let data = this.dataBuffer;
                this.dataBuffer = this.ppuRead(this.vramAddr.reg);
                if (this.vramAddr.reg >= 0x3F00) data = this.dataBuffer;
                this.incrementVramAddress();
                return data;
            }
            default:
                return 0x00;
        }
    }

    cpuWrite(addr: number, data: number): void {
        switch (addr) {
            case 0x0000: // Control
                this.control.reg = data;
                this.tramAddr.nametableX = this.control.nametableX;
                this.tramAddr.nametableY = this.control.nametableY;
                break;
            case 0x0001: // Mask
                this.mask.reg = data;
                break;
            case 0x0002: // Status
                break;
            case 0x0003: // OAM address
                this.oamAddr = data;
                break;
            case 0x0004: // OAM data
                this.oam[this.oamAddr] = data;
                this.oamAddr = (this.oamAddr + 1) & 0xFF;
                break;
            case 0x0005: // Scroll
                if (this.addressLatch === 0) {
                    this.fineX = data & 0x07;
                    this.tramAddr.coarseX = data >> 3;
                    this.addressLatch = 1;
                } else {
                    this.tramAddr.fineY = data & 0x07;
                    this.tramAddr.coarseY = data >> 3;
                    this.addressLatch = 0;
                }
                break;
            case 0x0006: // PPU address
                if (this.addressLatch === 0) {
                    this.tramAddr.reg = (this.tramAddr.reg & 0x00FF) | (data << 8);
                    this.addressLatch = 1;
                } else {
                    this.tramAddr.reg = (this.tramAddr.reg & 0xFF00) | data;
                    this.vramAddr.reg = this.tramAddr.reg;
                    this.putAddressOnBus(this.vramAddr.reg);
                    this.addressLatch = 0;
                }
                break;
            case 0x0007: // PPU data
                this.ppuWrite(this.vramAddr.reg, data);
                this.incrementVramAddress();
                break;
            default:
                break;
        }
    }
    // Outside of rendering the PPU address bus holds the VRAM address
    private incrementVramAddress(): void {
        this.vramAddr.reg += (this.control.incrementMode ? 32 : 1);
        this.putAddressOnBus(this.vramAddr.reg);
    }

    private putAddressOnBus(addr: number): void {
        this.cartridge?.ppuAddress(addr & 0x3FFF, this.cycleCount);
    }

    // The PPU has room for two of the four nametables, the cartridge decides how they are mirrored
    private nametable(addr: number): Uint8Array {
        const table = (addr >> 10) & 0x03;
        switch (this.cartridge?.mirror) {
            case MIRROR.VERTICAL: return this.nametables[table & 0x01];
            case MIRROR.HORIZONTAL: return this.nametables[table >> 1];
            case MIRROR.ONESCREEN_HI: return this.nametables[1];
            default: return this.nametables[0];
        }
    }

    // The backdrop entries of the sprite palettes mirror those of the background palettes
    private paletteIndex(addr: number): number {
        addr &= 0x001F;
        return (addr & 0x13) === 0x10 ? addr & 0x0F : addr;
    }

    // Communication with PPU bus
    // Read-only reads are for debugging, they don't appear on the bus
    ppuRead(addr: number, readOnly = false): number {
        addr &= 0x3FFF;
        if (!readOnly) this.putAddressOnBus(addr);
        // Nothing to read without a cartridge
        if (!this.cartridge) return 0x00;

        const fromCartridge = this.cartridge.ppuRead(addr);
        if (fromCartridge !== null) return fromCartridge;
        if (addr >= 0x2000 && addr <= 0x3EFF) return this.nametable(addr)[addr & 0x03FF];
        if (addr >= 0x3F00) return this.paletteRam[this.paletteIndex(addr)];
        return 0x00;
    }

    ppuWrite(addr: number, data: number): void {
        addr &= 0x3FFF;
        this.putAddressOnBus(addr);
        // Nothing to write to without a cartridge
        if (!this.cartridge || this.cartridge.ppuWrite(addr, data)) return;

        if (addr >= 0x2000 && addr <= 0x3EFF) {
            this.nametable(addr)[addr & 0x03FF] = data;
        } else if (addr >= 0x3F00) {
            // Palette RAM is only 6 bits wide, games rely on e.g. $FF being stored as $3F (black)
            this.paletteRam[this.paletteIndex(addr)] = data & 0x3F;
        }
    }

    reset(): void {
        this.fineX = 0x00;
        this.addressLatch = 0x00;
        this.dataBuffer = 0x00;
        this.scanline = 0;
        this.cycle = 0;
        this.bgNextTileId = 0x00;
        this.bgNextTileAttrib = 0x00;
        this.bgNextTileLsb = 0x00;
        this.bgNextTileMsb = 0x00;
        this.bgShifterPatternLo = 0x0000;
        this.bgShifterPatternHi = 0x0000;
        this.bgShifterAttribLo = 0x0000;
        this.bgShifterAttribHi = 0x0000;
        this.status.reg = 0x00;
        this.mask.reg = 0x00;
        this.control.reg = 0x00;
        this.vramAddr.reg = 0x0000;
        this.tramAddr.reg = 0x0000;
        this.oamAddr = 0x00;
        this.spriteScanline = [];
        this.spriteShifterPatternLo.fill(0);
        this.spriteShifterPatternHi.fill(0);
    }

    // For the debugger, a pattern table's 256 tiles in one of the palettes
    getPatternTable(i: number, palette: number): IndexedImage {
        const image = this.patternTables[i];
        for (let tileY = 0; tileY < 16; tileY++) {
            for (let tileX = 0; tileX < 16; tileX++) {
                const offset = i * 0x1000 + tileY * 256 + tileX * 16;
                for (let row = 0; row < 8; row++) {
                    const lsb = this.ppuRead(offset + row, true);
                    const msb = this.ppuRead(offset + row + 8, true);
                    for (let col = 0; col < 8; col++) {
                        const pixel = (((msb >> (7 - col)) & 0x01) << 1) | ((lsb >> (7 - col)) & 0x01);
                        image.setPixel(tileX * 8 + col, tileY * 8 + row, this.colorOf(palette, pixel));
                    }
                }
            }
        }
        return image;
    }

    // The colour in PALETTE of a pixel value in one of the 8 palettes
    colorOf(palette: number, pixel: number): number {
        return this.paletteRam[this.paletteIndex((palette << 2) + pixel)];
    }
}

function flipByte(b: number): number {
    b = ((b & 0xF0) >> 4) | ((b & 0x0F) << 4);
    b = ((b & 0xCC) >> 2) | ((b & 0x33) << 2);
    b = ((b & 0xAA) >> 1) | ((b & 0x55) << 1);
    return b;
}

export default Ppu;

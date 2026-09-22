import { palScreen, type Pixel, Sprite } from "./graphics";
import LoopyRegister from "./registers/loopyRegister";
import { MIRROR } from "./constants";
import StatusRegister from "./registers/statusRegister";
import type Cartridge from "./cartridge";
import ControlRegister from "./registers/controlRegister";
import MaskRegister from "./registers/maskRegister";

export interface ObjectAttributeEntry {
    y: number;
    id: number;
    attribute: number;
    x: number;
}

const MAX_SPRITES_PER_SCANLINE = 8;

class Ppu {
    private cartridge: Cartridge | null = null;

    // PPU memory: nametables, palettes and pattern tables (for CHR RAM, future)
    tblName: number[][] = [];
    tblPalette: number[] = [];
    tblPattern: number[][] = [];

    private readonly sprScreen = new Sprite(256, 240);
    private readonly sprNameTable = [new Sprite(256, 240), new Sprite(256, 240)];
    private readonly sprPatternTable = [new Sprite(128, 128), new Sprite(128, 128)];

    frame_complete = false;
    scanline = 0;
    cycle = 0;
    nmi = false;

    readonly status = new StatusRegister();
    readonly control = new ControlRegister();
    readonly mask = new MaskRegister();

    address_latch = 0x00;
    ppu_data_buffer = 0x00;

    readonly vram_addr = new LoopyRegister();
    readonly tram_addr = new LoopyRegister();
    fine_x = 0x00;

    bg_next_tile_id = 0x00;
    bg_next_tile_attrib = 0x00;
    bg_next_tile_lsb = 0x00;
    bg_next_tile_msb = 0x00;

    bg_shifter_pattern_lo = 0x0000;
    bg_shifter_pattern_hi = 0x0000;
    bg_shifter_attrib_lo = 0x0000;
    bg_shifter_attrib_hi = 0x0000;

    // 64 sprites of 4 bytes: y, id, attribute, x
    readonly oam = new Uint8Array(256);
    oam_addr = 0x00;

    private spriteScanline: ObjectAttributeEntry[] = [];
    private readonly sprite_shifter_pattern_lo = new Uint8Array(MAX_SPRITES_PER_SCANLINE);
    private readonly sprite_shifter_pattern_hi = new Uint8Array(MAX_SPRITES_PER_SCANLINE);
    private bSpriteZeroHitPossible = false;
    private bSpriteZeroBeingRendered = false;

    // Total PPU cycles, used as the time for the mapper watching the address bus
    private cycleCount = 0;

    connectCartridge(cartridge: Cartridge): void {
        this.cartridge = cartridge;
        this.tblName = [Array(1024).fill(0x00), Array(1024).fill(0x00)];
        this.tblPalette = Array(32).fill(0x00);
        this.tblPattern = [Array(4096).fill(0x00), Array(4096).fill(0x00)]; // Future
    }

    IncrementScrollX(): void {
        if (this.mask.render_background || this.mask.render_sprites) {

            if (this.vram_addr.coarse_x === 31) {
                this.vram_addr.coarse_x = 0;
                this.vram_addr.nametable_x ^= 1;
            } else {
                this.vram_addr.coarse_x++;
            }
        }
    }

    IncrementScrollY(): void {
        if (this.mask.render_background || this.mask.render_sprites) {

            if (this.vram_addr.fine_y < 7) {
                this.vram_addr.fine_y++;
            } else {
                this.vram_addr.fine_y = 0;

                if (this.vram_addr.coarse_y === 29) {
                    this.vram_addr.coarse_y = 0;
                    this.vram_addr.nametable_y ^= 1;
                } else if (this.vram_addr.coarse_y === 31) {
                    this.vram_addr.coarse_y = 0;
                } else {
                    this.vram_addr.coarse_y++;
                }
            }
        }
    }

    TransferAddressX(): void {
        // Ony if rendering is enabled
        if (this.mask.render_background || this.mask.render_sprites) {
            this.vram_addr.nametable_x = this.tram_addr.nametable_x;
            this.vram_addr.coarse_x = this.tram_addr.coarse_x;
        }
    }

    TransferAddressY(): void {
        // Ony if rendering is enabled
        if (this.mask.render_background || this.mask.render_sprites) {
            this.vram_addr.fine_y = this.tram_addr.fine_y;
            this.vram_addr.nametable_y = this.tram_addr.nametable_y;
            this.vram_addr.coarse_y = this.tram_addr.coarse_y;
        }
    }

    LoadBackgroundShifters(): void {

        this.bg_shifter_pattern_lo = (this.bg_shifter_pattern_lo & 0xFF00) | this.bg_next_tile_lsb;
        this.bg_shifter_pattern_hi = (this.bg_shifter_pattern_hi & 0xFF00) | this.bg_next_tile_msb;
        this.bg_shifter_attrib_lo = (this.bg_shifter_attrib_lo & 0xFF00) | ((this.bg_next_tile_attrib & 0b01) ? 0xFF : 0x00);
        this.bg_shifter_attrib_hi = (this.bg_shifter_attrib_hi & 0xFF00) | ((this.bg_next_tile_attrib & 0b10) ? 0xFF : 0x00);
    }

    UpdateShifters(): void {
        if (this.mask.render_background) {
            // Shifting background tile pattern row
            this.bg_shifter_pattern_lo <<= 1;
            this.bg_shifter_pattern_hi <<= 1;

            // Shifting palette attributes by 1
            this.bg_shifter_attrib_lo <<= 1;
            this.bg_shifter_attrib_hi <<= 1;
        }

        // Sprites count down their x position, and start shifting out once it reaches 0
        if (this.mask.render_sprites && this.cycle >= 1 && this.cycle < 258) {
            this.spriteScanline.forEach((sprite, i) => {
                if (sprite.x > 0) {
                    sprite.x--;
                } else {
                    this.sprite_shifter_pattern_lo[i] <<= 1;
                    this.sprite_shifter_pattern_hi[i] <<= 1;
                }
            });
        }
    }

    // Finds the sprites visible on the next scanline
    EvaluateSprites(): void {
        this.spriteScanline = [];
        this.sprite_shifter_pattern_lo.fill(0);
        this.sprite_shifter_pattern_hi.fill(0);
        this.bSpriteZeroHitPossible = false;

        const height = this.control.sprite_mode ? 16 : 8;
        for (let n = 0; n < 64; n++) {
            const diff = this.scanline - this.oam[n * 4];
            if (diff >= 0 && diff < height) {
                if (this.spriteScanline.length === MAX_SPRITES_PER_SCANLINE) {
                    this.status.sprite_overflow = 1;
                    break;
                }
                if (n === 0) this.bSpriteZeroHitPossible = true;
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
        if (!sprite) return this.control.sprite_mode ? 0x1FF0 : (this.control.pattern_sprite << 12) | 0x0FF0;

        const flipVertical = (sprite.attribute & 0x80) !== 0;
        const row = this.scanline - sprite.y;
        if (!this.control.sprite_mode) {
            // 8x8 sprites use the pattern table selected in the control register
            return (this.control.pattern_sprite << 12)
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
    FetchSprites(): void {
        const slot = (this.cycle - 257) >> 3;
        switch ((this.cycle - 257) & 0x07) {
            case 0:
            case 2:
                this.ppuRead(0x2000 | (this.vram_addr.reg & 0x0FFF));
                break;
            case 4:
            case 6: {
                const high = ((this.cycle - 257) & 0x07) === 6;
                let data = this.ppuRead(this.spritePatternAddress(slot) + (high ? 8 : 0));
                const sprite = this.spriteScanline[slot];
                if (!sprite) data = 0;
                else if (sprite.attribute & 0x40) data = flipByte(data);
                if (high) {
                    this.sprite_shifter_pattern_hi[slot] = data;
                } else {
                    this.sprite_shifter_pattern_lo[slot] = data;
                }
                break;
            }
        }
    }

    clock(): void {
        this.cycleCount++;
        const rendering = this.mask.render_background || this.mask.render_sprites;

        if (this.scanline >= -1 && this.scanline < 240) {

            if (this.scanline === 0 && this.cycle === 0) {
                // "Odd frame" cycle skip
                this.cycle = 1;
            }

            if (this.scanline === -1 && this.cycle === 1) {
                this.status.vertical_blank = 0;
                this.status.sprite_overflow = 0;
                this.status.sprite_zero_hit = 0;
                this.spriteScanline = [];
                this.sprite_shifter_pattern_lo.fill(0);
                this.sprite_shifter_pattern_hi.fill(0);
            }

            if ((this.cycle >= 2 && this.cycle < 258) || (this.cycle >= 321 && this.cycle < 338)) {

                this.UpdateShifters();

                // Nothing is fetched while rendering is off
                switch (rendering ? (this.cycle - 1) % 8 : -1) {
                    case 0:
                        this.LoadBackgroundShifters();
                        this.bg_next_tile_id = this.ppuRead(0x2000 | (this.vram_addr.reg & 0x0FFF));
                        break;
                    case 2:
                        this.bg_next_tile_attrib = this.ppuRead(0x23C0 | (this.vram_addr.nametable_y << 11)
                            | (this.vram_addr.nametable_x << 10)
                            | ((this.vram_addr.coarse_y >> 2) << 3)
                            | (this.vram_addr.coarse_x >> 2));
                        if (this.vram_addr.coarse_y & 0x02) this.bg_next_tile_attrib >>= 4;
                        if (this.vram_addr.coarse_x & 0x02) this.bg_next_tile_attrib >>= 2;
                        this.bg_next_tile_attrib &= 0x03;
                        break;
                    case 4:
                        this.bg_next_tile_lsb = this.ppuRead((this.control.pattern_background << 12)
                            + (this.bg_next_tile_id << 4)
                            + (this.vram_addr.fine_y + 0));
                        break;
                    case 6:
                        this.bg_next_tile_msb = this.ppuRead((this.control.pattern_background << 12)
                            + (this.bg_next_tile_id << 4)
                            + (this.vram_addr.fine_y + 8));
                        break;
                    case 7:
                        this.IncrementScrollX();
                        break;
                    default:
                        break;
                }
            }

            if (this.cycle === 256) {
                this.IncrementScrollY();
            }

            if (this.cycle === 257) {
                this.LoadBackgroundShifters();
                this.TransferAddressX();
            }

            if (this.scanline === -1 && this.cycle >= 280 && this.cycle < 305) {
                this.TransferAddressY();
            }

            // Sprites are never drawn on scanline 0, as nothing is evaluated on the pre-render line
            if (this.cycle === 257 && this.scanline >= 0) {
                this.EvaluateSprites();
            }

            if (rendering && this.cycle >= 257 && this.cycle <= 320) {
                this.FetchSprites();
            }

            // Unused nametable fetch at the end of the scanline
            if (rendering && this.cycle === 339) {
                this.ppuRead(0x2000 | (this.vram_addr.reg & 0x0FFF));
            }
        }

        if (this.scanline === 240) {
            // Post render scanline - do nothing
        }

        if (this.scanline === 241 && this.cycle === 1) {
            this.status.vertical_blank = 1;
            if (this.control.enable_nmi === 1) {
                this.nmi = true;
            }
        }

        let bg_pixel = 0x00;
        let bg_palette = 0x00;

        // We only render backgrounds if the PPU is enabled to do so. Note if 
        // background rendering is disabled, the pixel and palette combine
        // to form 0x00. This will fall through the colour tables to yield
        // the current background colour in effect
        if (this.mask.render_background) {
            // Handle Pixel Selection by selecting the relevant bit
            // depending upon fine x scolling. This has the effect of
            // offsetting ALL background rendering by a set number
            // of pixels, permitting smooth scrolling
            const bit_mux = 0x8000 >> this.fine_x;

            // Select Plane pixels by extracting from the shifter 
            // at the required location. 
            const p0_pixel = (this.bg_shifter_pattern_lo & bit_mux) > 0 ? 1 : 0;
            const p1_pixel = (this.bg_shifter_pattern_hi & bit_mux) > 0 ? 1 : 0;

            // Combine to form pixel index
            bg_pixel = (p1_pixel << 1) | p0_pixel;

            // Get palette
            const bg_pal0 = (this.bg_shifter_attrib_lo & bit_mux) > 0 ? 1 : 0;
            const bg_pal1 = (this.bg_shifter_attrib_hi & bit_mux) > 0 ? 1 : 0;
            bg_palette = (bg_pal1 << 1) | bg_pal0;

            if (!this.mask.render_background_left && this.cycle - 1 < 8) bg_pixel = 0;
        }

        let fg_pixel = 0x00;
        let fg_palette = 0x00;
        let fg_priority = false;

        if (this.mask.render_sprites) {
            this.bSpriteZeroBeingRendered = false;

            // Sprites earlier in OAM have priority, so the first opaque pixel wins
            for (let i = 0; i < this.spriteScanline.length; i++) {
                const sprite = this.spriteScanline[i];
                if (sprite.x === 0) {
                    const fg_pixel_lo = (this.sprite_shifter_pattern_lo[i] & 0x80) > 0 ? 1 : 0;
                    const fg_pixel_hi = (this.sprite_shifter_pattern_hi[i] & 0x80) > 0 ? 1 : 0;
                    fg_pixel = (fg_pixel_hi << 1) | fg_pixel_lo;
                    fg_palette = (sprite.attribute & 0x03) + 0x04;
                    fg_priority = (sprite.attribute & 0x20) === 0;

                    if (fg_pixel !== 0) {
                        if (i === 0) this.bSpriteZeroBeingRendered = true;
                        break;
                    }
                }
            }

            if (!this.mask.render_sprites_left && this.cycle - 1 < 8) fg_pixel = 0;
        }

        let pixel = 0x00;
        let palette = 0x00;

        // Transparent pixels always show the backdrop colour at $3F00
        if (bg_pixel === 0 && fg_pixel > 0) {
            pixel = fg_pixel;
            palette = fg_palette;
        } else if (bg_pixel > 0 && fg_pixel === 0) {
            pixel = bg_pixel;
            palette = bg_palette;
        } else if (bg_pixel > 0 && fg_pixel > 0) {
            pixel = fg_priority ? fg_pixel : bg_pixel;
            palette = fg_priority ? fg_palette : bg_palette;

            // Sprite zero hit happens when an opaque pixel of sprite 0 overlaps
            // an opaque background pixel, whatever the priority
            if (this.bSpriteZeroHitPossible && this.bSpriteZeroBeingRendered
                && this.cycle >= 1 && this.cycle < 256) {
                this.status.sprite_zero_hit = 1;
            }
        }

        this.sprScreen.setPixel(this.cycle - 1, this.scanline, this.getColorFromPaletteRam(palette, pixel));

        // Advance renderer
        this.cycle++;
        if (this.cycle >= 341) {
            this.cycle = 0;
            this.scanline++;
            if (this.scanline >= 261) {
                this.scanline = -1;
                this.frame_complete = true;
            }
        }
    }

    // Communication with main bus
    cpuRead(addr: number, _readOnly = false): number {
        let data = 0x00;

        switch (addr) {
            case 0x0000: // Control
                //data = this.getControl();
                break;
            case 0x0001: // Mask
                //data = this.getMask();
                break;
            case 0x0002: // Status
                data = (this.status.reg & 0xE0) | (this.ppu_data_buffer & 0x1F);
                this.status.vertical_blank = 0;
                this.address_latch = 0;
                break;
            case 0x0003: // OAM address
                break;
            case 0x0004: // OAM data
                data = this.oam[this.oam_addr];
                break;
            case 0x0005: // Scroll
                break;
            case 0x0006: // PPU address
                break;
            case 0x0007: // PPU data
                data = this.ppu_data_buffer;
                this.ppu_data_buffer = this.ppuRead(this.vram_addr.reg);

                if (this.vram_addr.reg >= 0x3F00) data = this.ppu_data_buffer;
                this.incrementVramAddress();
                break;
            default:
                break;
        }

        return data;
    }

    cpuWrite(addr: number, data: number): void {
        switch (addr) {
            case 0x0000: // Control
                this.control.reg = data;
                this.tram_addr.nametable_x = this.control.nametable_x;
                this.tram_addr.nametable_y = this.control.nametable_y;
                break;
            case 0x0001: // Mask
                this.mask.reg = data;
                break;
            case 0x0002: // Status
                break;
            case 0x0003: // OAM address
                this.oam_addr = data;
                break;
            case 0x0004: // OAM data
                this.oam[this.oam_addr] = data;
                this.oam_addr = (this.oam_addr + 1) & 0xFF;
                break;
            case 0x0005: // Scroll
                if (this.address_latch === 0) {
                    this.fine_x = data & 0x07;
                    this.tram_addr.coarse_x = data >> 3;
                    this.address_latch = 1;
                } else {
                    this.tram_addr.fine_y = data & 0x07;
                    this.tram_addr.coarse_y = data >> 3;
                    this.address_latch = 0;
                }
                break;
            case 0x0006: // PPU address
                if (this.address_latch === 0) {
                    this.tram_addr.reg = (this.tram_addr.reg & 0x00FF) | (data << 8);
                    this.address_latch = 1;
                } else {
                    this.tram_addr.reg = (this.tram_addr.reg & 0xFF00) | data;
                    this.vram_addr.reg = this.tram_addr.reg;
                    this.putAddressOnBus(this.vram_addr.reg);
                    this.address_latch = 0;
                }
                break;
            case 0x0007: // PPU data
                this.ppuWrite(this.vram_addr.reg, data);
                this.incrementVramAddress();
                break;
            default:
                break;
        }
    }
    // Outside of rendering the PPU address bus holds the VRAM address
    private incrementVramAddress(): void {
        this.vram_addr.reg += (this.control.increment_mode ? 32 : 1);
        this.putAddressOnBus(this.vram_addr.reg);
    }

    private putAddressOnBus(addr: number): void {
        this.cartridge?.ppuAddress(addr & 0x3FFF, this.cycleCount);
    }

    // The PPU has room for two of the four nametables, the cartridge decides how they are mirrored
    private nametable(addr: number): number[] {
        const table = (addr >> 10) & 0x03;
        switch (this.cartridge?.mirror) {
            case MIRROR.VERTICAL: return this.tblName[table & 0x01];
            case MIRROR.HORIZONTAL: return this.tblName[table >> 1];
            case MIRROR.ONESCREEN_HI: return this.tblName[1];
            default: return this.tblName[0];
        }
    }

    // Communication with PPU bus
    // Read-only reads are for debugging, they don't appear on the bus
    ppuRead(addr: number, readOnly = false): number {
        let data = 0x00;
        addr &= 0x3FFF;
        if (!readOnly) this.putAddressOnBus(addr);
        const object = { data };
        if (!this.cartridge) {
            // Nothing to read without a cartridge
        } else if (this.cartridge.ppuRead(addr, object)) {
            data = object.data;
        } else if (addr >= 0x0000 && addr <= 0x1FFF) {
            data = this.tblPattern[(addr & 0x1000) >> 12][addr & 0x0FFF];
        } else if (addr >= 0x2000 && addr <= 0x3EFF) {
            data = this.nametable(addr)[addr & 0x03FF];
        } else if (addr >= 0x3F00 && addr <= 0x3FFF) {
            addr &= 0x001F;
            if (addr === 0x0010) addr = 0x0000;
            if (addr === 0x0014) addr = 0x0004;
            if (addr === 0x0018) addr = 0x0008;
            if (addr === 0x001C) addr = 0x000C;
            data = this.tblPalette[addr];
        }

        return data;
    }
    ppuWrite(addr: number, data: number): void {
        addr &= 0x3FFF;
        this.putAddressOnBus(addr);

        if (!this.cartridge) {
            // Nothing to write to without a cartridge
        } else if (this.cartridge.ppuWrite(addr, data)) {
            // Cartridge address range

        } else if (addr >= 0x0000 && addr <= 0x1FFF) {
            this.tblPattern[(addr & 0x1000) >> 12][addr & 0x0FFF] = data;
        } else if (addr >= 0x2000 && addr <= 0x3EFF) {
            this.nametable(addr)[addr & 0x03FF] = data;
        } else if (addr >= 0x3F00 && addr <= 0x3FFF) {
            addr &= 0x001F;
            if (addr === 0x0010) addr = 0x0000;
            if (addr === 0x0014) addr = 0x0004;
            if (addr === 0x0018) addr = 0x0008;
            if (addr === 0x001C) addr = 0x000C;
            // Palette RAM is only 6 bits wide, games rely on e.g. $FF being stored as $3F (black)
            this.tblPalette[addr] = data & 0x3F;
        }
    }

    reset(): void {
        this.fine_x = 0x00;
        this.address_latch = 0x00;
        this.ppu_data_buffer = 0x00;
        this.scanline = 0;
        this.cycle = 0;
        this.bg_next_tile_id = 0x00;
        this.bg_next_tile_attrib = 0x00;
        this.bg_next_tile_lsb = 0x00;
        this.bg_next_tile_msb = 0x00;
        this.bg_shifter_pattern_lo = 0x0000;
        this.bg_shifter_pattern_hi = 0x0000;
        this.bg_shifter_attrib_lo = 0x0000;
        this.bg_shifter_attrib_hi = 0x0000;
        this.status.reg = 0x00;
        this.mask.reg = 0x00;
        this.control.reg = 0x00;
        this.vram_addr.reg = 0x0000;
        this.tram_addr.reg = 0x0000;
        this.oam_addr = 0x00;
        this.spriteScanline = [];
        this.sprite_shifter_pattern_lo.fill(0);
        this.sprite_shifter_pattern_hi.fill(0);
    }

    // Debugging utilities
    getScreen(): Sprite {
        return this.sprScreen;
    }

    getNameTable(i: number): Sprite {
        return this.sprNameTable[i];
    }

    getPatternTable(i: number, palette: number): Sprite {
        for (let nTileY = 0; nTileY < 16; nTileY++) {
            for (let nTileX = 0; nTileX < 16; nTileX++) {
                let nOffset = nTileY * 256 + nTileX * 16;

                for (let row = 0; row < 8; row++) {

                    let tile_lsb = this.ppuRead(i * 0x1000 + nOffset + row + 0, true);
                    let tile_msb = this.ppuRead(i * 0x1000 + nOffset + row + 8, true);
                    for (let col = 0; col < 8; col++) {
                        const pixel = ((tile_msb & 0x01) << 1) | (tile_lsb & 0x01);
                        tile_lsb >>= 1; tile_msb >>= 1;

                        this.sprPatternTable[i].setPixel(nTileX * 8 + (7 - col), nTileY * 8 + row, this.getColorFromPaletteRam(palette, pixel));
                    }
                }
            }

        }
        return this.sprPatternTable[i];
    }

    getColorFromPaletteRam(palette: number, pixel: number): Pixel {
        return palScreen[this.ppuRead(0x3F00 + (palette << 2) + pixel, true)];

    }
}

export default Ppu;
function flipByte(b: number): number {
    b = ((b & 0xF0) >> 4) | ((b & 0x0F) << 4);
    b = ((b & 0xCC) >> 2) | ((b & 0x33) << 2);
    b = ((b & 0xAA) >> 1) | ((b & 0x55) << 1);
    return b;
}

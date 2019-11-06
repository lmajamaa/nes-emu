import { palScreen, Sprite } from "./graphics";
import LoopyRegister from "./registers/loopyRegister";
import { MIRROR } from "./constants";
import StatusRegister from "./registers/statusRegister";
import ControlRegister from "./registers/controlRegister";
import MaskRegister from "./registers/maskRegister";

class Ppu {
    constructor() {
        this.cartridge = null;

        this.palScreen = []
        this.sprScreen = new Sprite(256, 240);
        this.sprNameTable = [new Sprite(256, 240), new Sprite(256, 240)];
        this.sprPatternTable = [new Sprite(128, 128), new Sprite(128, 128)];

        this.frame_complete = false;
        this.scanline = 0;
        this.cycle = 0;
        this.nmi = false;

        this.status = new StatusRegister();
        this.control = new ControlRegister();
        this.mask = new MaskRegister();

        this.address_latch = 0x00;
        this.ppu_data_buffer = 0x00;
        this.ppu_address = 0x0000;

        this.vram_addr = new LoopyRegister();
        this.tram_addr = new LoopyRegister();
        this.fine_x = 0x00;

        this.bg_next_tile_id = 0x00;
        this.bg_next_tile_attrib = 0x00;
        this.bg_next_tile_lsb = 0x00;
        this.bg_next_tile_msb = 0x00;

        this.bg_shifter_pattern_lo = 0x0000;
        this.bg_shifter_pattern_hi = 0x0000;
        this.bg_shifter_attrib_lo = 0x0000;
        this.bg_shifter_attrib_hi = 0x0000;

    }

    connectCartridge(cartridge) {
        this.cartridge = cartridge;
        this.tblName = Array(2).fill(Array(1024));
        this.tblPalette = Array(32).fill(0x00);
        this.tblPattern = Array(2).fill(Array(4096)); // Future
    }

    IncrementScrollX() {
        if (this.mask.render_background || this.mask.render_sprites) {

            if (this.vram_addr.coarse_x === 31) {
                this.vram_addr.coarse_x = 0;
                this.vram_addr.nametable_x = ~this.vram_addr.nametable_x;
            } else {
                this.vram_addr.coarse_x++;
            }
        }
    }

    IncrementScrollY() {
        if (this.mask.render_background || this.mask.render_sprites) {

            if (this.vram_addr.fine_y < 7) {
                this.vram_addr.fine_y++;
            } else {
                this.vram_addr = 0;

                if (this.vram_addr.coarse_y === 29) {
                    this.vram_addr.coarse_y = 0;
                    this.vram_addr.nametable_y = ~this.vram_addr.nametable_y;
                } else if (this.vram_addr.coarse_y === 31) {
                    this.vram_addr.coarse_y = 0;
                } else {
                    this.vram_addr.coarse_y++;
                }
            }
        }
    }

    TransferAddressX() {
        // Ony if rendering is enabled
        if (this.mask.render_background || this.mask.render_sprites) {
            this.vram_addr.nametable_x = this.tram_addr.nametable_x;
            this.vram_addr.coarse_x = this.tram_addr.coarse_x;
        }
    }

    TransferAddressY() {
        // Ony if rendering is enabled
        if (this.mask.render_background || this.mask.render_sprites) {
            this.vram_addr.fine_y = this.tram_addr.fine_y;
            this.vram_addr.nametable_y = this.tram_addr.nametable_y;
            this.vram_addr.coarse_y = this.tram_addr.coarse_y;
        }
    }

    LoadBackgroundShifters() {

        this.bg_shifter_pattern_lo = (this.bg_shifter_pattern_lo & 0xFF00) | this.bg_next_tile_lsb;
        this.bg_shifter_pattern_hi = (this.bg_shifter_pattern_hi & 0xFF00) | this.bg_next_tile_msb;
        this.bg_shifter_attrib_lo = (this.bg_shifter_attrib_lo & 0xFF00) | ((this.bg_next_tile_attrib & 0b01) ? 0xFF : 0x00);
        this.bg_shifter_attrib_hi = (this.bg_shifter_attrib_hi & 0xFF00) | ((this.bg_next_tile_attrib & 0b10) ? 0xFF : 0x00);
    }

    UpdateShifters() {
        if (this.mask.render_background) {
            // Shifting background tile pattern row
            this.bg_shifter_pattern_lo <<= 1;
            this.bg_shifter_pattern_hi <<= 1;

            // Shifting palette attributes by 1
            this.bg_shifter_attrib_lo <<= 1;
            this.bg_shifter_attrib_hi <<= 1;
        }
    }

    clock() {



        if (this.scanline >= -1 && this.scanline < 240) {

            if (this.scanline === -1 && this.cycle === 1) {
                this.vertical_blank = 0;
            }

            if ((this.cycle >= 2 && this.cycle < 258) || (this.cycle >= 321 && this.cycle < 338)) {

                this.UpdateShifters();

                switch ((this.cycle - 1 % 8)) {
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
                        this.bg_next_tile_lsb = this.ppuRead((this.control.pattern_background << 12))
                            + (this.bg_next_tile_id << 4)
                            + (this.vram_addr.fine_y + 0);
                        break;
                    case 6:
                        this.bg_next_tile_msb = this.ppuRead((this.control.pattern_background << 12))
                            + (this.bg_next_tile_id << 4)
                            + (this.vram_addr.fine_y + 8);
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
                this.TransferAddressX();
            }

            if (this.scanline === -1 && this.cycle >= 280 && this.cycle < 305) {
                this.TransferAddressY();
            }
        }

        if (this.scanline === 240) {
            // Post render scanline - do nothing
        }

        if (this.scanline === 241 && this.cycle === 1) {
            this.vertical_blank = 1;
            if (this.enable_nmi) {
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
            const p0_pixel = (this.bg_shifter_pattern_lo & bit_mux) > 0;
            const p1_pixel = (this.bg_shifter_pattern_hi & bit_mux) > 0;

            // Combine to form pixel index
            bg_pixel = (p1_pixel << 1) | p0_pixel;

            // Get palette
            const bg_pal0 = (this.bg_shifter_attrib_lo & bit_mux) > 0;
            const bg_pal1 = (this.bg_shifter_attrib_hi & bit_mux) > 0;
            bg_palette = (bg_pal1 << 1) | bg_pal0;
        }

        // this.sprScreen.setPixel(this.cycle - 1, this.scanline, palScreen[Math.floor(Math.random() * 2) === 0 ? 0x3F : 0x30]);
        this.sprScreen.setPixel(this.cycle - 1, this.scanline, this.getColorFromPaletteRam(bg_palette, bg_pixel));

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
    cpuRead(addr, readOnly = false) {
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
                break;
            case 0x0005: // Scroll
                break;
            case 0x0006: // PPU address
                break;
            case 0x0007: // PPU data
                data = this.ppu_data_buffer;
                this.ppu_data_buffer = this.ppuRead(this.vram_addr.reg);

                if (this.vram_addr.reg > 0x3F00) data = this.ppu_data_buffer;
                this.vram_addr.reg += (this.control.increment_mode ? 32 : 1);
                break;
            default:
                break;
        }

        return data;
    }

    cpuWrite(addr, data) {
        switch (addr) {
            case 0x0000: // Control
                this.control.reg = data;
                break;
            case 0x0001: // Mask
                this.mask.reg = data;
                break;
            case 0x0002: // Status
                break;
            case 0x0003: // OAM address
                break;
            case 0x0004: // OAM data
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
                    this.vram_addr = this.tram_addr;
                    this.address_latch = 0;
                }
                break;
            case 0x0007: // PPU data
                this.ppuWrite(this.vram_addr.reg, data);
                this.vram_addr.reg += (this.control.increment_mode ? 32 : 1);
                break;
            default:
                break;
        }
    }
    // Communication with PPU bus
    ppuRead(addr, readOnly = false) {
        let data = 0x00;
        addr &= 0x3FFF;
        const object = { data };
        if (this.cartridge.ppuRead(addr, object)) {
            data = object.data;
        } else if (addr >= 0x0000 && addr <= 0x1FFF) {
            data = this.tblPattern[(addr & 0x1000) >> 12][addr & 0x0FFF];
        } else if (addr >= 0x2000 && addr <= 0x3EFF) {
            if (this.cartridge.mirror === MIRROR.VERTICAL) {
                // Vertical
                if (addr >= 0x0000 && addr <= 0x03FF) {
                    data = this.tblName[0][addr & 0x03FF];
                }
                if (addr >= 0x0400 && addr <= 0x07FF) {
                    data = this.tblName[1][addr & 0x03FF];
                }
                if (addr >= 0x00800 && addr <= 0x0BFF) {
                    data = this.tblName[0][addr & 0x03FF];
                }
                if (addr >= 0x0C00 && addr <= 0x0FFF) {
                    data = this.tblName[1][addr & 0x03FF];
                }

            } else if (this.cartridge.mirror === MIRROR.HORIZONTAL) {
                if (addr >= 0x0000 && addr <= 0x03FF) {
                    data = this.tblName[0][addr & 0x03FF];
                }
                if (addr >= 0x0400 && addr <= 0x07FF) {
                    data = this.tblName[0][addr & 0x03FF];
                }
                if (addr >= 0x00800 && addr <= 0x0BFF) {
                    data = this.tblName[1][addr & 0x03FF];
                }
                if (addr >= 0x0C00 && addr <= 0x0FFF) {
                    data = this.tblName[1][addr & 0x03FF];
                }
            }
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
    ppuWrite(addr, data) {
        addr &= 0x3FFF;

        if (this.cartridge.ppuWrite(addr, data)) {

        } else if (addr >= 0x0000 && addr <= 0x1FFF) {
            this.tblPattern[(addr & 0x1000) >> 12][addr & 0x0FFF] = data;
        } else if (addr >= 0x2000 && addr <= 0x3EFF) {
            if (this.cartridge.mirror === MIRROR.VERTICAL) {
                // Vertical
                if (addr >= 0x0000 && addr <= 0x03FF) {
                    this.tblName[0][addr & 0x03FF] = data;
                }
                if (addr >= 0x0400 && addr <= 0x07FF) {
                    this.tblName[1][addr & 0x03FF] = data;
                }
                if (addr >= 0x00800 && addr <= 0x0BFF) {
                    this.tblName[0][addr & 0x03FF] = data;
                }
                if (addr >= 0x0C00 && addr <= 0x0FFF) {
                    this.tblName[1][addr & 0x03FF] = data;
                }

            } else if (this.cartridge.mirror === MIRROR.HORIZONTAL) {
                if (addr >= 0x0000 && addr <= 0x03FF) {
                    this.tblName[0][addr & 0x03FF] = data;
                }
                if (addr >= 0x0400 && addr <= 0x07FF) {
                    this.tblName[0][addr & 0x03FF] = data;
                }
                if (addr >= 0x00800 && addr <= 0x0BFF) {
                    this.tblName[1][addr & 0x03FF] = data;
                }
                if (addr >= 0x0C00 && addr <= 0x0FFF) {
                    this.tblName[1][addr & 0x03FF] = data;
                }
            }
        } else if (addr >= 0x3F00 && addr <= 0x3FFF) {
            addr &= 0x001F;
            if (addr === 0x0010) addr = 0x0000;
            if (addr === 0x0014) addr = 0x0004;
            if (addr === 0x0018) addr = 0x0008;
            if (addr === 0x001C) addr = 0x000C;
            //console.log('writing to palette', hex(addr,4), hex(data, 2));
            this.tblPalette[addr] = data;
        }
    }

    // Debugging utilities
    getScreen() {
        return this.sprScreen;
    }

    getNameTable(i) {
        return this.sprNameTable[i];
    }

    getPatternTable(i, palette) {
        for (let nTileY = 0; nTileY < 16; nTileY++) {
            for (let nTileX = 0; nTileX < 16; nTileX++) {
                let nOffset = nTileY * 256 + nTileX * 16;

                for (let row = 0; row < 8; row++) {

                    let tile_lsb = this.ppuRead(i * 0x1000 + nOffset + row + 0);
                    let tile_msb = this.ppuRead(i * 0x1000 + nOffset + row + 1);
                    for (let col = 0; col < 8; col++) {
                        const pixel = (tile_lsb & 0x01) + (tile_msb & 0x01);
                        tile_lsb >>= 1; tile_msb >>= 1;

                        this.sprPatternTable[i].setPixel(nTileX * 8 + (7 - col), nTileY * 8 + row, this.getColorFromPaletteRam(palette, pixel));
                    }
                }
            }

        }
        return this.sprPatternTable[i];
    }

    getColorFromPaletteRam(palette, pixel) {
        return palScreen[this.ppuRead(0x3F00 + (palette << 2) + pixel)];

    }
}

export default Ppu;
import { palScreen, Sprite } from "./graphics";

class Ppu {
    constructor() {
        this.cartridge = null;

        this.palScreen = []
        this.sprScreen = new Sprite(256, 240);
        this.sprNameTable = [new Sprite(256, 240), new Sprite(256, 240)];
        this.sprPatternTable = [new Sprite(128, 128), new Sprite(128, 128)];

        this.frame_complete = false;
        this.scanline=  0;
        this.cycle = 0;
    }

    connectCartridge(cartridge) {
        this.cartridge = cartridge;
        this.tblName = Array(2).fill(Array(1024));
        this.tblPalette = Array(32).fill(0x00);
        this.tblPattern = Array(2).fill(Array(4096)); // Future
    }

    clock() {
        // Fake noise
        this.sprScreen.setPixel(this.cycle - 1, this.scanline, palScreen[Math.floor(Math.random()*2) === 0 ? 0x3F : 0x30]);

        this.cycle++;
        if(this.cycle >= 341) {
            this.cycle = 0;
            this.scanline++;
            if(this.scanline >= 261) {
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
                break;
            case 0x0001: // Mask
                break;
            case 0x0002: // Status
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
                break;
            default:
                break;
        }

        return data;
    }
    cpuWrite(addr, data) {
        switch (addr) {
            case 0x0000: // Control
                break;
            case 0x0001: // Mask
                break;
            case 0x0002: // Status
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
        }

        return data;
    }
    ppuWrite(addr, data) {
        addr &= 0x3FFF;

        if (this.cartridge.ppuWrite(addr, data)) {

        }
    }

    // Debugging utilities
    getScreen() {
        return this.sprScreen;
    }
    getNameTable(i) {
        return this.sprNameTable[i];
    }
    getPatternTable(i) {
        return this.sprPatternTable[i];
    }
}

export default Ppu;
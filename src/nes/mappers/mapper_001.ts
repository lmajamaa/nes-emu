import Mapper from './mapper';
import { MIRROR, type Mirror } from '../constants';

const PRG_BANK_SIZE = 0x4000;
const CHR_BANK_SIZE = 0x1000;
// A 1 in bit 4 marks the start, once it reaches bit 0 the next write is the fifth
const SHIFT_EMPTY = 0x10;
// PRG mode 3: $8000 switchable, $C000 fixed to the last bank
const CONTROL_RESET = 0x0C;

// MMC1, see https://www.nesdev.org/wiki/MMC1
class Mmc1 extends Mapper {
    private shift = SHIFT_EMPTY;
    private control = CONTROL_RESET;
    private chrBank0 = 0;
    private chrBank1 = 0;
    private prgBank = 0;

    cpuMapRead(addr: number): number | null {
        if (addr < 0x8000 || addr > 0xFFFF) return null;

        const upper = addr >= 0xC000;
        let bank: number;
        switch ((this.control >> 2) & 0x03) {
            case 0:
            case 1:
                // 32KB mode ignores the low bit of the bank number
                bank = (this.prgBank & 0x0E) | (upper ? 1 : 0);
                break;
            case 2:
                bank = upper ? this.prgBank & 0x0F : 0;
                break;
            default:
                bank = upper ? 0x0F : this.prgBank & 0x0F;
                break;
        }
        // 512KB boards (SUROM) select the 256KB half with bit 4 of the CHR bank
        if (this.prgRomBanks > 16) bank |= this.chrBank0 & 0x10;

        return (bank % this.prgRomBanks) * PRG_BANK_SIZE + (addr & (PRG_BANK_SIZE - 1));
    }

    // Registers are loaded one bit at a time over five writes, LSB first
    cpuMapWrite(addr: number, data: number): boolean {
        if (addr < 0x8000 || addr > 0xFFFF) return false;

        if (data & 0x80) {
            this.shift = SHIFT_EMPTY;
            this.control |= CONTROL_RESET;
            return true;
        }

        const complete = (this.shift & 0x01) !== 0;
        this.shift = (this.shift >> 1) | ((data & 0x01) << 4);
        if (complete) {
            // Bits 13 and 14 of the address select the register
            switch ((addr >> 13) & 0x03) {
                case 0: this.control = this.shift; break;
                case 1: this.chrBank0 = this.shift; break;
                case 2: this.chrBank1 = this.shift; break;
                case 3: this.prgBank = this.shift; break;
            }
            this.shift = SHIFT_EMPTY;
        }
        return true;
    }

    private chrOffset(addr: number): number {
        let bank: number;
        if (this.control & 0x10) {
            bank = addr < 0x1000 ? this.chrBank0 : this.chrBank1;
        } else {
            // 8KB mode ignores the low bit of the bank number
            bank = (this.chrBank0 & 0x1E) | (addr >= 0x1000 ? 1 : 0);
        }
        // Boards with CHR RAM have 8KB of it
        const banks = Math.max(this.chrRomBanks, 1) * 2;
        return (bank % banks) * CHR_BANK_SIZE + (addr & (CHR_BANK_SIZE - 1));
    }

    ppuMapRead(addr: number): number | null {
        return addr <= 0x1FFF ? this.chrOffset(addr) : null;
    }

    override mirror(): Mirror {
        switch (this.control & 0x03) {
            case 0: return MIRROR.ONESCREEN_LO;
            case 1: return MIRROR.ONESCREEN_HI;
            case 2: return MIRROR.VERTICAL;
            default: return MIRROR.HORIZONTAL;
        }
    }

    // The reset button only resets the shift register and the PRG mode
    override reset(): void {
        this.shift = SHIFT_EMPTY;
        this.control |= CONTROL_RESET;
    }
}

export default Mmc1;

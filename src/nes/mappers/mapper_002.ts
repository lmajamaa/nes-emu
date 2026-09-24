import Mapper, { type MappedAddress } from './mapper';

// UxROM (UNROM, UOROM): a switchable 16KB PRG bank at $8000 and the last bank fixed at $C000,
// with 8KB of CHR RAM. Used by DuckTales, Mega Man, Castlevania and Contra.
class Mapper_002 extends Mapper {
    private prgBank = 0;

    cpuMapRead(addr: number, object: MappedAddress): boolean {
        if (addr >= 0x8000 && addr <= 0xBFFF) {
            object.mapped_addr = (this.prgBank % this._nPRGBanks) * 0x4000 + (addr & 0x3FFF);
            return true;
        }
        if (addr >= 0xC000 && addr <= 0xFFFF) {
            object.mapped_addr = (this._nPRGBanks - 1) * 0x4000 + (addr & 0x3FFF);
            return true;
        }
        return false;
    }

    // Any write to ROM selects the bank. UNROM uses 3 bits and UOROM 4, the ROM's size limits it.
    cpuMapWrite(addr: number, data: number): boolean {
        if (addr >= 0x8000 && addr <= 0xFFFF) {
            this.prgBank = data & 0x0F;
            return true;
        }
        return false;
    }

    ppuMapRead(addr: number, object: MappedAddress): boolean {
        if (addr >= 0x0000 && addr <= 0x1FFF) {
            object.mapped_addr = addr;
            return true;
        }
        return false;
    }

    ppuMapWrite(addr: number, object: MappedAddress): boolean {
        // CHR RAM, as UxROM boards have. A few homebrew ROMs have CHR ROM instead, which can't be written.
        if (addr >= 0x0000 && addr <= 0x1FFF && this._nCHRBanks === 0) {
            object.mapped_addr = addr;
            return true;
        }
        return false;
    }

    reset(): void {
        this.prgBank = 0;
    }
}

export default Mapper_002;

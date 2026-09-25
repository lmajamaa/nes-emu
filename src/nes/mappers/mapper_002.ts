import Mapper from './mapper';

// UxROM (UNROM, UOROM): a switchable 16KB PRG bank at $8000 and the last bank fixed at $C000,
// with 8KB of CHR RAM. Used by DuckTales, Mega Man, Castlevania and Contra.
class Uxrom extends Mapper {
    private prgBank = 0;

    cpuMapRead(addr: number): number | null {
        if (addr >= 0x8000 && addr <= 0xBFFF) return (this.prgBank % this.prgRomBanks) * 0x4000 + (addr & 0x3FFF);
        if (addr >= 0xC000 && addr <= 0xFFFF) return (this.prgRomBanks - 1) * 0x4000 + (addr & 0x3FFF);
        return null;
    }

    // Any write to ROM selects the bank. UNROM uses 3 bits and UOROM 4, the ROM's size limits it.
    cpuMapWrite(addr: number, data: number): boolean {
        if (addr >= 0x8000 && addr <= 0xFFFF) {
            this.prgBank = data & 0x0F;
            return true;
        }
        return false;
    }

    // CHR RAM, as UxROM boards have. A few homebrew ROMs have CHR ROM instead, which can't be written.
    ppuMapRead(addr: number): number | null {
        return addr <= 0x1FFF ? addr : null;
    }

    override reset(): void {
        this.prgBank = 0;
    }
}

export default Uxrom;

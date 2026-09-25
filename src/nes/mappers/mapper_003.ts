import Mapper from './mapper';

// CNROM: fixed PRG ROM like NROM, and switchable 8KB CHR ROM banks. Used by games like Gradius,
// Arkanoid, Paperboy and Adventure Island.
class Cnrom extends Mapper {
    private chrBank = 0;

    cpuMapRead(addr: number): number | null {
        if (addr < 0x8000 || addr > 0xFFFF) return null;
        // 16KB of PRG ROM repeats in both halves
        return addr & (this.prgRomBanks > 1 ? 0x7FFF : 0x3FFF);
    }

    // Any write to ROM selects the CHR bank. Boards use 2 bits, the ROM's size limits it.
    cpuMapWrite(addr: number, data: number): boolean {
        if (addr >= 0x8000 && addr <= 0xFFFF) {
            this.chrBank = data;
            return true;
        }
        return false;
    }

    ppuMapRead(addr: number): number | null {
        if (addr > 0x1FFF) return null;
        const banks = Math.max(1, this.chrRomBanks);
        return (this.chrBank % banks) * 0x2000 + addr;
    }

    override reset(): void {
        this.chrBank = 0;
    }
}

export default Cnrom;

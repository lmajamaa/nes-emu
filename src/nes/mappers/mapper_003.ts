import Mapper, { type MappedAddress } from './mapper';

// CNROM: fixed PRG ROM like NROM, and switchable 8KB CHR ROM banks. Used by games like Gradius,
// Arkanoid, Paperboy and Adventure Island.
class Mapper_003 extends Mapper {
    private chrBank = 0;

    cpuMapRead(addr: number, object: MappedAddress): boolean {
        if (addr >= 0x8000 && addr <= 0xFFFF) {
            // 16KB of PRG ROM repeats in both halves
            object.mapped_addr = addr & (this._nPRGBanks > 1 ? 0x7FFF : 0x3FFF);
            return true;
        }
        return false;
    }

    // Any write to ROM selects the CHR bank. Boards use 2 bits, the ROM's size limits it.
    cpuMapWrite(addr: number, data: number): boolean {
        if (addr >= 0x8000 && addr <= 0xFFFF) {
            this.chrBank = data;
            return true;
        }
        return false;
    }

    ppuMapRead(addr: number, object: MappedAddress): boolean {
        if (addr >= 0x0000 && addr <= 0x1FFF) {
            const banks = Math.max(1, this._nCHRBanks);
            object.mapped_addr = (this.chrBank % banks) * 0x2000 + addr;
            return true;
        }
        return false;
    }

    // CHR ROM can't be written
    ppuMapWrite(addr: number, object: MappedAddress): boolean {
        if (addr >= 0x0000 && addr <= 0x1FFF && this._nCHRBanks === 0) {
            object.mapped_addr = addr;
            return true;
        }
        return false;
    }

    reset(): void {
        this.chrBank = 0;
    }
}

export default Mapper_003;

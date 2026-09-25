import Mapper from './mapper';

// NROM: no bank switching, 16KB or 32KB of PRG ROM and 8KB of CHR
class Nrom extends Mapper {
    cpuMapRead(addr: number): number | null {
        if (addr < 0x8000 || addr > 0xFFFF) return null;
        // 16KB of PRG ROM repeats in both halves
        return addr & (this.prgRomBanks > 1 ? 0x7FFF : 0x3FFF);
    }

    // No registers, writes to ROM are ignored
    cpuMapWrite(addr: number, _data: number): boolean {
        return addr >= 0x8000 && addr <= 0xFFFF;
    }

    ppuMapRead(addr: number): number | null {
        return addr <= 0x1FFF ? addr : null;
    }
}

export default Nrom;

import type { Mirror } from '../constants';

// Maps the cartridge's address ranges to its ROM and RAM. Reads map to an offset, or null
// when the address isn't the cartridge's.
abstract class Mapper {
    // In 16KB banks
    protected readonly prgRomBanks: number;
    // In 8KB banks, 0 on boards with 8KB of CHR RAM instead
    protected readonly chrRomBanks: number;

    constructor(prgRomBanks: number, chrRomBanks: number) {
        this.prgRomBanks = prgRomBanks;
        this.chrRomBanks = chrRomBanks;
    }

    // Maps a CPU read to an offset in PRG ROM
    abstract cpuMapRead(addr: number): number | null;
    // PRG ROM can't be written, writes in its range go to the mapper's registers. Returns whether it was the cartridge's.
    abstract cpuMapWrite(addr: number, data: number): boolean;
    // Maps a PPU read to an offset in CHR ROM or RAM
    abstract ppuMapRead(addr: number): number | null;

    // Only CHR RAM can be written
    ppuMapWrite(addr: number): number | null {
        return addr <= 0x1FFF && this.chrRomBanks === 0 ? this.ppuMapRead(addr) : null;
    }

    reset(): void {}

    // Null when the mirroring is hardwired on the board, as set in the iNES header
    mirror(): Mirror | null {
        return null;
    }

    // Called with every address the PPU puts on its bus, for mappers that watch it.
    // The time is in PPU cycles.
    ppuAddress(_addr: number, _time: number): void {}

    get irq(): boolean {
        return false;
    }
}

export default Mapper;

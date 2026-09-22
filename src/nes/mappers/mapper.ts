import type { Mirror } from '../constants';

export interface MappedAddress {
    mapped_addr: number;
}

abstract class Mapper {
    protected readonly _nPRGBanks: number;
    protected readonly _nCHRBanks: number;

    constructor(prgBanks: number, chrBanks: number) {
        this._nPRGBanks = prgBanks;
        this._nCHRBanks = chrBanks;
    }

    // Maps a CPU read to an offset in PRG ROM
    abstract cpuMapRead(addr: number, object: MappedAddress): boolean;
    // PRG ROM can't be written, writes in its range go to the mapper's registers
    abstract cpuMapWrite(addr: number, data: number): boolean;
    abstract ppuMapRead(addr: number, object: MappedAddress): boolean;
    abstract ppuMapWrite(addr: number, object: MappedAddress): boolean;
    abstract reset(): void;

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

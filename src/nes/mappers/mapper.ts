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

    abstract cpuMapRead(addr: number, object: MappedAddress): boolean;
    abstract cpuMapWrite(addr: number, object: MappedAddress): boolean;
    abstract ppuMapRead(addr: number, object: MappedAddress): boolean;
    abstract ppuMapWrite(addr: number, object: MappedAddress): boolean;
    abstract reset(): void;
}

export default Mapper;

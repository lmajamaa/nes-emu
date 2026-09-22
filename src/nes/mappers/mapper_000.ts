import Mapper, { type MappedAddress } from './mapper';

class Mapper_000 extends Mapper {
    cpuMapRead(addr: number, object: MappedAddress): boolean {
        if (addr >= 0x8000 && addr <= 0xFFFF) {
            object.mapped_addr = addr & (this._nPRGBanks > 1 ? 0x7FFF : 0x3FFF);
            return true;
        }
        return false;
    }

    // No registers, writes to ROM are ignored
    cpuMapWrite(addr: number, _data: number): boolean {
        return addr >= 0x8000 && addr <= 0xFFFF;
    }

    ppuMapRead(addr: number, object: MappedAddress): boolean {
        if (addr >= 0x0000 && addr <= 0x1FFF) {
            object.mapped_addr = addr;
            return true;
        }

        return false;
    }

    ppuMapWrite(addr: number, object: MappedAddress): boolean {
        if (addr >= 0x0000 && addr <= 0x1FFF) {
            if (this._nCHRBanks === 0) {
                // Treat as RAM
                object.mapped_addr = addr;
                return true;
            }
        }
        return false;
    }

    reset(): void {

    }
}

export default Mapper_000;

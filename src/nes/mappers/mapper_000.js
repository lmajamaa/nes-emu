import Mapper from './mapper';

class Mapper_000 extends Mapper {
    cpuMapRead(addr, object) {
        if (addr >= 0x8000 & addr <= 0xFFFF) {
            object.mapped_addr = addr & (this._nPRGBanks > 1 ? 0x7FFF : 0x3FFF);
            return true;
        }
        return false;
    }

    cpuMapWrite(addr, object) {
        if (addr >= 0x8000 & addr <= 0xFFFF) {
            object.mapped_addr = addr & (this._nPRGBanks > 1 ? 0x7FFF : 0x3FFF);
            return true;
        }
        return false;
    }

    ppuMapRead(addr, object) {
        if (addr >= 0x0000 & addr <= 0x1FFF) {
            object.mapped_addr = addr;
            return true;
        }

        return false;
    }

    ppuMapWrite(addr, object) {
        if (addr >= 0x0000 && addr <= 0x1FFF) {
            if (this._nCHRBanks === 0) {
                // Treat as RAM
                object.mapped_addr = addr;
                return true;
            }
        }
        return false;
    }

    reset() {

    }
}

export default Mapper_000;
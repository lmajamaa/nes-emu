import { MIRROR, type Mirror } from '../constants';
import Mapper, { type MappedAddress } from './mapper';

// AxROM: switchable 32KB PRG ROM banks, single screen mirroring picked by the same register,
// and 8KB of CHR RAM. Used by Rare's games like Battletoads, Marble Madness, Wizards & Warriors
// and R.C. Pro-Am.
class Mapper_007 extends Mapper {
    private prgBank = 0;
    private upperNametable = false;

    cpuMapRead(addr: number, object: MappedAddress): boolean {
        if (addr >= 0x8000 && addr <= 0xFFFF) {
            // In 32KB banks, so a single 16KB bank ROM just repeats
            const banks = Math.max(1, this._nPRGBanks >> 1);
            object.mapped_addr = ((this.prgBank % banks) * 0x8000 + (addr & 0x7FFF)) % (this._nPRGBanks * 0x4000);
            return true;
        }
        return false;
    }

    // Any write to ROM: bits 0-3 the PRG bank (AMROM and ANROM use 3, AOROM 4), bit 4 the nametable
    cpuMapWrite(addr: number, data: number): boolean {
        if (addr >= 0x8000 && addr <= 0xFFFF) {
            this.prgBank = data & 0x0F;
            this.upperNametable = (data & 0x10) !== 0;
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
        if (addr >= 0x0000 && addr <= 0x1FFF && this._nCHRBanks === 0) {
            object.mapped_addr = addr;
            return true;
        }
        return false;
    }

    mirror(): Mirror {
        return this.upperNametable ? MIRROR.ONESCREEN_HI : MIRROR.ONESCREEN_LO;
    }

    reset(): void {
        this.prgBank = 0;
        this.upperNametable = false;
    }
}

export default Mapper_007;

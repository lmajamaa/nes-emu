import { MIRROR, type Mirror } from '../constants';
import Mapper from './mapper';

// AxROM: switchable 32KB PRG ROM banks, single screen mirroring picked by the same register,
// and 8KB of CHR RAM. Used by Rare's games like Battletoads, Marble Madness, Wizards & Warriors
// and R.C. Pro-Am.
class Axrom extends Mapper {
    private prgBank = 0;
    private upperNametable = false;

    cpuMapRead(addr: number): number | null {
        if (addr < 0x8000 || addr > 0xFFFF) return null;
        // In 32KB banks, so a single 16KB bank ROM just repeats
        const banks = Math.max(1, this.prgRomBanks >> 1);
        return ((this.prgBank % banks) * 0x8000 + (addr & 0x7FFF)) % (this.prgRomBanks * 0x4000);
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

    ppuMapRead(addr: number): number | null {
        return addr <= 0x1FFF ? addr : null;
    }

    override mirror(): Mirror {
        return this.upperNametable ? MIRROR.ONESCREEN_HI : MIRROR.ONESCREEN_LO;
    }

    override reset(): void {
        this.prgBank = 0;
        this.upperNametable = false;
    }
}

export default Axrom;

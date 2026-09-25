import Mapper from './mapper';
import { MIRROR, type Mirror } from '../constants';

const PRG_BANK_SIZE = 0x2000;
const CHR_BANK_SIZE = 0x1000;
// Latch values, set by fetching tile $FD or $FE
const FD = 0;
const FE = 1;

// MMC2, used by Punch-Out!!, see https://www.nesdev.org/wiki/MMC2
class Mmc2 extends Mapper {
    private prgBank = 0;
    // [pattern table][latch]
    private readonly chrBanks = [[0, 0], [0, 0]];
    private readonly latches = [FE, FE];
    private pendingLatch: [table: number, value: number] | null = null;
    private horizontalMirroring = false;

    private get prgBankCount(): number {
        return this.prgRomBanks * 2;
    }

    // $8000 is switchable, the rest is fixed to the last three 8KB banks
    cpuMapRead(addr: number): number | null {
        if (addr < 0x8000 || addr > 0xFFFF) return null;

        const slot = (addr >> 13) & 0x03;
        const bank = slot === 0 ? this.prgBank : this.prgBankCount - 4 + slot;
        return (bank % this.prgBankCount) * PRG_BANK_SIZE + (addr & (PRG_BANK_SIZE - 1));
    }

    cpuMapWrite(addr: number, data: number): boolean {
        if (addr < 0x8000 || addr > 0xFFFF) return false;

        switch (addr & 0xF000) {
            case 0xA000: this.prgBank = data & 0x0F; break;
            case 0xB000: this.chrBanks[0][FD] = data & 0x1F; break;
            case 0xC000: this.chrBanks[0][FE] = data & 0x1F; break;
            case 0xD000: this.chrBanks[1][FD] = data & 0x1F; break;
            case 0xE000: this.chrBanks[1][FE] = data & 0x1F; break;
            case 0xF000: this.horizontalMirroring = (data & 0x01) !== 0; break;
        }
        return true;
    }

    ppuMapRead(addr: number): number | null {
        if (addr > 0x1FFF) return null;

        const table = addr >> 12;
        const bank = this.chrBanks[table][this.latches[table]];
        const banks = Math.max(this.chrRomBanks, 1) * 2;
        return (bank % banks) * CHR_BANK_SIZE + (addr & (CHR_BANK_SIZE - 1));
    }

    // CHR ROM only
    override ppuMapWrite(_addr: number): number | null {
        return null;
    }

    // Fetching tile $FD or $FE sets the latch of its pattern table. The fetch itself still
    // uses the old bank, so the change is applied at the next access.
    override ppuAddress(addr: number, _time: number): void {
        if (this.pendingLatch) {
            const [table, value] = this.pendingLatch;
            this.latches[table] = value;
            this.pendingLatch = null;
        }

        // Only the exact address triggers latch 0, while latch 1 reacts to the whole tile row range
        if (addr === 0x0FD8) this.pendingLatch = [0, FD];
        else if (addr === 0x0FE8) this.pendingLatch = [0, FE];
        else if (addr >= 0x1FD8 && addr <= 0x1FDF) this.pendingLatch = [1, FD];
        else if (addr >= 0x1FE8 && addr <= 0x1FEF) this.pendingLatch = [1, FE];
    }

    override mirror(): Mirror {
        return this.horizontalMirroring ? MIRROR.HORIZONTAL : MIRROR.VERTICAL;
    }

    override reset(): void {
        this.prgBank = 0;
        for (const banks of this.chrBanks) banks.fill(0);
        this.latches.fill(FE);
        this.pendingLatch = null;
        this.horizontalMirroring = false;
    }
}

export default Mmc2;

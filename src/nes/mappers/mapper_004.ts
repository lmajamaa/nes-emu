import Mapper, { type MappedAddress } from './mapper';
import { MIRROR, type Mirror } from '../constants';

const PRG_BANK_SIZE = 0x2000;
const CHR_BANK_SIZE = 0x0400;
// About 3 CPU cycles
const A12_FILTER_CYCLES = 10;

// MMC3, see https://www.nesdev.org/wiki/MMC3
class Mapper_004 extends Mapper {
    // R0-R5 select CHR banks, R6-R7 PRG banks
    private readonly registers = new Uint8Array(8);
    private bankSelect = 0;
    private horizontalMirroring = false;

    private irqLatch = 0;
    private irqCounter = 0;
    private irqReload = false;
    private irqEnabled = false;
    private irqPending = false;
    private a12High = false;
    private a12FellAt = 0;

    private get prgBanks(): number {
        return this._nPRGBanks * 2;
    }

    cpuMapRead(addr: number, object: MappedAddress): boolean {
        if (addr < 0x8000 || addr > 0xFFFF) return false;

        const secondLast = this.prgBanks - 2;
        // Bit 6 swaps the switchable $8000 bank with the fixed second-last bank at $C000
        const swapped = (this.bankSelect & 0x40) !== 0;
        let bank: number;
        switch ((addr >> 13) & 0x03) {
            case 0: bank = swapped ? secondLast : this.registers[6]; break;
            case 1: bank = this.registers[7]; break;
            case 2: bank = swapped ? this.registers[6] : secondLast; break;
            default: bank = this.prgBanks - 1; break;
        }
        object.mapped_addr = (bank % this.prgBanks) * PRG_BANK_SIZE + (addr & (PRG_BANK_SIZE - 1));
        return true;
    }

    // Registers come in pairs, selected by the address range and whether it's even or odd
    cpuMapWrite(addr: number, data: number): boolean {
        if (addr < 0x8000 || addr > 0xFFFF) return false;

        const even = (addr & 0x01) === 0;
        switch (addr & 0xE000) {
            case 0x8000:
                if (even) {
                    this.bankSelect = data;
                } else {
                    this.registers[this.bankSelect & 0x07] = data;
                }
                break;
            case 0xA000:
                // The odd register protects PRG RAM, which isn't emulated
                if (even) this.horizontalMirroring = (data & 0x01) !== 0;
                break;
            case 0xC000:
                if (even) {
                    this.irqLatch = data;
                } else {
                    this.irqCounter = 0;
                    this.irqReload = true;
                }
                break;
            case 0xE000:
                if (even) {
                    this.irqEnabled = false;
                    this.irqPending = false;
                } else {
                    this.irqEnabled = true;
                }
                break;
        }
        return true;
    }

    private chrOffset(addr: number): number {
        // Bit 7 swaps the 2KB banks at $0000 with the 1KB banks at $1000
        const a = (this.bankSelect & 0x80) ? addr ^ 0x1000 : addr;
        let bank: number;
        if (a < 0x0800) {
            bank = (this.registers[0] & 0xFE) | ((a >> 10) & 0x01);
        } else if (a < 0x1000) {
            bank = (this.registers[1] & 0xFE) | ((a >> 10) & 0x01);
        } else {
            bank = this.registers[2 + ((a - 0x1000) >> 10)];
        }
        // Boards with CHR RAM have 8KB of it
        const banks = Math.max(this._nCHRBanks, 1) * 8;
        return (bank % banks) * CHR_BANK_SIZE + (addr & (CHR_BANK_SIZE - 1));
    }

    ppuMapRead(addr: number, object: MappedAddress): boolean {
        if (addr > 0x1FFF) return false;
        object.mapped_addr = this.chrOffset(addr);
        return true;
    }

    ppuMapWrite(addr: number, object: MappedAddress): boolean {
        if (addr > 0x1FFF || this._nCHRBanks !== 0) return false;
        object.mapped_addr = this.chrOffset(addr);
        return true;
    }

    mirror(): Mirror {
        return this.horizontalMirroring ? MIRROR.HORIZONTAL : MIRROR.VERTICAL;
    }

    // The counter is clocked by rising edges of PPU address line A12, but only after A12 has
    // been low for a while. That filters out the quick toggling between sprite tile fetches,
    // so it's normally clocked once per scanline.
    ppuAddress(addr: number, time: number): void {
        const high = (addr & 0x1000) !== 0;
        if (high && !this.a12High && time - this.a12FellAt >= A12_FILTER_CYCLES) {
            this.clockCounter();
        }
        if (!high && this.a12High) this.a12FellAt = time;
        this.a12High = high;
    }

    private clockCounter(): void {
        if (this.irqCounter === 0 || this.irqReload) {
            this.irqCounter = this.irqLatch;
            this.irqReload = false;
        } else {
            this.irqCounter--;
        }
        if (this.irqCounter === 0 && this.irqEnabled) this.irqPending = true;
    }

    get irq(): boolean {
        return this.irqPending;
    }

    reset(): void {
        this.registers.fill(0);
        this.bankSelect = 0;
        this.horizontalMirroring = false;
        this.irqLatch = 0;
        this.irqCounter = 0;
        this.irqReload = false;
        this.irqEnabled = false;
        this.irqPending = false;
        this.a12High = false;
        this.a12FellAt = 0;
    }
}

export default Mapper_004;

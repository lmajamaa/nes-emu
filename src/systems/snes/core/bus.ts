// The SNES memory map, as the 65816 sees it: work RAM, the B-bus ($2100-$21FF) with the PPU,
// APU ports and the work RAM port, the CPU's I/O and DMA registers, and the cartridge. Each
// access moves the master clock on by the speed of the memory it touches.

import Apu from './apu/apu';
import type { Bus65816 } from './cpu';
import type SnesCartridge from './cartridge';
import Dma, { type DmaBus } from './dma';
import CpuIo, { CYCLES_PER_LINE } from './io';
import Ppu from './ppu';

const IDLE_CYCLES = 6;

// Master cycles of an access, as bsnes works them out: 6 for I/O, 12 for the slow controller
// ports, 8 for RAM and SlowROM, and 6 for FastROM in banks $80-$FF when enabled
export function accessCycles(addr: number, romSpeed: number): number {
    if (addr & 0x408000) return addr & 0x800000 ? romSpeed : 8;
    if ((addr + 0x6000) & 0x4000) return 8;
    if ((addr - 0x4000) & 0x7E00) return 6;
    return 12;
}

class SnesBus implements Bus65816, DmaBus {
    readonly wram = new Uint8Array(0x20000);
    readonly io = new CpuIo();
    readonly dma = new Dma(this);
    readonly ppu = new Ppu(this.io);
    cartridge: SnesCartridge | null = null;

    readonly apu = new Apu();
    // When the APU is next caught up, at least once a line to keep the sound flowing
    private apuSyncAt = 0;

    // The last value on the data bus, returned by reads of unmapped addresses
    openBus = 0;
    // Master cycles run
    cycles = 0;

    // WMADD, the work RAM port address
    private wramAddress = 0;
    private inHdma = false;

    constructor() {
        this.io.ppu = this.ppu;
    }

    reset(): void {
        this.io.reset();
        this.dma.reset();
        this.ppu.reset();
        this.wramAddress = 0;
        this.apu.reset();
        this.apu.synchronize(this.cycles);
        this.apuSyncAt = this.cycles + CYCLES_PER_LINE;
    }

    read(addr: number): number {
        this.tick(accessCycles(addr, this.io.romSpeed));
        const data = this.readRaw(addr);
        if (data >= 0) this.openBus = data;
        return this.openBus;
    }

    write(addr: number, data: number): void {
        this.tick(accessCycles(addr, this.io.romSpeed));
        this.openBus = data;
        this.writeRaw(addr, data);
    }

    idle(): void {
        this.tick(IDLE_CYCLES);
    }

    tick(cycles: number): void {
        const { io } = this;
        this.cycles += io.advance(cycles);
        if (this.cycles >= this.apuSyncAt) this.syncApu();
        // HDMA takes over the bus at its point in the line, even in the middle of a DMA
        if ((io.hdmaInitPending || io.hdmaRunPending) && !this.inHdma) {
            this.inHdma = true;
            if (io.hdmaInitPending) {
                io.hdmaInitPending = false;
                this.dma.hdmaInit();
            }
            if (io.hdmaRunPending) {
                io.hdmaRunPending = false;
                this.dma.hdmaRun();
            }
            this.inHdma = false;
        }
    }

    syncApu(): void {
        this.apu.catchUp(this.cycles);
        this.apuSyncAt = this.cycles + CYCLES_PER_LINE;
    }

    // Reads without side effects or time passing, for the debugger. I/O reads as 0.
    peek(addr: number): number {
        const bank = addr >> 16;
        const offset = addr & 0xFFFF;
        if ((bank & 0x40) === 0 && offset >= 0x2000 && offset < 0x6000) return 0;
        const data = this.readRaw(addr);
        return data >= 0 ? data : 0;
    }

    // A-bus and B-bus access for DMA, which takes its own time
    readA(addr: number): number {
        const data = this.readRaw(addr);
        return data >= 0 ? data : this.openBus;
    }

    writeA(addr: number, data: number): void {
        this.writeRaw(addr, data);
    }

    readB(addr: number): number {
        const data = this.readBRaw(addr);
        return data >= 0 ? data : this.openBus;
    }

    // Returns -1 for open bus
    private readRaw(addr: number): number {
        const bank = addr >> 16;
        const offset = addr & 0xFFFF;
        if (bank === 0x7E || bank === 0x7F) return this.wram[addr & 0x1FFFF];

        if ((bank & 0x40) === 0) {
            // Banks $00-$3F and $80-$BF
            if (offset < 0x2000) return this.wram[offset];
            if (offset >= 0x2100 && offset < 0x2200) return this.readBRaw(offset & 0xFF);
            if (offset === 0x4016 || offset === 0x4017) return this.io.readJoypad(offset & 1, this.openBus);
            if (offset >= 0x4200 && offset < 0x4220) return this.io.read(offset, this.openBus);
            if (offset >= 0x4300 && offset < 0x4380) return this.dma.readRegister(offset);
            if (offset >= 0x2000 && offset < 0x6000) return -1;
        }
        return this.cartridge?.read(addr) ?? -1;
    }

    private writeRaw(addr: number, data: number): void {
        const bank = addr >> 16;
        const offset = addr & 0xFFFF;
        if (bank === 0x7E || bank === 0x7F) {
            this.wram[addr & 0x1FFFF] = data;
            return;
        }

        if ((bank & 0x40) === 0) {
            if (offset < 0x2000) {
                this.wram[offset] = data;
                return;
            }
            if (offset >= 0x2100 && offset < 0x2200) {
                this.writeB(offset & 0xFF, data);
                return;
            }
            if (offset === 0x4016) {
                this.io.writeJoypadLatch(data);
                return;
            }
            if (offset === 0x420B) {
                this.dma.start(data);
                return;
            }
            if (offset === 0x420C) {
                this.dma.hdmaEnable = data;
                return;
            }
            if (offset >= 0x4200 && offset < 0x4220) {
                this.io.write(offset, data);
                return;
            }
            if (offset >= 0x4300 && offset < 0x4380) {
                this.dma.writeRegister(offset, data);
                return;
            }
            if (offset >= 0x2000 && offset < 0x6000) return;
        }
        this.cartridge?.write(addr, data);
    }

    // B-bus, $21xx
    private readBRaw(addr: number): number {
        if (addr === 0x37) {
            // Latches the H/V counters, if WRIO allows it
            if (this.io.wrio & 0x80) this.ppu.latchCounters();
            return -1;
        }
        if (addr >= 0x34 && addr < 0x40) return this.ppu.read(addr);
        if (addr >= 0x40 && addr < 0x80) {
            // The APU catches up first, so the SPC700 answers at the right time
            this.syncApu();
            return this.apu.cpuRead(addr);
        }
        if (addr === 0x80) {
            const data = this.wram[this.wramAddress];
            this.wramAddress = (this.wramAddress + 1) & 0x1FFFF;
            return data;
        }
        return -1;
    }

    writeB(addr: number, data: number): void {
        if (addr < 0x34) {
            this.ppu.write(addr, data);
            return;
        }
        if (addr >= 0x40 && addr < 0x80) {
            this.syncApu();
            this.apu.cpuWrite(addr, data);
            return;
        }
        switch (addr) {
            case 0x80:
                this.wram[this.wramAddress] = data;
                this.wramAddress = (this.wramAddress + 1) & 0x1FFFF;
                break;
            case 0x81: this.wramAddress = (this.wramAddress & 0x1FF00) | data; break;
            case 0x82: this.wramAddress = (this.wramAddress & 0x100FF) | (data << 8); break;
            case 0x83: this.wramAddress = (this.wramAddress & 0x0FFFF) | ((data & 1) << 16); break;
        }
    }
}

export default SnesBus;

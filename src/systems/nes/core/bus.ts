import Cpu, { type CpuBus } from './cpu';
import Ppu from './ppu';
import Apu from './apu';
import type Cartridge from './cartridge';

class Bus implements CpuBus {
    readonly cpu: Cpu;
    readonly ppu: Ppu;
    readonly apu: Apu;
    readonly cpuRam = new Uint8Array(2048);
    cartridge: Cartridge | null = null;

    // How many clocks have passed
    private clockCounter = 0;

    // Buttons currently held on each controller, see Button
    readonly controller = new Uint8Array(2);
    private readonly controllerShift = new Uint8Array(2);
    private controllerStrobe = 0;

    private dmaPage = 0x00;
    private dmaAddr = 0x00;
    private dmaData = 0x00;
    private dmaDummy = true;
    private dmaTransfer = false;

    constructor() {
        this.cpu = new Cpu(this);
        this.ppu = new Ppu();
        this.apu = new Apu(addr => this.cpuRead(addr));
    }

    // Like powering on with a new cartridge, so RAM and controllers start out clear
    insertCartridge(cartridge: Cartridge): void {
        this.cartridge = cartridge;
        this.ppu.connectCartridge(cartridge);
        this.cpuRam.fill(0x00);
        this.controller.fill(0x00);
    }

    reset(): void {
        this.cartridge?.reset();
        this.cpu.reset();
        this.ppu.reset();
        this.apu.reset();
        this.clockCounter = 0;
        this.dmaPage = 0x00;
        this.dmaAddr = 0x00;
        this.dmaData = 0x00;
        this.dmaDummy = true;
        this.dmaTransfer = false;
    }

    clock(): void {
        this.ppu.clock();

        if (this.clockCounter % 3 === 0) {
            this.apu.clock();
            if (this.dmaTransfer) {
                this.clockDma();
            } else {
                // IRQ is level triggered and only taken between instructions
                const irq = this.apu.irq || (this.cartridge?.irq ?? false);
                if (irq && this.cpu.complete()) this.cpu.irq();
                this.cpu.clock();
            }
        }

        if (this.ppu.nmi) {
            this.ppu.nmi = false;
            this.cpu.nmi();
        }

        this.clockCounter++;
    }

    // OAM DMA suspends the CPU while it copies a page to OAM, alternating a read and a
    // write each cycle. It has to start on an even cycle, so it may wait an extra one.
    private clockDma(): void {
        if (this.dmaDummy) {
            if (this.clockCounter % 2 === 1) {
                this.dmaDummy = false;
            }
        } else if (this.clockCounter % 2 === 0) {
            this.dmaData = this.cpuRead((this.dmaPage << 8) | this.dmaAddr);
        } else {
            this.ppu.cpuWrite(0x0004, this.dmaData);
            this.dmaAddr = (this.dmaAddr + 1) & 0xFF;
            if (this.dmaAddr === 0) {
                this.dmaTransfer = false;
                this.dmaDummy = true;
            }
        }
    }

    private latchControllers(): void {
        this.controllerShift.set(this.controller);
    }

    cpuRead(addr: number, readOnly = false): number {
        const fromCartridge = this.cartridge ? this.cartridge.cpuRead(addr) : null;
        if (fromCartridge !== null) return fromCartridge;
        if (addr <= 0x1FFF) return this.cpuRam[addr & 0x07FF];
        if (addr <= 0x3FFF) return this.ppu.cpuRead(addr & 0x0007, readOnly);
        if (addr === 0x4015) return this.apu.cpuRead(addr, readOnly);
        if (addr === 0x4016 || addr === 0x4017) {
            const i = addr & 0x0001;
            if (this.controllerStrobe) this.latchControllers();
            const data = this.controllerShift[i] >> 7;
            // Official controllers return 1 after all 8 buttons are read
            if (!readOnly) this.controllerShift[i] = (this.controllerShift[i] << 1) | 1;
            return data;
        }
        return 0x00;
    }

    cpuWrite(addr: number, data: number): void {
        if (this.cartridge?.cpuWrite(addr, data)) {
            // Cartridge address range
        } else if (addr >= 0x0000 && addr <= 0x1FFF) {
            this.cpuRam[addr & 0x07FF] = data;
        } else if (addr >= 0x2000 && addr <= 0x3FFF) {
            this.ppu.cpuWrite(addr & 0x0007, data);
        } else if ((addr >= 0x4000 && addr <= 0x4013) || addr === 0x4015 || addr === 0x4017) {
            this.apu.cpuWrite(addr, data);
        } else if (addr === 0x4014) {
            this.dmaPage = data;
            this.dmaAddr = 0x00;
            this.dmaTransfer = true;
        } else if (addr === 0x4016) {
            // Controllers are reloaded continuously while the strobe bit is set
            this.controllerStrobe = data & 0x01;
            if (this.controllerStrobe) this.latchControllers();
        }
    }
}

export default Bus;

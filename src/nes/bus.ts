import Cpu, { type CpuBus } from "./cpu";
import Ppu from "./ppu";
import Apu from "./apu";
import type Cartridge from "./cartridge";

class Bus implements CpuBus {
    readonly cpu: Cpu;
    readonly ppu: Ppu;
    readonly apu: Apu;
    readonly cpuRam: number[];
    cartridge: Cartridge | null = null;

    private nSystemClockCounter = 0; // How many clocks have passed

    // Buttons currently held on each controller, see Button
    readonly controller = [0x00, 0x00];
    private readonly controller_state = [0x00, 0x00];
    private controller_strobe = 0;

    private dma_page = 0x00;
    private dma_addr = 0x00;
    private dma_data = 0x00;
    private dma_dummy = true;
    private dma_transfer = false;

    constructor() {
        this.cpu = new Cpu(this);
        this.ppu = new Ppu();
        this.apu = new Apu(addr => this.cpuRead(addr));
        this.cpuRam = Array(2048).fill(0x00);
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
        this.nSystemClockCounter = 0;
        this.dma_page = 0x00;
        this.dma_addr = 0x00;
        this.dma_data = 0x00;
        this.dma_dummy = true;
        this.dma_transfer = false;
    }

    clock(): void {
        this.ppu.clock();

        if (this.nSystemClockCounter % 3 === 0) {
            this.apu.clock();
            if (this.dma_transfer) {
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

        this.nSystemClockCounter++;
    }

    // OAM DMA suspends the CPU while it copies a page to OAM, alternating a read and a
    // write each cycle. It has to start on an even cycle, so it may wait an extra one.
    private clockDma(): void {
        if (this.dma_dummy) {
            if (this.nSystemClockCounter % 2 === 1) {
                this.dma_dummy = false;
            }
        } else if (this.nSystemClockCounter % 2 === 0) {
            this.dma_data = this.cpuRead((this.dma_page << 8) | this.dma_addr);
        } else {
            this.ppu.cpuWrite(0x0004, this.dma_data);
            this.dma_addr = (this.dma_addr + 1) & 0xFF;
            if (this.dma_addr === 0) {
                this.dma_transfer = false;
                this.dma_dummy = true;
            }
        }
    }

    private latchControllers(): void {
        this.controller_state[0] = this.controller[0];
        this.controller_state[1] = this.controller[1];
    }

    cpuRead(addr: number, bReadOnly = false): number {
        let data = 0x00;
        const object = { data };
        if (this.cartridge?.cpuRead(addr, object)) {
            // Cartridge address range
            data = object.data;
        } else if (addr >= 0x0000 && addr <= 0x1FFF) {
            data = this.cpuRam[addr & 0x07FF];
        } else if (addr >= 0x2000 && addr <= 0x3FFF) {
            data = this.ppu.cpuRead(addr & 0x0007, bReadOnly);
        } else if (addr === 0x4015) {
            data = this.apu.cpuRead(addr, bReadOnly);
        } else if (addr === 0x4016 || addr === 0x4017) {
            const i = addr & 0x0001;
            if (this.controller_strobe) this.latchControllers();
            data = (this.controller_state[i] & 0x80) ? 1 : 0;
            if (!bReadOnly) {
                // Official controllers return 1 after all 8 buttons are read
                this.controller_state[i] = ((this.controller_state[i] << 1) | 1) & 0xFF;
            }
        }
        return data;
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
            this.dma_page = data;
            this.dma_addr = 0x00;
            this.dma_transfer = true;
        } else if (addr === 0x4016) {
            // Controllers are reloaded continuously while the strobe bit is set
            this.controller_strobe = data & 0x01;
            if (this.controller_strobe) this.latchControllers();
        }
    }
}

export default Bus;

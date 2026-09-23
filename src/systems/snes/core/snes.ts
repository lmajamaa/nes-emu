import SnesBus from './bus';
import type SnesCartridge from './cartridge';
import Cpu65816 from './cpu';

// The whole console, run an instruction at a time
class Snes {
    readonly bus = new SnesBus();
    readonly cpu = new Cpu65816(this.bus);

    constructor(cartridge: SnesCartridge) {
        this.bus.cartridge = cartridge;
    }

    reset(): void {
        this.bus.reset();
        this.cpu.reset();
    }

    // Runs one instruction, or takes an interrupt, and returns the master cycles it took
    step(): number {
        const { io } = this.bus;
        const start = this.bus.cycles;
        if (this.cpu.stopped) {
            // Only a reset gets it going again
            this.cpu.step();
        } else if (io.nmiPending) {
            io.nmiPending = false;
            this.cpu.nmi();
        } else if (io.irqLine && (!this.cpu.i || this.cpu.waiting)) {
            // With IRQs disabled, WAI still resumes but without taking the interrupt
            this.cpu.irq();
        } else {
            this.cpu.step();
        }
        return this.bus.cycles - start;
    }

    // Runs until the next vblank starts
    runFrame(): void {
        const { io } = this.bus;
        while (!io.frameComplete) this.step();
        io.frameComplete = false;
    }
}

export default Snes;

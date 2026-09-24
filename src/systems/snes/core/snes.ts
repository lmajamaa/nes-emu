import SnesBus from './bus';
import type SnesCartridge from './cartridge';
import Cpu65816 from './cpu';

// Addresses of the last instructions run, for the debugger
const TRACE_LENGTH = 8;

// The whole console, run an instruction at a time
class Snes {
    readonly bus = new SnesBus();
    readonly cpu = new Cpu65816(this.bus);
    private readonly trace = new Int32Array(TRACE_LENGTH).fill(-1);
    private traceIndex = 0;

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
        // Waiting in WAI would fill the trace with the same address
        const address = (this.cpu.pbr << 16) | this.cpu.pc;
        if (this.trace[(this.traceIndex + TRACE_LENGTH - 1) % TRACE_LENGTH] !== address) {
            this.trace[this.traceIndex] = address;
            this.traceIndex = (this.traceIndex + 1) % TRACE_LENGTH;
        }
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

    // Addresses of the last instructions run, oldest first
    recentInstructions(): number[] {
        const addresses: number[] = [];
        for (let i = 0; i < TRACE_LENGTH; i++) {
            const address = this.trace[(this.traceIndex + i) % TRACE_LENGTH];
            if (address >= 0) addresses.push(address);
        }
        return addresses;
    }

    // Runs until the next vblank starts
    runFrame(): void {
        const { io } = this.bus;
        while (!io.frameComplete) this.step();
        io.frameComplete = false;
    }
}

export default Snes;

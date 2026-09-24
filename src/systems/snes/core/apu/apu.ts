// The SNES sound system: the SPC700 with its 64 KB of RAM, the boot ROM (IPL), three timers,
// the DSP and the four ports to the main CPU. It runs on its own clock, and catches up with the
// main CPU whenever they talk through the ports.

import { MASTER_CLOCK_NTSC } from '../io';
import Dsp from './dsp';
import Spc700, { type SpcBus } from './spc700';

// The APU's 24.576 MHz nominal crystal, as bsnes measures it: an SPC700 cycle is 24 of its
// ticks, 1.025 MHz, and the DSP makes a sample every 32 SPC700 cycles
const APU_CLOCK = 24_606_720;
const SPC_CYCLE_TICKS = 24;
// The APU has its own crystal, so how it keeps up depends on the console's master clock
const spcCyclesPerMasterCycle = (masterClock: number) => APU_CLOCK / SPC_CYCLE_TICKS / masterClock;
const DSP_SAMPLE_CYCLES = 32;
// Timers 0 and 1 count at 8 kHz, timer 2 at 64 kHz
const TIMER_PERIODS = [128, 128, 16];

// Waits for the main CPU to upload a program through the ports, then runs it
const IPL_ROM = new Uint8Array([
    0xCD, 0xEF, 0xBD, 0xE8, 0x00, 0xC6, 0x1D, 0xD0, 0xFC, 0x8F, 0xAA, 0xF4, 0x8F, 0xBB, 0xF5, 0x78,
    0xCC, 0xF4, 0xD0, 0xFB, 0x2F, 0x19, 0xEB, 0xF4, 0xD0, 0xFC, 0x7E, 0xF4, 0xD0, 0x0B, 0xE4, 0xF5,
    0xCB, 0xF4, 0xD7, 0x00, 0xFC, 0xD0, 0xF3, 0xAB, 0x01, 0x10, 0xEF, 0x7E, 0xF4, 0x10, 0xEB, 0xBA,
    0xF6, 0xDA, 0x00, 0xBA, 0xF4, 0xC4, 0xF4, 0xDD, 0x5D, 0xD0, 0xDB, 0x1F, 0x00, 0x00, 0xC0, 0xFF,
]);

class Timer {
    enabled = false;
    target = 0;
    // The 8-bit counter that counts up to the target, and the 4-bit output that counts how often it did
    stage2 = 0;
    output = 0;
    divider = 0;

    constructor(readonly period: number) {}

    run(cycles: number): void {
        this.divider += cycles;
        while (this.divider >= this.period) {
            this.divider -= this.period;
            if (!this.enabled) continue;
            this.stage2 = (this.stage2 + 1) & 0xFF;
            // A target of 0 counts to 256
            if (this.stage2 === this.target) {
                this.stage2 = 0;
                this.output = (this.output + 1) & 0x0F;
            }
        }
    }
}

class Apu implements SpcBus {
    readonly ram = new Uint8Array(0x10000);
    readonly spc = new Spc700(this);
    readonly dsp = new Dsp(this.ram);
    private readonly timers = TIMER_PERIODS.map(period => new Timer(period));

    // $F4-$F7 as the main CPU wrote them, and as the SPC700 wrote them
    readonly inputs = new Uint8Array(4);
    readonly outputs = new Uint8Array(4);
    private iplEnabled = true;
    private dspAddress = 0;

    // Master cycles caught up to, and SPC700 cycles owed
    private masterCycles = 0;
    private cyclesPerMasterCycle = spcCyclesPerMasterCycle(MASTER_CLOCK_NTSC);
    private budget = 0;
    private dspDivider = 0;

    reset(): void {
        this.inputs.fill(0);
        this.outputs.fill(0);
        this.iplEnabled = true;
        this.dspAddress = 0;
        for (const timer of this.timers) {
            timer.enabled = false;
            timer.target = 0;
            timer.stage2 = 0;
            timer.output = 0;
            timer.divider = 0;
        }
        this.budget = 0;
        this.dspDivider = 0;
        this.dsp.reset();
        this.spc.reset();
    }

    // The console's master clock, which is a little slower on PAL consoles
    setMasterClock(hz: number): void {
        this.cyclesPerMasterCycle = spcCyclesPerMasterCycle(hz);
    }

    // Runs the APU up to the main CPU's time, in master cycles since power on
    catchUp(masterCycles: number): void {
        this.budget += (masterCycles - this.masterCycles) * this.cyclesPerMasterCycle;
        this.masterCycles = masterCycles;
        while (this.budget > 0) this.budget -= this.runCycles(this.spc.step());
    }

    // Starts counting from the main CPU's time without running, after a reset
    synchronize(masterCycles: number): void {
        this.masterCycles = masterCycles;
        this.budget = 0;
    }

    private runCycles(cycles: number): number {
        for (const timer of this.timers) timer.run(cycles);
        this.dspDivider += cycles;
        while (this.dspDivider >= DSP_SAMPLE_CYCLES) {
            this.dspDivider -= DSP_SAMPLE_CYCLES;
            this.dsp.sample();
        }
        return cycles;
    }

    // The main CPU's side of the ports, $2140-$2143
    cpuRead(port: number): number {
        return this.outputs[port & 3];
    }

    cpuWrite(port: number, data: number): void {
        this.inputs[port & 3] = data;
    }

    takeSamples(): Int16Array {
        return this.dsp.takeSamples();
    }

    // The SPC700's bus

    read(addr: number): number {
        if (addr >= 0xF0 && addr <= 0xFF) return this.readRegister(addr);
        if (addr >= 0xFFC0 && this.iplEnabled) return IPL_ROM[addr - 0xFFC0];
        return this.ram[addr];
    }

    write(addr: number, data: number): void {
        if (addr >= 0xF0 && addr <= 0xFF) this.writeRegister(addr, data);
        // Every write reaches RAM, also under the registers and the IPL
        this.ram[addr] = data;
    }

    idle(): void {}

    private readRegister(addr: number): number {
        switch (addr) {
            case 0xF2: return this.dspAddress;
            case 0xF3: return this.dsp.read(this.dspAddress);
            case 0xF4: case 0xF5: case 0xF6: case 0xF7: return this.inputs[addr - 0xF4];
            case 0xF8: case 0xF9: return this.ram[addr];
            case 0xFD: case 0xFE: case 0xFF: {
                // Reading a timer's output clears it
                const timer = this.timers[addr - 0xFD];
                const output = timer.output;
                timer.output = 0;
                return output;
            }
            default: return 0x00;
        }
    }

    private writeRegister(addr: number, data: number): void {
        switch (addr) {
            case 0xF1:
                for (let i = 0; i < 3; i++) {
                    const timer = this.timers[i];
                    const enable = (data & (1 << i)) !== 0;
                    // Starting a timer resets it
                    if (enable && !timer.enabled) {
                        timer.stage2 = 0;
                        timer.output = 0;
                    }
                    timer.enabled = enable;
                }
                if (data & 0x10) this.inputs[0] = this.inputs[1] = 0;
                if (data & 0x20) this.inputs[2] = this.inputs[3] = 0;
                this.iplEnabled = (data & 0x80) !== 0;
                break;
            case 0xF2: this.dspAddress = data; break;
            // The DSP's registers repeat over $80-$FF, but only for reading
            case 0xF3: if (this.dspAddress < 0x80) this.dsp.write(this.dspAddress, data); break;
            case 0xF4: case 0xF5: case 0xF6: case 0xF7: this.outputs[addr - 0xF4] = data; break;
            case 0xFA: case 0xFB: case 0xFC: this.timers[addr - 0xFA].target = data; break;
        }
    }
}

export default Apu;

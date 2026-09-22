// See https://www.nesdev.org/wiki/APU

export const CPU_CLOCK_NTSC = 1789773;

const LENGTH_TABLE = [
    10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
    12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30,
];

const DUTY_TABLE = [
    [0, 1, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 0, 0, 0],
    [1, 0, 0, 1, 1, 1, 1, 1],
];

const TRIANGLE_SEQUENCE = [
    15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
];

// In CPU cycles
const NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
const DMC_RATES = [428, 380, 340, 320, 286, 254, 226, 214, 190, 160, 142, 128, 106, 84, 72, 54];

// Lookup tables approximating the non-linear mixer, see https://www.nesdev.org/wiki/APU_Mixer
const PULSE_MIX = Array.from({ length: 31 }, (_, n) => n === 0 ? 0 : 95.52 / (8128 / n + 100));
const TND_MIX = Array.from({ length: 203 }, (_, n) => n === 0 ? 0 : 163.67 / (24329 / n + 100));

const DC_BLOCKER_HZ = 37;

class Envelope {
    start = false;
    loop = false;
    constant = false;
    volume = 0;
    private divider = 0;
    private decay = 0;

    write(value: number): void {
        this.loop = (value & 0x20) !== 0;
        this.constant = (value & 0x10) !== 0;
        this.volume = value & 0x0F;
    }

    clock(): void {
        if (this.start) {
            this.start = false;
            this.decay = 15;
            this.divider = this.volume;
        } else if (this.divider === 0) {
            this.divider = this.volume;
            if (this.decay > 0) {
                this.decay--;
            } else if (this.loop) {
                this.decay = 15;
            }
        } else {
            this.divider--;
        }
    }

    output(): number {
        return this.constant ? this.volume : this.decay;
    }
}

class LengthCounter {
    enabled = false;
    halt = false;
    value = 0;

    load(index: number): void {
        if (this.enabled) this.value = LENGTH_TABLE[index];
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) this.value = 0;
    }

    clock(): void {
        if (!this.halt && this.value > 0) this.value--;
    }
}

export class Pulse {
    readonly envelope = new Envelope();
    readonly length = new LengthCounter();
    period = 0;
    private duty = 0;
    private step = 0;
    private timer = 0;

    private sweepEnabled = false;
    private sweepPeriod = 0;
    private sweepNegate = false;
    private sweepShift = 0;
    private sweepReload = false;
    private sweepDivider = 0;

    // Pulse 1 negates with ones' complement, pulse 2 with two's complement
    constructor(private readonly onesComplement: boolean) {}

    write(register: number, value: number): void {
        switch (register) {
            case 0:
                this.duty = value >> 6;
                this.length.halt = (value & 0x20) !== 0;
                this.envelope.write(value);
                break;
            case 1:
                this.sweepEnabled = (value & 0x80) !== 0;
                this.sweepPeriod = (value >> 4) & 0x07;
                this.sweepNegate = (value & 0x08) !== 0;
                this.sweepShift = value & 0x07;
                this.sweepReload = true;
                break;
            case 2:
                this.period = (this.period & 0x700) | value;
                break;
            case 3:
                this.period = (this.period & 0x0FF) | ((value & 0x07) << 8);
                this.length.load(value >> 3);
                this.step = 0;
                this.envelope.start = true;
                break;
        }
    }

    // Clocked every other CPU cycle
    clockTimer(): void {
        if (this.timer === 0) {
            this.timer = this.period;
            this.step = (this.step + 1) & 0x07;
        } else {
            this.timer--;
        }
    }

    private targetPeriod(): number {
        const change = this.period >> this.sweepShift;
        if (!this.sweepNegate) return this.period + change;
        return this.period - change - (this.onesComplement ? 1 : 0);
    }

    // The sweep unit mutes the channel even when it is disabled
    private muted(): boolean {
        return this.period < 8 || this.targetPeriod() > 0x7FF;
    }

    clockSweep(): void {
        if (this.sweepDivider === 0 && this.sweepEnabled && this.sweepShift > 0 && !this.muted()) {
            this.period = this.targetPeriod();
        }
        if (this.sweepDivider === 0 || this.sweepReload) {
            this.sweepDivider = this.sweepPeriod;
            this.sweepReload = false;
        } else {
            this.sweepDivider--;
        }
    }

    output(): number {
        if (this.length.value === 0 || this.muted() || DUTY_TABLE[this.duty][this.step] === 0) return 0;
        return this.envelope.output();
    }
}

export class Triangle {
    readonly length = new LengthCounter();
    period = 0;
    private control = false;
    private linearReloadValue = 0;
    private linearCounter = 0;
    private linearReload = false;
    private timer = 0;
    private step = 0;

    write(register: number, value: number): void {
        switch (register) {
            case 0:
                this.control = (value & 0x80) !== 0;
                this.length.halt = this.control;
                this.linearReloadValue = value & 0x7F;
                break;
            case 2:
                this.period = (this.period & 0x700) | value;
                break;
            case 3:
                this.period = (this.period & 0x0FF) | ((value & 0x07) << 8);
                this.length.load(value >> 3);
                this.linearReload = true;
                break;
        }
    }

    clockTimer(): void {
        if (this.timer === 0) {
            this.timer = this.period;
            // Ultrasonic periods are skipped, they would only produce a pop
            if (this.length.value > 0 && this.linearCounter > 0 && this.period >= 2) {
                this.step = (this.step + 1) & 0x1F;
            }
        } else {
            this.timer--;
        }
    }

    clockLinearCounter(): void {
        if (this.linearReload) {
            this.linearCounter = this.linearReloadValue;
        } else if (this.linearCounter > 0) {
            this.linearCounter--;
        }
        if (!this.control) this.linearReload = false;
    }

    // Holds its last value when silenced, like the hardware
    output(): number {
        return TRIANGLE_SEQUENCE[this.step];
    }
}

export class Noise {
    readonly envelope = new Envelope();
    readonly length = new LengthCounter();
    shift = 1;
    private mode = false;
    private period = NOISE_PERIODS[0];
    private timer = 0;

    write(register: number, value: number): void {
        switch (register) {
            case 0:
                this.length.halt = (value & 0x20) !== 0;
                this.envelope.write(value);
                break;
            case 2:
                this.mode = (value & 0x80) !== 0;
                this.period = NOISE_PERIODS[value & 0x0F];
                break;
            case 3:
                this.length.load(value >> 3);
                this.envelope.start = true;
                break;
        }
    }

    clockTimer(): void {
        if (this.timer === 0) {
            this.timer = this.period - 1;
            const feedback = (this.shift ^ (this.shift >> (this.mode ? 6 : 1))) & 0x01;
            this.shift = (this.shift >> 1) | (feedback << 14);
        } else {
            this.timer--;
        }
    }

    output(): number {
        if (this.length.value === 0 || (this.shift & 0x01)) return 0;
        return this.envelope.output();
    }
}

export class Dmc {
    irq = false;
    level = 0;
    bytesRemaining = 0;
    private irqEnabled = false;
    private loop = false;
    private rate = DMC_RATES[0];
    private timer = 0;
    private sampleAddress = 0xC000;
    private sampleLength = 1;
    private currentAddress = 0xC000;
    private buffer: number | null = null;
    private shiftRegister = 0;
    private bitsRemaining = 8;
    private silence = true;

    constructor(private readonly read: (addr: number) => number) {}

    write(register: number, value: number): void {
        switch (register) {
            case 0:
                this.irqEnabled = (value & 0x80) !== 0;
                this.loop = (value & 0x40) !== 0;
                this.rate = DMC_RATES[value & 0x0F];
                if (!this.irqEnabled) this.irq = false;
                break;
            case 1:
                this.level = value & 0x7F;
                break;
            case 2:
                this.sampleAddress = 0xC000 | (value << 6);
                break;
            case 3:
                this.sampleLength = (value << 4) | 1;
                break;
        }
    }

    setEnabled(enabled: boolean): void {
        if (!enabled) {
            this.bytesRemaining = 0;
        } else if (this.bytesRemaining === 0) {
            this.restart();
        }
    }

    private restart(): void {
        this.currentAddress = this.sampleAddress;
        this.bytesRemaining = this.sampleLength;
    }

    // The CPU is not stalled while the sample byte is read, unlike on the real hardware
    private fillBuffer(): void {
        if (this.buffer !== null || this.bytesRemaining === 0) return;

        this.buffer = this.read(this.currentAddress);
        this.currentAddress = this.currentAddress === 0xFFFF ? 0x8000 : this.currentAddress + 1;
        this.bytesRemaining--;
        if (this.bytesRemaining === 0) {
            if (this.loop) {
                this.restart();
            } else if (this.irqEnabled) {
                this.irq = true;
            }
        }
    }

    clockTimer(): void {
        this.fillBuffer();
        if (this.timer === 0) {
            this.timer = this.rate - 1;
            this.clockOutput();
        } else {
            this.timer--;
        }
    }

    private clockOutput(): void {
        if (!this.silence) {
            if (this.shiftRegister & 0x01) {
                if (this.level <= 125) this.level += 2;
            } else if (this.level >= 2) {
                this.level -= 2;
            }
        }
        this.shiftRegister >>= 1;
        this.bitsRemaining--;
        if (this.bitsRemaining === 0) {
            this.bitsRemaining = 8;
            if (this.buffer === null) {
                this.silence = true;
            } else {
                this.silence = false;
                this.shiftRegister = this.buffer;
                this.buffer = null;
            }
        }
    }

    output(): number {
        return this.level;
    }
}

class Apu {
    readonly pulse1 = new Pulse(true);
    readonly pulse2 = new Pulse(false);
    readonly triangle = new Triangle();
    readonly noise = new Noise();
    readonly dmc: Dmc;

    frameIrq = false;
    private frameCycle = 0;
    private frameCounterResetDelay = 0;
    private fiveStepMode = false;
    private irqInhibit = false;
    private cycle = 0;

    private samplePeriod = 0;
    private sampleTimer = 0;
    private sampleSum = 0;
    private sampleCount = 0;
    private samples: number[] = [];
    private maxSamples = 0;
    private dcBlockerCoefficient = 0;
    private dcBlockerInput = 0;
    private dcBlockerOutput = 0;

    // DMC samples are read from CPU memory
    constructor(read: (addr: number) => number, sampleRate = 44100) {
        this.dmc = new Dmc(read);
        this.setSampleRate(sampleRate);
    }

    get irq(): boolean {
        return this.frameIrq || this.dmc.irq;
    }

    setSampleRate(sampleRate: number): void {
        this.samplePeriod = CPU_CLOCK_NTSC / sampleRate;
        this.maxSamples = sampleRate;
        this.dcBlockerCoefficient = Math.exp(-2 * Math.PI * DC_BLOCKER_HZ / sampleRate);
        this.samples = [];
    }

    // Samples generated since the last call
    takeSamples(): Float32Array {
        const samples = Float32Array.from(this.samples);
        this.samples = [];
        return samples;
    }

    // Clocked once per CPU cycle
    clock(): void {
        this.triangle.clockTimer();
        this.noise.clockTimer();
        this.dmc.clockTimer();
        if (this.cycle & 1) {
            this.pulse1.clockTimer();
            this.pulse2.clockTimer();
        }
        this.cycle++;

        this.clockFrameCounter();

        // Average every cycle into the output sample, a cheap low-pass filter against aliasing
        this.sampleSum += this.mix();
        this.sampleCount++;
        this.sampleTimer++;
        if (this.sampleTimer >= this.samplePeriod) {
            this.sampleTimer -= this.samplePeriod;
            this.emitSample(this.sampleSum / this.sampleCount);
            this.sampleSum = 0;
            this.sampleCount = 0;
        }
    }

    private clockFrameCounter(): void {
        if (this.frameCounterResetDelay > 0) {
            this.frameCounterResetDelay--;
            if (this.frameCounterResetDelay === 0) {
                this.frameCycle = 0;
                if (this.fiveStepMode) {
                    this.clockQuarterFrame();
                    this.clockHalfFrame();
                }
                return;
            }
        }

        this.frameCycle++;
        switch (this.frameCycle) {
            case 7457:
                this.clockQuarterFrame();
                break;
            case 14913:
                this.clockQuarterFrame();
                this.clockHalfFrame();
                break;
            case 22371:
                this.clockQuarterFrame();
                break;
            // The IRQ flag is set on three cycles in a row, so reading $4015 in between doesn't clear it for long
            case 29828:
                if (!this.fiveStepMode) this.setFrameIrq();
                break;
            case 29829:
                if (!this.fiveStepMode) {
                    this.clockQuarterFrame();
                    this.clockHalfFrame();
                    this.setFrameIrq();
                }
                break;
            case 29830:
                if (!this.fiveStepMode) {
                    this.setFrameIrq();
                    this.frameCycle = 0;
                }
                break;
            case 37281:
                this.clockQuarterFrame();
                this.clockHalfFrame();
                break;
            case 37282:
                this.frameCycle = 0;
                break;
        }
    }

    private setFrameIrq(): void {
        if (!this.irqInhibit) this.frameIrq = true;
    }

    private clockQuarterFrame(): void {
        this.pulse1.envelope.clock();
        this.pulse2.envelope.clock();
        this.noise.envelope.clock();
        this.triangle.clockLinearCounter();
    }

    private clockHalfFrame(): void {
        this.pulse1.length.clock();
        this.pulse2.length.clock();
        this.triangle.length.clock();
        this.noise.length.clock();
        this.pulse1.clockSweep();
        this.pulse2.clockSweep();
    }

    private mix(): number {
        return PULSE_MIX[this.pulse1.output() + this.pulse2.output()]
            + TND_MIX[3 * this.triangle.output() + 2 * this.noise.output() + this.dmc.output()];
    }

    private emitSample(value: number): void {
        const output = value - this.dcBlockerInput + this.dcBlockerCoefficient * this.dcBlockerOutput;
        this.dcBlockerInput = value;
        this.dcBlockerOutput = output;

        // Nobody is taking the samples, e.g. when there is no audio output
        if (this.samples.length >= this.maxSamples) this.samples = [];
        this.samples.push(output);
    }

    cpuRead(addr: number, readOnly = false): number {
        if (addr !== 0x4015) return 0x00;

        let data = 0x00;
        if (this.pulse1.length.value > 0) data |= 0x01;
        if (this.pulse2.length.value > 0) data |= 0x02;
        if (this.triangle.length.value > 0) data |= 0x04;
        if (this.noise.length.value > 0) data |= 0x08;
        if (this.dmc.bytesRemaining > 0) data |= 0x10;
        if (this.frameIrq) data |= 0x40;
        if (this.dmc.irq) data |= 0x80;
        if (!readOnly) this.frameIrq = false;
        return data;
    }

    cpuWrite(addr: number, data: number): void {
        if (addr >= 0x4000 && addr <= 0x4003) {
            this.pulse1.write(addr & 0x03, data);
        } else if (addr >= 0x4004 && addr <= 0x4007) {
            this.pulse2.write(addr & 0x03, data);
        } else if (addr >= 0x4008 && addr <= 0x400B) {
            this.triangle.write(addr & 0x03, data);
        } else if (addr >= 0x400C && addr <= 0x400F) {
            this.noise.write(addr & 0x03, data);
        } else if (addr >= 0x4010 && addr <= 0x4013) {
            this.dmc.write(addr & 0x03, data);
        } else if (addr === 0x4015) {
            this.pulse1.length.setEnabled((data & 0x01) !== 0);
            this.pulse2.length.setEnabled((data & 0x02) !== 0);
            this.triangle.length.setEnabled((data & 0x04) !== 0);
            this.noise.length.setEnabled((data & 0x08) !== 0);
            this.dmc.setEnabled((data & 0x10) !== 0);
            this.dmc.irq = false;
        } else if (addr === 0x4017) {
            this.fiveStepMode = (data & 0x80) !== 0;
            this.irqInhibit = (data & 0x40) !== 0;
            if (this.irqInhibit) this.frameIrq = false;
            // The sequencer restarts 3 or 4 CPU cycles later, depending on which half of
            // an APU cycle the write lands in
            this.frameCounterResetDelay = (this.cycle & 1) ? 4 : 3;
        }
    }

    reset(): void {
        for (let addr = 0x4000; addr <= 0x4013; addr++) {
            this.cpuWrite(addr, 0x00);
        }
        this.cpuWrite(0x4015, 0x00);
        this.cpuWrite(0x4017, 0x00);
        this.frameIrq = false;
        this.dmc.level = 0;
        this.samples = [];
        this.sampleTimer = 0;
        this.sampleSum = 0;
        this.sampleCount = 0;
        // Start the filter at the current (silent) level to avoid a pop
        this.dcBlockerInput = this.mix();
        this.dcBlockerOutput = 0;
    }
}

export default Apu;

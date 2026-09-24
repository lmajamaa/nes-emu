// The S-DSP: 8 voices playing BRR compressed samples from the APU's RAM, with Gaussian
// interpolation, ADSR and GAIN envelopes, noise, pitch modulation and an echo with an 8-tap
// FIR filter. It makes one stereo sample every 32 SPC700 cycles, 32 kHz. This processes a
// whole sample at a time instead of cycle by cycle.

import { GAUSS } from './gauss';

export const DSP_SAMPLE_RATE = 32040;

// Global registers
const MVOLL = 0x0C;
const MVOLR = 0x1C;
const EVOLL = 0x2C;
const EVOLR = 0x3C;
const KON = 0x4C;
const KOFF = 0x5C;
const FLG = 0x6C;
const ENDX = 0x7C;
const EFB = 0x0D;
const PMON = 0x2D;
const NON = 0x3D;
const EON = 0x4D;
const DIR = 0x5D;
const ESA = 0x6D;
const EDL = 0x7D;
const FIR = 0x0F;
// Voice registers, at voice * 0x10 plus these
const VOLL = 0x0;
const VOLR = 0x1;
const PITCHL = 0x2;
const PITCHH = 0x3;
const SRCN = 0x4;
const ADSR1 = 0x5;
const ADSR2 = 0x6;
const GAIN = 0x7;
const ENVX = 0x8;
const OUTX = 0x9;

// A global counter paces envelopes and noise. At each of the 32 rates an event happens when the
// counter plus the rate's offset divides by the rate's period.
const COUNTER_RANGE = 2048 * 5 * 3;
const COUNTER_RATES = [
    COUNTER_RANGE + 1, 2048, 1536, 1280, 1024, 768, 640, 512, 384, 320, 256, 192, 160, 128, 96, 80,
    64, 48, 40, 32, 24, 20, 16, 12, 10, 8, 6, 5, 4, 3, 2, 1,
];
const COUNTER_OFFSETS = [
    1, 0, 1040, 536, 0, 1040, 536, 0, 1040, 536, 0, 1040, 536, 0, 1040, 536,
    0, 1040, 536, 0, 1040, 536, 0, 1040, 536, 0, 1040, 536, 0, 1040, 0, 0,
];

const RELEASE = 0;
const ATTACK = 1;
const DECAY = 2;
const SUSTAIN = 3;

// Samples of silence after a key on, before the voice starts
const KEY_ON_DELAY = 5;
const BRR_BLOCK_SIZE = 9;
// Decoded samples of a block, after the last 3 of the previous block that interpolation needs
const HISTORY = 3;

const clamp16 = (value: number) => (value < -0x8000 ? -0x8000 : value > 0x7FFF ? 0x7FFF : value);
const signed8 = (value: number) => (value << 24) >> 24;

class Voice {
    readonly samples = new Int16Array(HISTORY + 16);
    // Position in the current block, in 1/4096 samples
    position = 0;
    brrAddress = 0;
    header = 0;
    envelope = 0;
    // The envelope before its update is dropped by the rate, which bent GAIN checks
    hiddenEnvelope = 0;
    mode = RELEASE;
    keyOnDelay = 0;
    output = 0;
}

class Dsp {
    readonly registers = new Uint8Array(128);
    private readonly voices = Array.from({ length: 8 }, () => new Voice());
    private counter = 0;
    private noise = 0x4000;
    private keyOn = 0;
    private readonly echoHistoryLeft = new Int16Array(8);
    private readonly echoHistoryRight = new Int16Array(8);
    private echoOffset = 0;
    private echoLength = 0;
    private echoOutLeft = 0;
    private echoOutRight = 0;
    // Interleaved left and right samples made since the last takeSamples
    private samples: number[] = [];

    constructor(private readonly ram: Uint8Array) {}

    reset(): void {
        this.registers.fill(0);
        // Soft reset, mute and echo writes off
        this.registers[FLG] = 0xE0;
        for (const voice of this.voices) {
            voice.mode = RELEASE;
            voice.envelope = 0;
            voice.keyOnDelay = 0;
            voice.output = 0;
        }
        this.counter = 0;
        this.noise = 0x4000;
        this.keyOn = 0;
        this.echoHistoryLeft.fill(0);
        this.echoHistoryRight.fill(0);
        this.echoOffset = 0;
        this.echoLength = 0;
        this.echoOutLeft = 0;
        this.echoOutRight = 0;
        this.samples = [];
    }

    read(addr: number): number {
        return this.registers[addr & 0x7F];
    }

    write(addr: number, data: number): void {
        addr &= 0x7F;
        this.registers[addr] = data;
        // Voices are keyed on as the next sample starts
        if (addr === KON) this.keyOn |= data;
        // Any write clears ENDX
        if (addr === ENDX) this.registers[ENDX] = 0;
    }

    takeSamples(): Int16Array {
        const samples = Int16Array.from(this.samples);
        this.samples = [];
        return samples;
    }

    // Makes the next stereo sample
    sample(): void {
        const regs = this.registers;
        if (--this.counter < 0) this.counter = COUNTER_RANGE - 1;

        const flg = regs[FLG];
        if (this.fires(flg & 0x1F)) {
            const feedback = (this.noise << 13) ^ (this.noise << 14);
            this.noise = (feedback & 0x4000) ^ (this.noise >> 1);
        }

        let mainLeft = 0;
        let mainRight = 0;
        let echoLeft = 0;
        let echoRight = 0;
        let previousOutput = 0;
        const keyOn = this.keyOn;
        this.keyOn = 0;

        for (let v = 0; v < 8; v++) {
            const voice = this.voices[v];
            const bit = 1 << v;
            const base = v << 4;

            if (keyOn & bit) this.startVoice(voice, v);
            if (regs[KOFF] & bit || flg & 0x80) voice.mode = RELEASE;
            if (flg & 0x80) voice.envelope = 0;

            let output = 0;
            if (voice.keyOnDelay > 0) {
                voice.keyOnDelay--;
            } else {
                const raw = regs[NON] & bit ? (this.noise << 17) >> 16 : this.interpolate(voice);
                output = ((raw * voice.envelope) >> 11) & ~1;
                this.runEnvelope(voice, base);

                let pitch = regs[base + PITCHL] | ((regs[base + PITCHH] & 0x3F) << 8);
                // Pitch modulation by the previous voice's output
                if (v > 0 && regs[PMON] & bit) pitch += ((previousOutput >> 5) * pitch) >> 10;
                this.advance(voice, v, pitch);
            }

            voice.output = output;
            previousOutput = output;
            regs[base + ENVX] = voice.envelope >> 4;
            regs[base + OUTX] = (output >> 8) & 0xFF;

            const left = (output * signed8(regs[base + VOLL])) >> 7;
            const right = (output * signed8(regs[base + VOLR])) >> 7;
            mainLeft = clamp16(mainLeft + left);
            mainRight = clamp16(mainRight + right);
            if (regs[EON] & bit) {
                echoLeft = clamp16(echoLeft + left);
                echoRight = clamp16(echoRight + right);
            }
        }

        this.runEcho(echoLeft, echoRight, flg);

        let left = clamp16(((mainLeft * signed8(regs[MVOLL])) >> 7) + ((this.echoOutLeft * signed8(regs[EVOLL])) >> 7));
        let right = clamp16(((mainRight * signed8(regs[MVOLR])) >> 7) + ((this.echoOutRight * signed8(regs[EVOLR])) >> 7));
        if (flg & 0x40) {
            left = 0;
            right = 0;
        }
        this.samples.push(left, right);
    }

    // Whether an event at the rate happens this sample
    private fires(rate: number): boolean {
        return (this.counter + COUNTER_OFFSETS[rate]) % COUNTER_RATES[rate] === 0;
    }

    private directoryEntry(voice: number, offset: number): number {
        const addr = ((this.registers[DIR] << 8) + (this.registers[(voice << 4) + SRCN] << 2) + offset) & 0xFFFF;
        return this.ram[addr] | (this.ram[(addr + 1) & 0xFFFF] << 8);
    }

    private startVoice(voice: Voice, v: number): void {
        voice.brrAddress = this.directoryEntry(v, 0);
        voice.samples.fill(0);
        voice.position = 0;
        voice.envelope = 0;
        voice.hiddenEnvelope = 0;
        voice.mode = ATTACK;
        voice.keyOnDelay = KEY_ON_DELAY;
        this.registers[ENDX] &= ~(1 << v);
        this.decodeBlock(voice);
    }

    // Decodes the 16 samples of the block at brrAddress, after the last 3 of the previous block
    private decodeBlock(voice: Voice): void {
        const { ram } = this;
        const buffer = voice.samples;
        buffer.copyWithin(0, 16, 16 + HISTORY);
        const header = ram[voice.brrAddress];
        voice.header = header;
        const shift = header >> 4;
        const filter = (header >> 2) & 3;

        for (let i = 0; i < 16; i++) {
            const byte = ram[(voice.brrAddress + 1 + (i >> 1)) & 0xFFFF];
            let s = (((i & 1 ? byte << 4 : byte) & 0xF0) << 24) >> 28;
            s = (s << shift) >> 1;
            // Ranges past 12 are invalid, and give -2048 or 0
            if (shift >= 0xD) s = s < 0 ? -2048 : 0;

            const p1 = buffer[HISTORY + i - 1];
            const p2 = buffer[HISTORY + i - 2] >> 1;
            switch (filter) {
                case 1:
                    s += p1 >> 1;
                    s += (-p1) >> 5;
                    break;
                case 2:
                    s += p1 - p2;
                    s += p2 >> 4;
                    s += (p1 * -3) >> 6;
                    break;
                case 3:
                    s += p1 - p2;
                    s += (p1 * -13) >> 7;
                    s += (p2 * 3) >> 4;
                    break;
            }
            // Clamped to 16 bits, then kept as 15 bits doubled
            buffer[HISTORY + i] = clamp16(s) << 1;
        }

        // The block with the end flag and no loop flag is silenced as it plays
        if ((header & 3) === 1) {
            voice.mode = RELEASE;
            voice.envelope = 0;
        }
    }

    // Moves on by the pitch, into the next block when this one is done
    private advance(voice: Voice, v: number, pitch: number): void {
        voice.position += pitch;
        while (voice.position >= 16 << 12) {
            voice.position -= 16 << 12;
            if (voice.header & 1) {
                // End of the sample: continue at its loop point
                this.registers[ENDX] |= 1 << v;
                voice.brrAddress = this.directoryEntry(v, 2);
            } else {
                voice.brrAddress = (voice.brrAddress + BRR_BLOCK_SIZE) & 0xFFFF;
            }
            this.decodeBlock(voice);
        }
    }

    // Gaussian interpolation of the 4 samples up to the current position
    private interpolate(voice: Voice): number {
        const index = voice.position >> 12;
        const offset = (voice.position >> 4) & 0xFF;
        const buffer = voice.samples;
        let out = (GAUSS[255 - offset] * buffer[index]) >> 11;
        out += (GAUSS[511 - offset] * buffer[index + 1]) >> 11;
        out += (GAUSS[256 + offset] * buffer[index + 2]) >> 11;
        out = (out << 16) >> 16;
        out += (GAUSS[offset] * buffer[index + 3]) >> 11;
        return clamp16(out) & ~1;
    }

    private runEnvelope(voice: Voice, base: number): void {
        const regs = this.registers;
        let env = voice.envelope;
        if (voice.mode === RELEASE) {
            env -= 0x8;
            voice.envelope = env < 0 ? 0 : env;
            return;
        }

        let rate: number;
        let data = regs[base + ADSR2];
        const adsr1 = regs[base + ADSR1];
        if (adsr1 & 0x80) {
            if (voice.mode >= DECAY) {
                env--;
                env -= env >> 8;
                rate = data & 0x1F;
                if (voice.mode === DECAY) rate = ((adsr1 >> 3) & 0x0E) + 0x10;
            } else {
                rate = ((adsr1 & 0x0F) << 1) + 1;
                env += rate < 31 ? 0x20 : 0x400;
            }
        } else {
            data = regs[base + GAIN];
            const mode = data >> 5;
            if (mode < 4) {
                // Direct level
                env = data << 4;
                rate = 31;
            } else {
                rate = data & 0x1F;
                if (mode === 4) {
                    env -= 0x20;
                } else if (mode === 5) {
                    env--;
                    env -= env >> 8;
                } else {
                    env += 0x20;
                    // Bent line: slower above 3/4
                    if (mode === 7 && voice.hiddenEnvelope >= 0x600) env += 0x8 - 0x20;
                }
            }
        }

        // The sustain level, ADSR2's top 3 bits (or GAIN's, as the hardware does)
        if ((env >> 8) === (data >> 5) && voice.mode === DECAY) voice.mode = SUSTAIN;
        voice.hiddenEnvelope = env;

        if (env < 0 || env > 0x7FF) {
            env = env < 0 ? 0 : 0x7FF;
            if (voice.mode === ATTACK) voice.mode = DECAY;
        }
        if (this.fires(rate)) voice.envelope = env;
    }

    private read16(addr: number): number {
        return ((this.ram[addr & 0xFFFF] | (this.ram[(addr + 1) & 0xFFFF] << 8)) << 16) >> 16;
    }

    // Reads and filters the echo buffer, and writes the new echo input into it
    private runEcho(inLeft: number, inRight: number, flg: number): void {
        const { ram, registers: regs } = this;
        const address = ((regs[ESA] << 8) + this.echoOffset) & 0xFFFF;

        const historyLeft = this.echoHistoryLeft;
        const historyRight = this.echoHistoryRight;
        historyLeft.copyWithin(0, 1);
        historyRight.copyWithin(0, 1);
        historyLeft[7] = this.read16(address) >> 1;
        historyRight[7] = this.read16(address + 2) >> 1;

        // The first 7 taps wrap at 16 bits, the last one clamps
        let left = 0;
        let right = 0;
        for (let i = 0; i < 7; i++) {
            const coefficient = signed8(regs[FIR + (i << 4)]);
            left += (historyLeft[i] * coefficient) >> 6;
            right += (historyRight[i] * coefficient) >> 6;
        }
        const last = signed8(regs[FIR + 0x70]);
        left = clamp16(((left << 16) >> 16) + ((historyLeft[7] * last) >> 6)) & ~1;
        right = clamp16(((right << 16) >> 16) + ((historyRight[7] * last) >> 6)) & ~1;

        if (!(flg & 0x20)) {
            const efb = signed8(regs[EFB]);
            const writeLeft = clamp16(inLeft + ((left * efb) >> 7)) & ~1;
            const writeRight = clamp16(inRight + ((right * efb) >> 7)) & ~1;
            ram[address & 0xFFFF] = writeLeft & 0xFF;
            ram[(address + 1) & 0xFFFF] = (writeLeft >> 8) & 0xFF;
            ram[(address + 2) & 0xFFFF] = writeRight & 0xFF;
            ram[(address + 3) & 0xFFFF] = (writeRight >> 8) & 0xFF;
        }

        // The length is latched when the buffer wraps around, 2 KB per EDL step or 4 bytes for 0
        if (this.echoOffset === 0) this.echoLength = regs[EDL] ? (regs[EDL] & 0x0F) << 11 : 4;
        this.echoOffset += 4;
        if (this.echoOffset >= this.echoLength) this.echoOffset = 0;
        this.echoOutLeft = left;
        this.echoOutRight = right;
    }
}

export default Dsp;

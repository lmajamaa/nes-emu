// Turns the DSP's stereo 16-bit samples into stereo float samples at the audio output's rate,
// by linear interpolation.
class Resampler {
    // Input frames per output frame
    private step = 1;
    // Position of the next output frame in the input, where -1 is the last frame of the previous block
    private time = 0;
    private previousLeft = 0;
    private previousRight = 0;

    constructor(private readonly inputRate: number) {}

    setOutputRate(outputRate: number): void {
        this.step = this.inputRate / outputRate;
    }

    // Interleaved left and right samples in and out
    resample(input: Int16Array): Float32Array {
        const count = input.length >> 1;
        const frames = Math.max(0, Math.ceil((count - 1 - this.time) / this.step));
        const output = new Float32Array(frames * 2);
        const sample = (i: number, channel: number) =>
            (i < 0 ? (channel ? this.previousRight : this.previousLeft) : input[(i << 1) + channel] / 32768);

        let n = 0;
        let time = this.time;
        for (; time < count - 1 && n < frames; time += this.step, n++) {
            const index = Math.floor(time);
            const fraction = time - index;
            for (let channel = 0; channel < 2; channel++) {
                const a = sample(index, channel);
                output[(n << 1) + channel] = a + (sample(index + 1, channel) - a) * fraction;
            }
        }
        if (count > 0) {
            this.previousLeft = sample(count - 1, 0);
            this.previousRight = sample(count - 1, 1);
            this.time = time - count;
        }
        return n === frames ? output : output.subarray(0, n << 1);
    }
}

export default Resampler;

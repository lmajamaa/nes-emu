// Turns the DSP's stereo 16-bit samples into mono float samples at the audio output's rate, by
// linear interpolation. The shell plays mono for now.
class Resampler {
    // Input samples per output sample
    private step = 1;
    // Position of the next output sample in the input, where -1 is the last sample of the previous block
    private time = 0;
    private previous = 0;

    constructor(private readonly inputRate: number) {}

    setOutputRate(outputRate: number): void {
        this.step = this.inputRate / outputRate;
    }

    // Interleaved left and right samples in, mono out
    resample(input: Int16Array): Float32Array {
        const count = input.length >> 1;
        const output = new Float32Array(Math.max(0, Math.ceil((count - 1 - this.time) / this.step)));
        const mono = (i: number) => (i < 0 ? this.previous : (input[i << 1] + input[(i << 1) + 1]) / 65536);

        let n = 0;
        let time = this.time;
        for (; time < count - 1 && n < output.length; time += this.step) {
            const index = Math.floor(time);
            const fraction = time - index;
            output[n++] = mono(index) + (mono(index + 1) - mono(index)) * fraction;
        }
        if (count > 0) {
            this.previous = mono(count - 1);
            this.time = time - count;
        }
        return n === output.length ? output : output.subarray(0, n);
    }
}

export default Resampler;

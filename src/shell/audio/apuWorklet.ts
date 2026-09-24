// Runs in the AudioWorkletGlobalScope, which the DOM typings don't cover
declare const sampleRate: number;
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

const PREBUFFER_SECONDS = 0.05;
const MAX_BUFFER_SECONDS = 0.2;

// Plays the interleaved left and right samples posted by the emulator. When it runs dry it
// fades out and waits for a new prebuffer, instead of crackling on every late frame.
class ApuOutputProcessor extends AudioWorkletProcessor {
    private queue: Float32Array[] = [];
    private offset = 0;
    // In frames, a left and a right sample each
    private buffered = 0;
    private playing = false;
    private lastLeft = 0;
    private lastRight = 0;

    constructor() {
        super();
        this.port.onmessage = (event: MessageEvent<Float32Array | 'clear'>) => {
            if (event.data === 'clear') {
                this.queue = [];
                this.offset = 0;
                this.buffered = 0;
                return;
            }
            this.queue.push(event.data);
            this.buffered += event.data.length >> 1;
            // Drop the oldest audio rather than drifting behind the picture
            while (this.buffered > MAX_BUFFER_SECONDS * sampleRate && this.queue.length > 1) {
                this.buffered -= (this.queue[0].length - this.offset) >> 1;
                this.queue.shift();
                this.offset = 0;
            }
        };
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const output = outputs[0];
        const left = output[0];
        const right = output[1] ?? left;
        if (!this.playing && this.buffered >= PREBUFFER_SECONDS * sampleRate) this.playing = true;

        for (let i = 0; i < left.length; i++) {
            if (this.playing && this.queue.length > 0) {
                const chunk = this.queue[0];
                this.lastLeft = chunk[this.offset++];
                this.lastRight = chunk[this.offset++];
                this.buffered--;
                if (this.offset >= chunk.length) {
                    this.queue.shift();
                    this.offset = 0;
                }
            } else {
                this.playing = false;
                this.lastLeft *= 0.995;
                this.lastRight *= 0.995;
            }
            left[i] = this.lastLeft;
            right[i] = this.lastRight;
        }
        return true;
    }
}

registerProcessor('apu-output', ApuOutputProcessor);

export {};

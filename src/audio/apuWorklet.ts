// Runs in the AudioWorkletGlobalScope, which the DOM typings don't cover
declare const sampleRate: number;
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

const PREBUFFER_SECONDS = 0.05;
const MAX_BUFFER_SECONDS = 0.2;

// Plays the samples posted by the emulator. When it runs dry it fades out and waits for
// a new prebuffer, instead of crackling on every late frame.
class ApuOutputProcessor extends AudioWorkletProcessor {
    private queue: Float32Array[] = [];
    private offset = 0;
    private buffered = 0;
    private playing = false;
    private last = 0;

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
            this.buffered += event.data.length;
            // Drop the oldest audio rather than drifting behind the picture
            while (this.buffered > MAX_BUFFER_SECONDS * sampleRate && this.queue.length > 1) {
                this.buffered -= this.queue[0].length - this.offset;
                this.queue.shift();
                this.offset = 0;
            }
        };
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const output = outputs[0];
        const channel = output[0];
        if (!this.playing && this.buffered >= PREBUFFER_SECONDS * sampleRate) this.playing = true;

        for (let i = 0; i < channel.length; i++) {
            if (this.playing && this.queue.length > 0) {
                const chunk = this.queue[0];
                this.last = chunk[this.offset++];
                this.buffered--;
                if (this.offset === chunk.length) {
                    this.queue.shift();
                    this.offset = 0;
                }
            } else {
                this.playing = false;
                this.last *= 0.995;
            }
            channel[i] = this.last;
        }
        for (let c = 1; c < output.length; c++) output[c].set(channel);
        return true;
    }
}

registerProcessor('apu-output', ApuOutputProcessor);

export {};

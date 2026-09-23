import workletUrl from './apuWorklet.ts?worker&url';

const VOLUME = 1.5;

class AudioOutput {
    private context: AudioContext | null = null;
    private node: AudioWorkletNode | null = null;
    private gain: GainNode | null = null;
    private muted = false;

    get sampleRate(): number | null {
        return this.context?.sampleRate ?? null;
    }

    get ready(): boolean {
        return this.node !== null && this.context?.state === 'running';
    }

    get isMuted(): boolean {
        return this.muted;
    }

    // Browsers only allow audio to start from a user gesture, like a key press
    async start(): Promise<void> {
        if (this.context) {
            await this.context.resume();
            return;
        }

        const context = new AudioContext({ latencyHint: 'interactive' });
        this.context = context;
        await context.audioWorklet.addModule(workletUrl);
        const node = new AudioWorkletNode(context, 'apu-output', { outputChannelCount: [1] });
        const gain = context.createGain();
        gain.gain.value = this.muted ? 0 : VOLUME;
        node.connect(gain).connect(context.destination);
        this.node = node;
        this.gain = gain;
    }

    push(samples: Float32Array): void {
        if (this.node && samples.length > 0) {
            this.node.port.postMessage(samples, [samples.buffer]);
        }
    }

    // Drops what is queued, e.g. when pausing
    clear(): void {
        this.node?.port.postMessage('clear');
    }

    setMuted(muted: boolean): void {
        this.muted = muted;
        if (this.gain) this.gain.gain.value = muted ? 0 : VOLUME;
    }
}

export default AudioOutput;

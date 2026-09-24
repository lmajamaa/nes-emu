import workletUrl from './apuWorklet.ts?worker&url';

// The gain at full volume
const VOLUME = 1.5;

class AudioOutput {
    private context: AudioContext | null = null;
    private node: AudioWorkletNode | null = null;
    private gain: GainNode | null = null;
    private muted = false;
    // 0 to 1
    private volume = 1;

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
        const node = new AudioWorkletNode(context, 'apu-output', { outputChannelCount: [2] });
        const gain = context.createGain();
        gain.gain.value = this.level;
        node.connect(gain).connect(context.destination);
        this.node = node;
        this.gain = gain;
    }

    // Interleaved left and right samples
    push(samples: Float32Array): void {
        if (this.node && samples.length > 0) {
            this.node.port.postMessage(samples, [samples.buffer]);
        }
    }

    // Drops what is queued, e.g. when pausing
    clear(): void {
        this.node?.port.postMessage('clear');
    }

    private get level(): number {
        return this.muted ? 0 : this.volume * VOLUME;
    }

    setVolume(volume: number): void {
        this.volume = Math.min(1, Math.max(0, volume));
        if (this.gain) this.gain.gain.value = this.level;
    }

    setMuted(muted: boolean): void {
        this.muted = muted;
        if (this.gain) this.gain.gain.value = this.level;
    }
}

export default AudioOutput;

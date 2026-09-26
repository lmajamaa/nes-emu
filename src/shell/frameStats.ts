// How long emulating a frame takes, and how many frames are shown a second, over the last second
export class FrameStats {
    private readonly times: { at: number; ms: number }[] = [];

    // A frame emulated at a time, taking ms
    record(at: number, ms: number): void {
        this.times.push({ at, ms });
        while (this.times.length > 0 && this.times[0]!.at <= at - 1000) this.times.shift();
    }

    clear(): void {
        this.times.length = 0;
    }

    get framesPerSecond(): number {
        return this.times.length;
    }

    get averageMs(): number {
        return this.times.length ? this.times.reduce((sum, { ms }) => sum + ms, 0) / this.times.length : 0;
    }

    get slowestMs(): number {
        return this.times.reduce((slowest, { ms }) => Math.max(slowest, ms), 0);
    }
}

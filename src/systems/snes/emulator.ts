import type { Emulator, LoadResult } from '../types';
import { DSP_SAMPLE_RATE } from './core/apu/dsp';
import SnesCartridge from './core/cartridge';
import { FRAME_WIDTH } from './core/ppu';
import Snes from './core/snes';
import Resampler from './resampler';

const FRAME_RATE = 21_477_272 / (1364 * 262);

export class SnesEmulator implements Emulator {
    snes: Snes | null = null;
    readonly frameRate = FRAME_RATE;
    private readonly resampler = new Resampler(DSP_SAMPLE_RATE);
    // Buttons held before a cartridge is in
    private readonly buttons = [0, 0];

    constructor() {
        this.resampler.setOutputRate(44100);
    }

    // The PPU draws 512 wide to fit hi-res, lo-res lines have every pixel twice
    get width(): number {
        return FRAME_WIDTH;
    }

    get height(): number {
        return this.snes?.bus.ppu.height ?? 224;
    }

    load(rom: ArrayBuffer): LoadResult {
        const cartridge = new SnesCartridge(rom);
        this.snes = new Snes(cartridge);
        this.snes.reset();
        this.buttons.forEach((buttons, player) => this.snes!.bus.io.controllers[player].buttons = buttons);
        const { coprocessor } = cartridge.header;
        if (coprocessor) {
            return { warning: `This game uses the ${coprocessor} chip, which isn't emulated yet, so it may not work.` };
        }
        return {};
    }

    reset(): void {
        this.snes?.reset();
    }

    runFrame(): void {
        const { snes } = this;
        if (!snes) return;
        snes.runFrame();
        // Makes the sound up to the end of the frame
        snes.bus.syncApu();
    }

    drawFrame(target: ImageData): void {
        const { snes } = this;
        if (!snes) return;
        const pixels = new Uint32Array(target.data.buffer, target.data.byteOffset, target.width * target.height);
        pixels.set(snes.bus.ppu.frame.subarray(0, pixels.length));
    }

    setButton(player: number, button: number, pressed: boolean): void {
        this.buttons[player] = pressed ? this.buttons[player] | button : this.buttons[player] & ~button;
        if (this.snes) this.snes.bus.io.controllers[player].buttons = this.buttons[player];
    }

    setSampleRate(sampleRate: number): void {
        this.resampler.setOutputRate(sampleRate);
    }

    takeSamples(): Float32Array {
        if (!this.snes) return new Float32Array(0);
        return this.resampler.resample(this.snes.bus.apu.takeSamples());
    }
}

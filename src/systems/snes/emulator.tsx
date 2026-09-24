import type { ReactNode } from 'react';
import type { Emulator, LoadResult } from '../types';
import { DSP_SAMPLE_RATE } from './core/apu/dsp';
import SnesCartridge from './core/cartridge';
import { FRAME_WIDTH } from './core/ppu';
import Snes from './core/snes';
import Resampler from './resampler';
import SnesDebugger from './ui/SnesDebugger';

const FRAME_RATE = 21_477_272 / (1364 * 262);

// FNV-1a, to tell games apart for their saves
function hashOf(data: Uint8Array): string {
    let hash = 0x811C9DC5;
    for (let i = 0; i < data.length; i++) {
        hash ^= data[i];
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export class SnesEmulator implements Emulator {
    snes: Snes | null = null;
    saveId: string | null = null;
    readonly frameRate = FRAME_RATE;
    private readonly resampler = new Resampler(DSP_SAMPLE_RATE);
    // Buttons held before a cartridge is in
    private readonly buttons = [0, 0];

    readonly Debugger = ({ children }: { children: ReactNode }) => <SnesDebugger snes={this.snes}>{children}</SnesDebugger>;

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
        const { header } = cartridge;
        this.saveId = header.battery && cartridge.sram.length > 0 ? `snes-${hashOf(cartridge.rom)}` : null;
        if (header.coprocessor) {
            return { warning: `This game uses the ${header.coprocessor} chip, which isn't emulated yet, so it may not work.` };
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

    loadSave(data: Uint8Array): void {
        const cartridge = this.snes?.bus.cartridge;
        if (!cartridge) return;
        cartridge.sram.set(data.subarray(0, cartridge.sram.length));
        cartridge.sramDirty = false;
    }

    takeSave(): Uint8Array | null {
        const cartridge = this.snes?.bus.cartridge;
        if (!cartridge?.sramDirty) return null;
        cartridge.sramDirty = false;
        return cartridge.sram.slice();
    }

    handleDebugKey(code: string): boolean {
        if (code !== 'KeyC' || !this.snes) return false;
        // One instruction, or taking an interrupt
        this.snes.step();
        return true;
    }
}

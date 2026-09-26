import type { ReactNode } from 'react';
import { hashOf } from '../../utils';
import Bus from './core/bus';
import Cartridge, { SUPPORTED_MAPPERS } from './core/cartridge';
import { Button } from './core/controller';
import { PadButton, type Emulator, type EmulatorSystem, type LoadResult } from '../types';
import NesLogo from './ui/NesLogo';
import NesDebugger from './ui/NesDebugger';

export class NesEmulator implements Emulator {
    readonly bus = new Bus();
    readonly width = 256;
    readonly height = 240;
    readonly frameRate = 60.0988;
    saveId: string | null = null;
    // Palette used by the pattern table view
    selectedPalette = 0;

    readonly Debugger = ({ children }: { children: ReactNode }) => <NesDebugger nes={this}>{children}</NesDebugger>;

    load(rom: ArrayBuffer): LoadResult {
        const cartridge = new Cartridge(rom);
        this.bus.insertCartridge(cartridge);
        this.bus.reset();
        this.saveId = cartridge.battery ? `nes-${hashOf(cartridge.rom)}` : null;
        if (!SUPPORTED_MAPPERS.includes(cartridge.mapperId)) {
            return { warning: `Mapper ${cartridge.mapperId} is not supported yet, running it as mapper 0 so it may not work.` };
        }
        return {};
    }

    loadSave(data: Uint8Array): void {
        const cartridge = this.bus.cartridge;
        if (!cartridge) return;
        cartridge.prgRam.set(data.subarray(0, cartridge.prgRam.length));
        cartridge.prgRamDirty = false;
    }

    takeSave(): Uint8Array | null {
        const cartridge = this.bus.cartridge;
        if (!cartridge?.prgRamDirty) return null;
        cartridge.prgRamDirty = false;
        return cartridge.prgRam.slice();
    }

    reset(): void {
        this.bus.reset();
    }

    runFrame(): void {
        const { bus } = this;
        do { bus.clock(); } while (!bus.ppu.frameComplete);
        bus.ppu.frameComplete = false;
    }

    drawFrame(target: ImageData): void {
        this.bus.ppu.screen.toRgba(target.data);
    }

    setButton(player: number, button: number, pressed: boolean): void {
        if (pressed) {
            this.bus.controller[player] |= button;
        } else {
            this.bus.controller[player] &= ~button;
        }
    }

    setSampleRate(sampleRate: number): void {
        this.bus.apu.setSampleRate(sampleRate);
    }

    // The NES is mono, so both channels get the same
    takeSamples(): Float32Array {
        const mono = this.bus.apu.takeSamples();
        const stereo = new Float32Array(mono.length * 2);
        for (let i = 0; i < mono.length; i++) stereo[i * 2] = stereo[i * 2 + 1] = mono[i];
        return stereo;
    }

    handleDebugKey(code: string): boolean {
        const { bus } = this;
        switch (code) {
            case 'KeyC':
                // Clock enough times to execute a whole CPU instruction
                do { bus.clock(); } while (!bus.cpu.complete());
                // CPU clock runs slower than system clock, so it may be
                // complete for additional system clock cycles. Drain
                // those out
                do { bus.clock(); } while (!bus.cpu.complete());
                return true;
            case 'KeyF':
                this.runFrame();
                // Use residual clock cycles to complete current instruction
                do { bus.clock(); } while (!bus.cpu.complete());
                return true;
            case 'KeyP':
                this.selectedPalette = (this.selectedPalette + 1) & 0x07;
                return true;
            case 'KeyI':
                bus.cpu.irq();
                return true;
            case 'KeyN':
                bus.cpu.nmi();
                return true;
            default:
                return false;
        }
    }
}

const nes: EmulatorSystem = {
    id: 'nes',
    name: 'Nintendo Entertainment System',
    shortName: 'NES',
    extensions: ['.nes'],
    Logo: NesLogo,
    keyMap: {
        KeyX: Button.A,
        KeyZ: Button.B,
        KeyA: Button.Select,
        KeyS: Button.Start,
        ArrowUp: Button.Up,
        ArrowDown: Button.Down,
        ArrowLeft: Button.Left,
        ArrowRight: Button.Right,
    },
    // B and A where they are on a SNES pad, which most pads follow
    padMap: {
        [PadButton.FaceBottom]: Button.B,
        [PadButton.FaceRight]: Button.A,
        [PadButton.Select]: Button.Select,
        [PadButton.Start]: Button.Start,
        [PadButton.Up]: Button.Up,
        [PadButton.Down]: Button.Down,
        [PadButton.Left]: Button.Left,
        [PadButton.Right]: Button.Right,
    },
    controlsHelp: 'Arrows = D-pad    X = A    Z = B    A = Select    S = Start',
    create: () => new NesEmulator(),
};

export default nes;

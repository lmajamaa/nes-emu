import type { ReactNode } from 'react';
import Bus from '../../nes/bus';
import Cartridge, { SUPPORTED_MAPPERS } from '../../nes/cartridge';
import { Button } from '../../nes/controller';
import type { Emulator, EmulatorSystem, LoadResult } from '../types';
import NesLogo from './ui/NesLogo';
import NesDebugger from './ui/NesDebugger';

export class NesEmulator implements Emulator {
    readonly bus = new Bus();
    readonly width = 256;
    readonly height = 240;
    readonly frameRate = 60.0988;
    // Palette used by the pattern table view
    selectedPalette = 0;

    readonly Debugger = ({ children }: { children: ReactNode }) => <NesDebugger nes={this}>{children}</NesDebugger>;

    load(rom: ArrayBuffer): LoadResult {
        const cartridge = new Cartridge(rom);
        this.bus.insertCartridge(cartridge);
        this.bus.reset();
        if (!SUPPORTED_MAPPERS.includes(cartridge.mapperId)) {
            return { warning: `Mapper ${cartridge.mapperId} is not supported yet, running it as mapper 0 so it may not work.` };
        }
        return {};
    }

    reset(): void {
        this.bus.reset();
    }

    runFrame(): void {
        const { bus } = this;
        do { bus.clock(); } while (!bus.ppu.frame_complete);
        bus.ppu.frame_complete = false;
    }

    drawFrame(target: ImageData): void {
        const screen = this.bus.ppu.getScreen();
        const data = target.data;
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const pixel = screen.getPixel(x, y);
                const index = (y * this.width + x) * 4;
                data[index + 0] = pixel.r;
                data[index + 1] = pixel.g;
                data[index + 2] = pixel.b;
                data[index + 3] = 255;
            }
        }
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

    takeSamples(): Float32Array {
        return this.bus.apu.takeSamples();
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
    controlsHelp: 'Arrows = D-pad    X = A    Z = B    A = Select    S = Start',
    create: () => new NesEmulator(),
};

export default nes;

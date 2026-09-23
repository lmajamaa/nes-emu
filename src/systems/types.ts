import type { ComponentType, ReactNode, SVGProps } from 'react';

export interface LoadResult {
    // Shown to the user when the ROM loaded but may not run correctly
    warning?: string;
}

// A running console, as the shell sees it. Each system adapts its own core to this.
export interface Emulator {
    readonly width: number;
    readonly height: number;
    readonly frameRate: number;

    // Throws if the ROM can't be used
    load(rom: ArrayBuffer): LoadResult;
    reset(): void;
    runFrame(): void;
    // Writes the last completed frame as RGBA
    drawFrame(target: ImageData): void;

    setButton(player: number, button: number, pressed: boolean): void;

    setSampleRate(sampleRate: number): void;
    // Mono samples generated since the last call, at the rate given to setSampleRate
    takeSamples(): Float32Array;

    // Keys the system handles itself, like stepping one instruction. Returns true if handled.
    handleDebugKey?(code: string): boolean;
    // Lays out its views around the screen, which it gets as children. Re-rendered while the emulator runs.
    readonly Debugger?: ComponentType<{ children: ReactNode }>;
}

export interface EmulatorSystem {
    readonly id: string;
    readonly name: string;
    readonly shortName: string;
    // Lower case, with the dot
    readonly extensions: readonly string[];
    readonly Logo: ComponentType<SVGProps<SVGSVGElement>>;
    // KeyboardEvent.code to a controller button of this system
    readonly keyMap: Readonly<Record<string, number>>;
    readonly controlsHelp: string;
    // Missing while the system is not emulated yet
    readonly create?: () => Emulator;
}

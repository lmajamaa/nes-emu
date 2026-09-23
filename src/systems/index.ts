import type { EmulatorSystem } from './types';
import nes from './nes';
import snes from './snes';

export type { Emulator, EmulatorSystem, LoadResult } from './types';

export const SYSTEMS: readonly EmulatorSystem[] = [nes, snes];

export function systemForFile(fileName: string): EmulatorSystem | undefined {
    const name = fileName.toLowerCase();
    return SYSTEMS.find(system => system.extensions.some(extension => name.endsWith(extension)));
}

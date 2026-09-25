import romFiles from 'virtual:rom-library';
import { systemForFile, type EmulatorSystem } from '../systems';

export interface RomEntry {
    fileName: string;
    title: string;
    url: string;
    system: EmulatorSystem;
}

function entry(fileName: string, url: string): RomEntry | null {
    const system = systemForFile(fileName);
    if (!system) return null;
    const title = fileName.slice(0, fileName.lastIndexOf('.'));
    return { fileName, title, url, system };
}

// Vite's static server doesn't decode reserved characters like %2C, so only escape what would break the URL
function encodeFileName(fileName: string): string {
    return encodeURI(fileName).replace(/[?#]/g, encodeURIComponent);
}

// ROMs in public/roms, which is git ignored apart from nestest.nes
export const ROM_LIBRARY: readonly RomEntry[] = romFiles
    .map(fileName => entry(fileName, `${import.meta.env.BASE_URL}roms/${encodeFileName(fileName)}`))
    .filter(rom => rom !== null)
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

const nestest = ROM_LIBRARY.find(rom => rom.fileName === 'nestest.nes');
if (!nestest) throw new Error('public/roms/nestest.nes is missing');
export const DEFAULT_ROM: RomEntry = nestest;

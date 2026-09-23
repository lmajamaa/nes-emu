import romFiles from 'virtual:rom-library';
import nestestUrl from '../../test/data/nestest/nestest.nes?url';
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

const bundled =[entry('nestest.nes', nestestUrl)];
// ROMs dropped into public/roms, which is git ignored
const local = romFiles.map(fileName => entry(fileName, `${import.meta.env.BASE_URL}roms/${encodeFileName(fileName)}`));

export const DEFAULT_ROM = bundled[0]!;

export const ROM_LIBRARY: readonly RomEntry[] = [...bundled, ...local]
    .filter((rom, index, all): rom is RomEntry => rom !== null && all.findIndex(other => other?.fileName === rom.fileName) === index)
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

import type Mapper from './mappers/mapper';
import Nrom from './mappers/mapper_000';
import Mmc1 from './mappers/mapper_001';
import Uxrom from './mappers/mapper_002';
import Cnrom from './mappers/mapper_003';
import Mmc3 from './mappers/mapper_004';
import Axrom from './mappers/mapper_007';
import Mmc2 from './mappers/mapper_009';
import { MIRROR, type Mirror } from './constants';

const HEADER_SIZE = 16;
const TRAINER_SIZE = 512;
const PRG_BANK_SIZE = 16384;
const CHR_BANK_SIZE = 8192;

const MAPPERS: Readonly<Record<number, new (prgRomBanks: number, chrRomBanks: number) => Mapper>> = {
    0: Nrom,
    1: Mmc1,
    2: Uxrom,
    3: Cnrom,
    4: Mmc3,
    7: Axrom,
    9: Mmc2,
};

export const SUPPORTED_MAPPERS: readonly number[] = Object.keys(MAPPERS).map(Number);

// An iNES ROM file, see https://www.nesdev.org/wiki/INES
class Cartridge {
    readonly mapperId: number;
    // PRG RAM kept by a battery, for the game's saves
    readonly battery: boolean;
    // PRG and CHR ROM, which tell games apart
    readonly rom: Uint8Array;
    private readonly hardwiredMirror: Mirror;
    private readonly prgRom: Uint8Array;
    // CHR ROM, or 8KB of CHR RAM on boards without it
    private readonly chr: Uint8Array;
    // Most boards have no PRG RAM at $6000-$7FFF, but emulators commonly provide it (test ROMs rely on it)
    readonly prgRam = new Uint8Array(0x2000);
    prgRamDirty = false;
    private readonly mapper: Mapper;

    constructor(data: ArrayBuffer | Uint8Array) {
        const bytes = new Uint8Array(data);
        if (bytes.length < HEADER_SIZE || String.fromCharCode(...bytes.subarray(0, 4)) !== 'NES\x1A') {
            throw new Error('Not an iNES ROM file');
        }
        const prgRomBanks = bytes[4];
        const chrRomBanks = bytes[5];
        const flags6 = bytes[6];
        const flags7 = bytes[7];

        const prgStart = HEADER_SIZE + (flags6 & 0x04 ? TRAINER_SIZE : 0);
        const chrStart = prgStart + prgRomBanks * PRG_BANK_SIZE;
        const end = chrStart + chrRomBanks * CHR_BANK_SIZE;
        if (bytes.length < end) {
            throw new Error('ROM file is truncated');
        }

        this.mapperId = (flags7 & 0xF0) | (flags6 >> 4);
        this.hardwiredMirror = flags6 & 0x01 ? MIRROR.VERTICAL : MIRROR.HORIZONTAL;
        this.battery = (flags6 & 0x02) !== 0;
        this.rom = bytes.subarray(prgStart, end);
        this.prgRom = bytes.subarray(prgStart, chrStart);
        this.chr = chrRomBanks === 0 ? new Uint8Array(CHR_BANK_SIZE) : bytes.subarray(chrStart, end);
        // Unsupported mappers run as NROM, which the shell warns about
        const MapperClass = MAPPERS[this.mapperId] ?? Nrom;
        this.mapper = new MapperClass(prgRomBanks, chrRomBanks);
    }

    // Communication with main bus, null when the address isn't the cartridge's
    cpuRead(addr: number): number | null {
        if (addr >= 0x6000 && addr <= 0x7FFF) return this.prgRam[addr & 0x1FFF];
        const offset = this.mapper.cpuMapRead(addr);
        return offset === null ? null : this.prgRom[offset];
    }

    // Returns whether the address was the cartridge's
    cpuWrite(addr: number, data: number): boolean {
        if (addr >= 0x6000 && addr <= 0x7FFF) {
            if (this.prgRam[addr & 0x1FFF] !== data) {
                this.prgRam[addr & 0x1FFF] = data;
                this.prgRamDirty = true;
            }
            return true;
        }
        return this.mapper.cpuMapWrite(addr, data);
    }

    // Communication with PPU bus
    ppuRead(addr: number): number | null {
        const offset = this.mapper.ppuMapRead(addr);
        return offset === null ? null : this.chr[offset];
    }

    ppuWrite(addr: number, data: number): boolean {
        const offset = this.mapper.ppuMapWrite(addr);
        if (offset === null) return false;
        this.chr[offset] = data;
        return true;
    }

    get mirror(): Mirror {
        return this.mapper.mirror() ?? this.hardwiredMirror;
    }

    ppuAddress(addr: number, time: number): void {
        this.mapper.ppuAddress(addr, time);
    }

    get irq(): boolean {
        return this.mapper.irq;
    }

    reset(): void {
        this.mapper.reset();
    }
}

export default Cartridge;

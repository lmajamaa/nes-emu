// SNES cartridge: finds the internal header to tell how the ROM is mapped, and maps ROM and
// SRAM into the 24-bit address space. Enhancement chips aren't emulated.

export type MapMode = 'LoROM' | 'HiROM' | 'ExHiROM';

export interface SnesHeader {
    title: string;
    mapMode: MapMode;
    // Allows the faster 120 ns memory access in banks $80-$FF
    fastRom: boolean;
    // Enhancement chip, null for plain ROM (and RAM) carts
    coprocessor: string | null;
    battery: boolean;
    // Declared sizes in bytes
    romSize: number;
    sramSize: number;
    region: number;
    version: number;
}

// Where the header is for each mapping, at the end of the first bank of ROM
const HEADER_OFFSETS: Record<MapMode, number> = {
    LoROM: 0x7FC0,
    HiROM: 0xFFC0,
    ExHiROM: 0x40FFC0,
};

const COPIER_HEADER_SIZE = 512;
const MIN_ROM_SIZE = 0x8000;
const MAX_SRAM_SIZE = 0x80000;

const COPROCESSORS: Record<number, string> = {
    0x0: 'DSP',
    0x1: 'SuperFX',
    0x2: 'OBC1',
    0x3: 'SA-1',
    0x4: 'S-DD1',
    0x5: 'S-RTC',
    0xE: 'Super Game Boy / Satellaview',
    0xF: 'custom chip',
};

// The header is identified by how plausible its fields look, like bsnes and snes9x do
function scoreHeader(rom: Uint8Array, mapMode: MapMode): number {
    const offset = HEADER_OFFSETS[mapMode];
    if (rom.length < offset + 0x40) return -Infinity;

    let score = 0;
    const byte = (i: number) => rom[offset + i];
    const word = (i: number) => byte(i) | (byte(i + 1) << 8);

    const checksum = word(0x1E);
    const complement = word(0x1C);
    if ((checksum ^ complement) === 0xFFFF) score += 4;

    const mapByte = byte(0x15) & 0x0F;
    if (mapMode === 'LoROM' && (mapByte === 0x0 || mapByte === 0x2 || mapByte === 0x3)) score += 2;
    if (mapMode === 'HiROM' && (mapByte === 0x1 || mapByte === 0xA)) score += 2;
    if (mapMode === 'ExHiROM' && mapByte === 0x5) score += 2;
    if ((byte(0x15) & 0xE0) === 0x20) score += 1;

    // Reset vector, which has to point to ROM
    score += word(0x3C) >= 0x8000 ? 2 : -4;

    if (byte(0x17) >= 0x07 && byte(0x17) <= 0x0D) score += 1;
    if (byte(0x18) <= 0x08) score += 1;
    if (byte(0x19) <= 0x14) score += 1;

    let printable = true;
    for (let i = 0; i < 21; i++) {
        const c = byte(i);
        if (c !== 0 && (c < 0x20 || c > 0x7E)) printable = false;
    }
    if (printable) score += 1;
    return score;
}

function parseHeader(rom: Uint8Array, mapMode: MapMode): SnesHeader {
    const offset = HEADER_OFFSETS[mapMode];
    const byte = (i: number) => rom[offset + i];

    const title = String.fromCharCode(...rom.subarray(offset, offset + 21)).replace(/[^\x20-\x7E]/g, ' ').trim();
    const chipset = byte(0x16);
    const hasCoprocessor = (chipset & 0x0F) >= 0x3;
    const sizeByte = byte(0x18);

    return {
        title,
        mapMode,
        fastRom: (byte(0x15) & 0x10) !== 0,
        coprocessor: hasCoprocessor ? COPROCESSORS[chipset >> 4] ?? 'unknown chip' : null,
        battery: [0x02, 0x05, 0x06].includes(chipset & 0x0F),
        romSize: 0x400 << byte(0x17),
        sramSize: sizeByte > 0 && sizeByte <= 0x09 ? 0x400 << sizeByte : 0,
        region: byte(0x19),
        version: byte(0x1B),
    };
}

// Maps an offset into memory of a size that isn't a power of two, like bsnes: e.g. a 3 MB ROM
// is a 2 MB and a 1 MB chip, and the 1 MB one repeats over the upper 2 MB.
export function mirror(addr: number, size: number): number {
    if (size === 0) return 0;
    let base = 0;
    let mask = 1 << 23;
    while (addr >= size) {
        while (!(addr & mask)) mask >>= 1;
        addr -= mask;
        if (size > mask) {
            size -= mask;
            base += mask;
        }
        mask >>= 1;
    }
    return base + addr;
}

class SnesCartridge {
    readonly rom: Uint8Array;
    readonly sram: Uint8Array;
    readonly header: SnesHeader;

    constructor(data: ArrayBuffer) {
        let rom = new Uint8Array(data);
        // Copier devices put a 512-byte header of their own in front of the ROM
        if (rom.length % 0x400 === COPIER_HEADER_SIZE) rom = rom.subarray(COPIER_HEADER_SIZE);
        if (rom.length < MIN_ROM_SIZE) {
            throw new Error('Not a SNES ROM file, it is too small');
        }

        const modes: MapMode[] = ['LoROM', 'HiROM', 'ExHiROM'];
        const scores = modes.map(mode => scoreHeader(rom, mode));
        const best = scores.indexOf(Math.max(...scores));
        if (scores[best] < 4) {
            throw new Error('Not a SNES ROM file, it has no valid header');
        }

        this.rom = rom.slice();
        this.header = parseHeader(this.rom, modes[best]);
        this.sram = new Uint8Array(Math.min(this.header.sramSize, MAX_SRAM_SIZE));
    }

    get mapMode(): MapMode {
        return this.header.mapMode;
    }

    // Returns -1 where the cartridge doesn't respond, which is open bus
    read(addr: number): number {
        const sram = this.sramOffset(addr);
        if (sram >= 0) return this.sram[sram];
        const rom = this.romOffset(addr);
        return rom >= 0 ? this.rom[rom] : -1;
    }

    // Returns false where the cartridge doesn't respond
    write(addr: number, data: number): boolean {
        const sram = this.sramOffset(addr);
        if (sram < 0) return false;
        this.sram[sram] = data;
        return true;
    }

    private romOffset(addr: number): number {
        const bank = addr >> 16;
        const offset = addr & 0xFFFF;
        let romAddr: number;

        switch (this.header.mapMode) {
            case 'LoROM':
                // 32 KB of each bank's upper half. Banks $40-$7D and $C0-$FF mirror it in the lower half too
                if (offset < 0x8000 && (bank & 0x7F) < 0x40) return -1;
                romAddr = ((bank & 0x7F) << 15) | (offset & 0x7FFF);
                break;
            case 'HiROM':
                // Whole 64 KB banks at $40-$7D and $C0-$FF, and their upper halves in the others
                if (offset < 0x8000 && (bank & 0x7F) < 0x40) return -1;
                romAddr = ((bank & 0x3F) << 16) | offset;
                break;
            case 'ExHiROM':
                if (offset < 0x8000 && (bank & 0x7F) < 0x40) return -1;
                // Banks $C0-$FF (and $80-$BF) hold the first 4 MB, $40-$7D (and $00-$3F) the rest
                romAddr = ((bank & 0x80) ? 0 : 0x400000) | ((bank & 0x3F) << 16) | offset;
                break;
        }
        return mirror(romAddr, this.rom.length);
    }

    private sramOffset(addr: number): number {
        if (this.sram.length === 0) return -1;
        const bank = addr >> 16;
        const offset = addr & 0xFFFF;

        if (this.header.mapMode === 'LoROM') {
            // Banks $70-$7D and $F0-$FF, lower half
            const sramBank = (bank >= 0x70 && bank <= 0x7D) || bank >= 0xF0;
            if (!sramBank || offset >= 0x8000) return -1;
            return (((bank & 0x0F) << 15) | offset) % this.sram.length;
        }
        // HiROM: banks $20-$3F and $A0-$BF at $6000-$7FFF
        if ((bank & 0x7F) < 0x20 || (bank & 0x7F) >= 0x40 || offset < 0x6000 || offset >= 0x8000) return -1;
        return (((bank & 0x1F) << 13) | (offset - 0x6000)) % this.sram.length;
    }
}

export default SnesCartridge;

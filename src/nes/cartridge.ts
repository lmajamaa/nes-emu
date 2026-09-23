import iNESHeader from './iNESHeader';
import type Mapper from './mappers/mapper';
import Mapper_000 from './mappers/mapper_000';
import Mapper_001 from './mappers/mapper_001';
import Mapper_004 from './mappers/mapper_004';
import Mapper_009 from './mappers/mapper_009';
import { MIRROR, type Mirror } from './constants';

const headerSize = 16;
const prgBankSize = 16384;
const chrBankSize = 8192;

export interface ReadResult {
    data: number;
}

export const SUPPORTED_MAPPERS: readonly number[] = [0, 1, 4, 9];

class Cartridge {
    readonly mapperId: number;
    private readonly hardwiredMirror: Mirror;
    private readonly nPRGBanks: number = 0;
    private readonly nCHRBanks: number = 0;
    private readonly vPRGMemory: Uint8Array = new Uint8Array(0);
    private readonly vCHRMemory: Uint8Array = new Uint8Array(0);
    // Most boards have no PRG RAM at $6000-$7FFF, but emulators commonly provide it (test ROMs rely on it)
    private readonly prgRam = new Uint8Array(0x2000);
    private readonly pMapper: Mapper;

    constructor(data: ArrayBuffer | Uint8Array) {
        let index = 0;
        const byteArray = new Uint8Array(data);
        const header = new iNESHeader(byteArray.subarray(index, headerSize));
        if (byteArray.length < headerSize || header.nameDecoded !== 'NES\x1A') {
            throw new Error('Not an iNES ROM file');
        }
        index += headerSize;
        // Skip training data
        if (header.mapper1 & 0x04) {
            index += 512;
        }
        if (byteArray.length < index + header.prg_rom_chunks * prgBankSize + header.chr_rom_chunks * chrBankSize) {
            throw new Error('ROM file is truncated');
        }

        // Determine mapper ID
        const nMapperID = ((header.mapper2 >> 4) << 4) | (header.mapper1 >> 4);
        this.mapperId = nMapperID;
        this.hardwiredMirror = (header.mapper1 & 0x01) ? MIRROR.VERTICAL : MIRROR.HORIZONTAL;

        // Discover file format
        const nFileType: number = 1;

        if (nFileType === 0) {
            console.log('Not implemented yet');
        } else if (nFileType === 1) {
            this.nPRGBanks = header.prg_rom_chunks;
            this.vPRGMemory = byteArray.subarray(index, index + this.nPRGBanks * prgBankSize);
            index += this.vPRGMemory.length;

            this.nCHRBanks = header.chr_rom_chunks;
            // Without CHR ROM the board has 8KB of CHR RAM
            this.vCHRMemory = this.nCHRBanks === 0
                ? new Uint8Array(chrBankSize)
                : byteArray.subarray(index, index + this.nCHRBanks * chrBankSize);
            index += this.nCHRBanks * chrBankSize;
        } else if (nFileType === 2) {
            console.log('Not implemented yet');
        }

        // Load appropriate mapper
        switch (nMapperID) {
            case 0:
                this.pMapper = new Mapper_000(this.nPRGBanks, this.nCHRBanks);
                break;
            case 1:
                this.pMapper = new Mapper_001(this.nPRGBanks, this.nCHRBanks);
                break;
            case 4:
                this.pMapper = new Mapper_004(this.nPRGBanks, this.nCHRBanks);
                break;
            case 9:
                this.pMapper = new Mapper_009(this.nPRGBanks, this.nCHRBanks);
                break;
            default:
                console.log('Mapper not implemented yet', nMapperID);
                this.pMapper = new Mapper_000(this.nPRGBanks, this.nCHRBanks); // Fallback
                break;
        }
    }

    // Communication with main bus
    cpuRead(addr: number, object: ReadResult): boolean {
        if (addr >= 0x6000 && addr <= 0x7FFF) {
            object.data = this.prgRam[addr & 0x1FFF];
            return true;
        }
        const mapper_obj = { mapped_addr: 0 };
        if (this.pMapper.cpuMapRead(addr, mapper_obj)) {
            object.data = this.vPRGMemory[mapper_obj.mapped_addr];
            return true;
        }
        return false;
    }

    cpuWrite(addr: number, data: number): boolean {
        if (addr >= 0x6000 && addr <= 0x7FFF) {
            this.prgRam[addr & 0x1FFF] = data;
            return true;
        }
        return this.pMapper.cpuMapWrite(addr, data);
    }

    // Communication with PPU bus
    ppuRead(addr: number, object: ReadResult): boolean {
        const mapper_obj = { mapped_addr: 0 };
        if (this.pMapper.ppuMapRead(addr, mapper_obj)) {
            object.data = this.vCHRMemory[mapper_obj.mapped_addr];
            return true;
        }
        return false;
    }

    ppuWrite(addr: number, data: number): boolean {
        const mapper_obj = { mapped_addr: 0 };
        if (this.pMapper.ppuMapWrite(addr, mapper_obj)) {
            this.vCHRMemory[mapper_obj.mapped_addr] = data;
            return true;
        }
        return false;
    }

    get mirror(): Mirror {
        return this.pMapper.mirror() ?? this.hardwiredMirror;
    }

    ppuAddress(addr: number, time: number): void {
        this.pMapper.ppuAddress(addr, time);
    }

    get irq(): boolean {
        return this.pMapper.irq;
    }

    reset(): void {
        this.pMapper.reset();
    }
}

export default Cartridge;

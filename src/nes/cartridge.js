import iNESHeader from './iNESHeader';
import Mapper_000 from './mappers/mapper_000';

const headerSize = 16;
const prgBankSize = 16384;
const chrBankSize = 8192;

class Cartridge {
    constructor(data) {
        let index = 0;
        const byteArray = new Uint8Array(data);
        const header = new iNESHeader(byteArray.subarray(index, headerSize));
        //console.log('iNES header', header);
        index += headerSize;
        // Skip training data
        if (header.mapper1 & 0x04) {
            //console.log('Skipping trainer data');
            index += 512;
        }

        // Determine mapper ID
        const nMapperID = ((header.mapper2 >> 4) << 4) | (header.mapper1 >> 4);

        // Discover file format
        const nFileType = 1;

        if (nFileType === 0) {
            console.log('Not implemented yet');
        } else if (nFileType === 1) {
            this.nPRGBanks = header.prg_rom_chunks;
            this.vPRGMemory = Array(this.nPRGBanks * prgBankSize);
            this.vPRGMemory = byteArray.subarray(index, index + this.vPRGMemory.length)

            index += this.vPRGMemory.length;

            this.nCHRBanks = header.chr_rom_chunks;
            this.vCHRMemory = Array(this.nCHRBanks * chrBankSize);
            this.vCHRMemory = byteArray.subarray(index, index + this.vCHRMemory.length)

            index += this.vCHRMemory.length;

        } else if (nFileType === 2) {
            console.log('Not implemented yet');
        }

        // Load appropriate mapper
        switch (nMapperID) {
            case 0:
                this.pMapper = new Mapper_000(this.nPRGBanks, this.nCHRBanks);
                break;
            default:
                console.log('Mapper not implemented yet', nMapperID);
                break;
        }
    }
    // Communication with main bus
    cpuRead(addr, object) {
        let mapped_addr = 0;
        let mapper_obj = { mapped_addr };
        if(this.pMapper.cpuMapRead(addr, mapper_obj)) {
            mapped_addr = mapper_obj.mapped_addr;
            object.data = this.vPRGMemory[mapped_addr];
            return true;
        } else {
            return false;
        }
        
    }
    cpuWrite(addr, data) {
        let mapped_addr = 0;
        let mapper_obj = { mapped_addr };
        if(this.pMapper.cpuMapWrite(addr, mapper_obj)) {
            mapped_addr = mapper_obj.mapped_addr;
            this.vPRGMemory[mapped_addr] = data;
            return true;
        } else {
            return false;
        }
    }
    // Communication with PPU bus
    ppuRead(addr, data) {
        let mapped_addr = 0;
        let mapper_obj = { mapped_addr };
        if(this.pMapper.ppuMapWrite(addr, mapper_obj)) {
            mapped_addr = mapper_obj.mapped_addr;
            data = this.vCHRMemory[mapped_addr];
            return true;
        } else {
            return false;
        }
    }
    ppuWrite(addr, data) {
        let mapped_addr = 0;
        let mapper_obj = { mapped_addr };
        if(this.pMapper.ppuMapWrite(addr, mapper_obj)) {
            mapped_addr = mapper_obj.mapped_addr;
            this.vCHRMemory[mapped_addr] = data;
            return true;
        } else {
            return false;
        }
    }
}

export default Cartridge;
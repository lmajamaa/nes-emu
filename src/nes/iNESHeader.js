class iNESHeader {
    constructor(byteArray) {
        this.name = byteArray.subarray(0, 4);
        this.prg_rom_chunks = byteArray[4];
        this.chr_rom_chunks = byteArray[5];
        this.mapper1 = byteArray[6];
        this.mapper2 = byteArray[7];
        this.prg_ram_size = byteArray[8];
        this.tv_system1 = byteArray[9];
        this.tv_system1 = byteArray[10];
        this.unused = byteArray.subarray(11, 15);
        this.nameDecoded = String.fromCharCode.apply(null, this.name);
    }
}

export default iNESHeader;
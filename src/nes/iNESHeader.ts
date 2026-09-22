class iNESHeader {
    readonly name: Uint8Array;
    readonly prg_rom_chunks: number;
    readonly chr_rom_chunks: number;
    readonly mapper1: number;
    readonly mapper2: number;
    readonly prg_ram_size: number;
    readonly tv_system1: number;
    readonly tv_system2: number;
    readonly unused: Uint8Array;
    readonly nameDecoded: string;

    constructor(byteArray: Uint8Array) {
        this.name = byteArray.subarray(0, 4);
        this.prg_rom_chunks = byteArray[4];
        this.chr_rom_chunks = byteArray[5];
        this.mapper1 = byteArray[6];
        this.mapper2 = byteArray[7];
        this.prg_ram_size = byteArray[8];
        this.tv_system1 = byteArray[9];
        this.tv_system2 = byteArray[10];
        this.unused = byteArray.subarray(11, 15);
        this.nameDecoded = String.fromCharCode(...this.name);
    }
}

export default iNESHeader;

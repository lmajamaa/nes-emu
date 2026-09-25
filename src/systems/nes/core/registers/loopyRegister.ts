// See https://www.nesdev.org/wiki/PPU_scrolling
class LoopyRegister {
    coarseX = 0;
    coarseY = 0;
    nametableX = 0;
    nametableY = 0;
    fineY = 0;
    unused = 0;

    get reg(): number {
        return (this.coarseX & 0x1F)
            | ((this.coarseY & 0x1F) << 5)
            | ((this.nametableX & 1) << 10)
            | ((this.nametableY & 1) << 11)
            | ((this.fineY & 0x07) << 12)
            | ((this.unused & 1) << 15);
    }

    set reg(value: number) {
        this.coarseX = value & 0x1F;
        this.coarseY = (value >> 5) & 0x1F;
        this.nametableX = (value >> 10) & 1;
        this.nametableY = (value >> 11) & 1;
        this.fineY = (value >> 12) & 0x07;
        this.unused = (value >> 15) & 1;
    }
}

export default LoopyRegister;

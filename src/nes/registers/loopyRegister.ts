// See https://www.nesdev.org/wiki/PPU_scrolling
class LoopyRegister {
    coarse_x = 0;
    coarse_y = 0;
    nametable_x = 0;
    nametable_y = 0;
    fine_y = 0;
    unused = 0;

    get reg(): number {
        let value = 0;
        value = value | ((this.coarse_x & 0x1F) << 0);
        value = value | ((this.coarse_y & 0x1F) << 5);
        value = value | ((this.nametable_x & 1) << 10);
        value = value | ((this.nametable_y & 1) << 11);
        value = value | ((this.fine_y & 0x07) << 12);
        value = value | ((this.unused & 1) << 15);
        return value;
    }

    set reg(value: number) {
        this.coarse_x = (value >> 0) & 0x1F;
        this.coarse_y = (value >> 5) & 0x1F;
        this.nametable_x = (value >> 10) & 1;
        this.nametable_y = (value >> 11) & 1;
        this.fine_y = (value >> 12) & 0x07;
        this.unused = (value >> 15) & 1;
    }
}

export default LoopyRegister;

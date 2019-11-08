class StatusRegister {
    constructor() {
        this.unused = 0;
        this.sprite_overflow = 0;
        this.sprite_zero_hit = 0;
        this.vertical_blank = 0;
    }
     get reg() {
        let value = 0;
        value = value | (((this.unused >> 0) & 1) << 0);
        value = value | (((this.unused >> 1) & 1) << 1);
        value = value | (((this.unused >> 2) & 1) << 2);
        value = value | (((this.unused >> 3) & 1) << 3);
        value = value | (((this.unused >> 4) & 1) << 4);
        value = value | (this.sprite_overflow << 5);
        value = value | (this.sprite_zero_hit << 6);
        value = value | (this.vertical_blank << 7);
        return value;
    }

    set reg(value) {
        this.unused |= (((value >> 0) & 1) << 0);
        this.unused |= (((value >> 1) & 1) << 1);
        this.unused |= (((value >> 2) & 1) << 2);
        this.unused |= (((value >> 3) & 1) << 3);
        this.unused |= (((value >> 4) & 1) << 4);
        this.sprite_overflow = (value >> 5) & 1;
        this.sprite_zero_hit = (value >> 6) & 1;
        this.vertical_blank = (value >> 7) & 1;
    }
}

export default StatusRegister;
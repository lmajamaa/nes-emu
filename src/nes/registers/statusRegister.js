class StatusRegister {
    constructor() {
        this.unused = Array(5).fill(0);
        this.sprite_overflow = 0;
        this.sprite_zero_hit = 0;
        this.vertical_blank = 0;
    }
     get reg() {
        let value = 0;
        value = value | (this.unused[0] << 0);
        value = value | (this.unused[1] << 1);
        value = value | (this.unused[2] << 2);
        value = value | (this.unused[3] << 3);
        value = value | (this.unused[4] << 4);
        value = value | (this.sprite_overflow << 5);
        value = value | (this.sprite_zero_hit << 6);
        value = value | (this.vertical_blank << 7);
        return value;
    }

    set reg(value) {
        this.unused[0] = (value >> 0) & 1;
        this.unused[1] = (value >> 1) & 1;
        this.unused[2] = (value >> 2) & 1;
        this.unused[3] = (value >> 3) & 1;
        this.unused[4] = (value >> 4) & 1;
        this.sprite_overflow = (value >> 5) & 1;
        this.sprite_zero_hit = (value >> 6) & 1;
        this.vertical_blank = (value >> 7) & 1;
    }
}

export default StatusRegister;
class StatusRegister {
    unused = 0;
    sprite_overflow = 0;
    sprite_zero_hit = 0;
    vertical_blank = 0;

    get reg(): number {
        let value = 0;
        value = value | (this.unused & 0x1F);
        value = value | (this.sprite_overflow << 5);
        value = value | (this.sprite_zero_hit << 6);
        value = value | (this.vertical_blank << 7);
        return value;
    }

    set reg(value: number) {
        this.unused = value & 0x1F;
        this.sprite_overflow = (value >> 5) & 1;
        this.sprite_zero_hit = (value >> 6) & 1;
        this.vertical_blank = (value >> 7) & 1;
    }
}

export default StatusRegister;

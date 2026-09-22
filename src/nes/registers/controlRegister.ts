class ControlRegister {
    nametable_x = 0;
    nametable_y = 0;
    increment_mode = 0;
    pattern_sprite = 0;
    pattern_background = 0;
    sprite_mode = 0;
    slave_mode = 0;
    enable_nmi = 0;

    get reg(): number {
        let value = 0;
        value = value | (this.nametable_x << 0);
        value = value | (this.nametable_y << 1);
        value = value | (this.increment_mode << 2);
        value = value | (this.pattern_sprite << 3);
        value = value | (this.pattern_background << 4);
        value = value | (this.sprite_mode << 5);
        value = value | (this.slave_mode << 6);
        value = value | (this.enable_nmi << 7);
        return value;
    }

    set reg(value: number) {
        this.nametable_x = (value >> 0) & 1;
        this.nametable_y = (value >> 1) & 1;
        this.increment_mode = (value >> 2) & 1;
        this.pattern_sprite = (value >> 3) & 1;
        this.pattern_background = (value >> 4) & 1;
        this.sprite_mode = (value >> 5) & 1;
        this.slave_mode = (value >> 6) & 1;
        this.enable_nmi = (value >> 7) & 1;
    }
}

export default ControlRegister;

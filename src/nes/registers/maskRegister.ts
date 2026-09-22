class MaskRegister {
    greyscale = 0;
    render_background_left = 0;
    render_sprites_left = 0;
    render_background = 0;
    render_sprites = 0;
    enhance_red = 0;
    enhance_green = 0;
    enhance_blue = 0;

    get reg(): number {
        let value = 0;
        value = value | (this.greyscale << 0);
        value = value | (this.render_background_left << 1);
        value = value | (this.render_sprites_left << 2);
        value = value | (this.render_background << 3);
        value = value | (this.render_sprites << 4);
        value = value | (this.enhance_red << 5);
        value = value | (this.enhance_green << 6);
        value = value | (this.enhance_blue << 7);
        return value;
    }

    set reg(value: number) {
        this.greyscale = (value >> 0) & 1;
        this.render_background_left = (value >> 1) & 1;
        this.render_sprites_left = (value >> 2) & 1;
        this.render_background = (value >> 3) & 1;
        this.render_sprites = (value >> 4) & 1;
        this.enhance_red = (value >> 5) & 1;
        this.enhance_green = (value >> 6) & 1;
        this.enhance_blue = (value >> 7) & 1;
    }
}

export default MaskRegister;

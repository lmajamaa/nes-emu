class MaskRegister {
    greyscale = 0;
    renderBackgroundLeft = 0;
    renderSpritesLeft = 0;
    renderBackground = 0;
    renderSprites = 0;
    enhanceRed = 0;
    enhanceGreen = 0;
    enhanceBlue = 0;

    get reg(): number {
        return this.greyscale
            | (this.renderBackgroundLeft << 1)
            | (this.renderSpritesLeft << 2)
            | (this.renderBackground << 3)
            | (this.renderSprites << 4)
            | (this.enhanceRed << 5)
            | (this.enhanceGreen << 6)
            | (this.enhanceBlue << 7);
    }

    set reg(value: number) {
        this.greyscale = value & 1;
        this.renderBackgroundLeft = (value >> 1) & 1;
        this.renderSpritesLeft = (value >> 2) & 1;
        this.renderBackground = (value >> 3) & 1;
        this.renderSprites = (value >> 4) & 1;
        this.enhanceRed = (value >> 5) & 1;
        this.enhanceGreen = (value >> 6) & 1;
        this.enhanceBlue = (value >> 7) & 1;
    }
}

export default MaskRegister;

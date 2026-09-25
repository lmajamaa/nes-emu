class ControlRegister {
    nametableX = 0;
    nametableY = 0;
    incrementMode = 0;
    patternSprite = 0;
    patternBackground = 0;
    spriteMode = 0;
    slaveMode = 0;
    enableNmi = 0;

    get reg(): number {
        return this.nametableX
            | (this.nametableY << 1)
            | (this.incrementMode << 2)
            | (this.patternSprite << 3)
            | (this.patternBackground << 4)
            | (this.spriteMode << 5)
            | (this.slaveMode << 6)
            | (this.enableNmi << 7);
    }

    set reg(value: number) {
        this.nametableX = value & 1;
        this.nametableY = (value >> 1) & 1;
        this.incrementMode = (value >> 2) & 1;
        this.patternSprite = (value >> 3) & 1;
        this.patternBackground = (value >> 4) & 1;
        this.spriteMode = (value >> 5) & 1;
        this.slaveMode = (value >> 6) & 1;
        this.enableNmi = (value >> 7) & 1;
    }
}

export default ControlRegister;

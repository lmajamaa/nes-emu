class StatusRegister {
    unused = 0;
    spriteOverflow = 0;
    spriteZeroHit = 0;
    verticalBlank = 0;

    get reg(): number {
        return (this.unused & 0x1F)
            | (this.spriteOverflow << 5)
            | (this.spriteZeroHit << 6)
            | (this.verticalBlank << 7);
    }

    set reg(value: number) {
        this.unused = value & 0x1F;
        this.spriteOverflow = (value >> 5) & 1;
        this.spriteZeroHit = (value >> 6) & 1;
        this.verticalBlank = (value >> 7) & 1;
    }
}

export default StatusRegister;

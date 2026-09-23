// A standard SNES controller: a 16-bit shift register, B first. Button bits are in
// systems/snes/index.ts. The low 4 bits identify the device and read as 0.
class SnesController {
    buttons = 0;
    private shift = 0;

    latch(): void {
        this.shift = this.buttons & 0xFFF0;
    }

    // After all 16 bits, official controllers keep returning 1
    read(): number {
        const bit = (this.shift >> 15) & 1;
        this.shift = ((this.shift << 1) | 1) & 0xFFFF;
        return bit;
    }
}

export default SnesController;

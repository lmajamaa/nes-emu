class LoopyRegister {
    constructor() {
        this.coarse_x = Array(5).fill(0x00);
        this.coarse_y = Array(5).fill(0x00);
        this.nametable_x = 0;
        this.nametable_y = 0;
        this.fine_y = Array(3).fill(0x00);
        this.unused = 0;
    }

    get reg() {
        let value = 0;
        value = value | (this.coarse_x[0] << 0);
        value = value | (this.coarse_x[1] << 1);
        value = value | (this.coarse_x[2] << 2);
        value = value | (this.coarse_x[3] << 3);
        value = value | (this.coarse_x[4] << 4);

        value = value | (this.coarse_y[0] << 5);
        value = value | (this.coarse_y[1] << 6);
        value = value | (this.coarse_y[2] << 7);
        value = value | (this.coarse_y[3] << 8);
        value = value | (this.coarse_y[4] << 9);

        value = value | (this.nametable_x << 10);
        value = value | (this.nametable_y << 11);
        value = value | (this.fine_y[0] << 12);
        value = value | (this.fine_y[0] << 13);
        value = value | (this.fine_y[0] << 14);
        value = value | (this.unused << 15);
        return value;
    }

    set reg(value) {
        this.coarse_x[0] = (value >> 0) & 1;
        this.coarse_x[1] = (value >> 1) & 1;
        this.coarse_x[2] = (value >> 2) & 1;
        this.coarse_x[3] = (value >> 3) & 1;
        this.coarse_x[4] = (value >> 4) & 1;

        this.coarse_y[0] = (value >> 5) & 1;
        this.coarse_y[1] = (value >> 6) & 1;
        this.coarse_y[2] = (value >> 7) & 1;
        this.coarse_y[3] = (value >> 8) & 1;
        this.coarse_y[4] = (value >> 9) & 1;


        this.nametable_x = (value >> 10) & 1;
        this.nametable_y = (value >> 11) & 1;
        this.fine_y[0] = (value >> 12) & 1;
        this.fine_y[1] = (value >> 13) & 1;
        this.fine_y[2] = (value >> 14) & 1;
        this.unused = (value >> 15) & 1;
    }
}

export default LoopyRegister;

import { hex, binary } from "../../utilities";

class LoopyRegister {
    constructor() {
        this.coarse_x = 0;
        this.coarse_y = 0;
        this.nametable_x = 0;
        this.nametable_y = 0;
        this.fine_y = 0;
        this.unused = 0;
    }

    get reg() {
        let value = 0;
        value = value | (((this.coarse_x >> 0) & 1) << 0);
        value = value | (((this.coarse_x >> 1) & 1) << 1);
        value = value | (((this.coarse_x >> 2) & 1) << 2);
        value = value | (((this.coarse_x >> 3) & 1) << 3);
        value = value | (((this.coarse_x >> 4) & 1) << 4);

        value = value | (((this.coarse_y >> 0) & 1) << 5);
        value = value | (((this.coarse_y >> 1) & 1) << 6);
        value = value | (((this.coarse_y >> 2) & 1) << 7);
        value = value | (((this.coarse_y >> 3) & 1) << 8);
        value = value | (((this.coarse_y >> 4) & 1) << 9);

        value = value | (this.nametable_x << 10);
        value = value | (this.nametable_y << 11);
        value = value | (((this.fine_y >> 0) & 1) << 12);
        value = value | (((this.fine_y >> 1) & 1) << 13);
        value = value | (((this.fine_y >> 2) & 1) << 14);
        value = value | (this.unused << 15);
        return value;
    }
    set reg(value) {
        this.coarse_x |= (((value >> 0) & 1) << 0);
        this.coarse_x |= (((value >> 1) & 1) << 1);
        this.coarse_x |= (((value >> 2) & 1) << 2);
        this.coarse_x |= (((value >> 3) & 1) << 3);
        this.coarse_x |= (((value >> 4) & 1) << 4);

        this.coarse_y |= (((value >> 5) & 1) << 0);
        this.coarse_y |= (((value >> 6) & 1) << 1);
        this.coarse_y |= (((value >> 7) & 1) << 2);
        this.coarse_y |= (((value >> 8) & 1) << 3);
        this.coarse_y |= (((value >> 9) & 1) << 4);

        this.nametable_x = (value >> 10) & 1;
        this.nametable_y = (value >> 11) & 1;
        this.fine_y |= (((value >> 12) & 1) << 0);
        this.fine_y |= (((value >> 13) & 1) << 1);
        this.fine_y |= (((value >> 14) & 1) << 2);
        this.unused = (value >> 15) & 1;
    }
}

export default LoopyRegister;

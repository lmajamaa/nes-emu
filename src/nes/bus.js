import Cpu from "./cpu";

class Bus {
    constructor() {
        this.cpu = new Cpu(this);
        this.ram = Array(64 * 1024).fill(0x00);
    }


    write(addr, data) {
        if(addr >= 0x0000 && addr <= 0xFFFF)
            this.ram[addr] = data;
    }

    read(addr, bReadOnly = false) {
        if(addr >= 0x0000 && addr <= 0xFFFF) {
            return this.ram[addr];
        } else {
            return 0x00;
        }
    }
}

export default Bus;
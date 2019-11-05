import Cpu from "./cpu";
import Ppu from "./ppu";

class Bus {
    constructor() {
        this.cpu = new Cpu(this);
        this.ppu = new Ppu(this);
        this.cpuRam = Array(2048).fill(0x00);
        this.cartridge = null;

        this.nSystemClockCounter = 0; // Home any clocks have passed;
    }

    insertCartridge(cartridge) {
        this.cartridge = cartridge;
        this.ppu.connectCartridge(cartridge);
        //console.log(cartridge);
    }

    reset() {
        this.cpu.reset();
        this.nSystemClockCounter = 0;
    }

    clock() {
        // Clocking. The heart and soul of an emulator. The running
        // frequency is controlled by whatever calls this function.
        // So here we "divide" the clock as necessary and call
        // the peripheral devices clock() function at the correct
        // times.

        // The fastest clock frequency the digital system cares
        // about is equivalent to the PPU clock. So the PPU is clocked
        // each time this function is called.
        this.ppu.clock();

        // The CPU runs 3 times slower than the PPU so we only call its
        // clock() function every 3 times this function is called. We
        // have a global counter to keep track of this.
        if (this.nSystemClockCounter % 3 === 0) {
            this.cpu.clock();
        }

        this.nSystemClockCounter++;
    }

    cpuRead(addr, bReadOnly = false) {
        let data = 0x00;
        const object = { data };
        if (this.cartridge.cpuRead(addr, object)) {
            // Cartridge address range
            data = object.data;
        } else if (addr >= 0x0000 && addr <= 0x1FFF) {
            data = this.cpuRam[addr & 0x07FF];
        } else if (addr >= 0x2000 && addr <= 0x3FFF) {
            data = this.ppu.cpuRead(addr & 0x0007, bReadOnly);
        }
        return data;
    }
    cpuWrite(addr, data) {

        if (this.cartridge.cpuWrite(addr, data)) {
            // Cartridge address range
        } else if (addr >= 0x0000 && addr <= 0x1FFF) {
            this.cpuRam[addr & 0x07FF] = data;
        } else if (addr >= 0x2000 && addr <= 0x3FFF) {
            this.ppu.cpuWrite(addr & 0x0007, data);
        }
    }
}

export default Bus;
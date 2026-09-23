// The 5A22's 8 DMA channels ($420B, $420C, $43x0-$43xF). General DMA copies a block between the
// A-bus (the CPU's address space) and the B-bus ($21xx) while the CPU waits. HDMA copies a few
// bytes per scanline from a table, for effects that change registers down the screen.

export interface DmaBus {
    readA(addr: number): number;
    writeA(addr: number, data: number): void;
    // $21xx, by the low byte
    readB(addr: number): number;
    writeB(addr: number, data: number): void;
    // Master cycles the transfer took
    tick(cycles: number): void;
}

// B-bus address offsets written per unit, by transfer mode
const TRANSFER_OFFSETS = [
    [0],
    [0, 1],
    [0, 0],
    [0, 0, 1, 1],
    [0, 1, 2, 3],
    [0, 1, 0, 1],
    [0, 0],
    [0, 0, 1, 1],
];

const DMA_START_CYCLES = 8;
const CHANNEL_CYCLES = 8;
const BYTE_CYCLES = 8;
const HDMA_START_CYCLES = 18;

class DmaChannel {
    // DMAPx
    control = 0xFF;
    // BBADx
    bAddress = 0xFF;
    // A1TxL/H, A1Bx
    aAddress = 0xFFFF;
    aBank = 0xFF;
    // DASxL/H: the byte count, or the indirect HDMA address
    count = 0xFFFF;
    // DASBx
    indirectBank = 0xFF;
    // A2AxL/H: HDMA's position in its table
    tableAddress = 0xFFFF;
    // NTRLx
    lineCounter = 0xFF;
    // $43xB and $43xF
    unused = 0xFF;

    hdmaCompleted = true;
    hdmaDoTransfer = false;

    get toA(): boolean {
        return (this.control & 0x80) !== 0;
    }

    get indirect(): boolean {
        return (this.control & 0x40) !== 0;
    }

    get offsets(): number[] {
        return TRANSFER_OFFSETS[this.control & 0x07];
    }
}

// The A-bus side of DMA can't reach the B-bus or the DMA registers themselves
function validA(addr: number): boolean {
    if (addr & 0x400000) return true;
    const offset = addr & 0xFFFF;
    if ((offset & 0xFF00) === 0x2100) return false;
    if (offset >= 0x4300 && offset < 0x4380) return false;
    return offset !== 0x420B && offset !== 0x420C;
}

class Dma {
    readonly channels = Array.from({ length: 8 }, () => new DmaChannel());
    // HDMAEN
    hdmaEnable = 0;

    constructor(private readonly bus: DmaBus) {}

    reset(): void {
        this.hdmaEnable = 0;
        for (const channel of this.channels) {
            channel.hdmaCompleted = true;
            channel.hdmaDoTransfer = false;
        }
    }

    // $43x0-$43xF
    readRegister(addr: number): number {
        const channel = this.channels[(addr >> 4) & 7];
        switch (addr & 0xF) {
            case 0x0: return channel.control;
            case 0x1: return channel.bAddress;
            case 0x2: return channel.aAddress & 0xFF;
            case 0x3: return channel.aAddress >> 8;
            case 0x4: return channel.aBank;
            case 0x5: return channel.count & 0xFF;
            case 0x6: return channel.count >> 8;
            case 0x7: return channel.indirectBank;
            case 0x8: return channel.tableAddress & 0xFF;
            case 0x9: return channel.tableAddress >> 8;
            case 0xA: return channel.lineCounter;
            case 0xB: case 0xF: return channel.unused;
            default: return -1;
        }
    }

    writeRegister(addr: number, data: number): void {
        const channel = this.channels[(addr >> 4) & 7];
        switch (addr & 0xF) {
            case 0x0: channel.control = data; break;
            case 0x1: channel.bAddress = data; break;
            case 0x2: channel.aAddress = (channel.aAddress & 0xFF00) | data; break;
            case 0x3: channel.aAddress = (channel.aAddress & 0x00FF) | (data << 8); break;
            case 0x4: channel.aBank = data; break;
            case 0x5: channel.count = (channel.count & 0xFF00) | data; break;
            case 0x6: channel.count = (channel.count & 0x00FF) | (data << 8); break;
            case 0x7: channel.indirectBank = data; break;
            case 0x8: channel.tableAddress = (channel.tableAddress & 0xFF00) | data; break;
            case 0x9: channel.tableAddress = (channel.tableAddress & 0x00FF) | (data << 8); break;
            case 0xA: channel.lineCounter = data; break;
            case 0xB: case 0xF: channel.unused = data; break;
        }
    }

    // MDMAEN: runs the enabled channels in order, the CPU waits until they are done
    start(enable: number): void {
        if (enable === 0) return;
        this.bus.tick(DMA_START_CYCLES);
        for (let i = 0; i < 8; i++) {
            if (enable & (1 << i)) this.transfer(this.channels[i]);
        }
    }

    private transfer(channel: DmaChannel): void {
        this.bus.tick(CHANNEL_CYCLES);
        const offsets = channel.offsets;
        const step = channel.control & 0x08 ? 0 : channel.control & 0x10 ? -1 : 1;
        let unit = 0;
        // A count of 0 transfers 64 KB
        do {
            const aAddr = (channel.aBank << 16) | channel.aAddress;
            this.copy(channel, aAddr, (channel.bAddress + offsets[unit]) & 0xFF);
            this.bus.tick(BYTE_CYCLES);
            unit = (unit + 1) % offsets.length;
            // The address wraps within its bank
            channel.aAddress = (channel.aAddress + step) & 0xFFFF;
            channel.count = (channel.count - 1) & 0xFFFF;
        } while (channel.count !== 0);
    }

    private copy(channel: DmaChannel, aAddr: number, bAddr: number): void {
        const valid = validA(aAddr);
        if (channel.toA) {
            const data = this.bus.readB(bAddr);
            if (valid) this.bus.writeA(aAddr, data);
        } else {
            this.bus.writeB(bAddr, valid ? this.bus.readA(aAddr) : 0x00);
        }
    }

    // At the start of each frame: every enabled channel starts over at its table
    hdmaInit(): void {
        let cycles = 0;
        for (let i = 0; i < 8; i++) {
            const channel = this.channels[i];
            channel.hdmaDoTransfer = true;
            if (!(this.hdmaEnable & (1 << i))) {
                channel.hdmaCompleted = true;
                continue;
            }
            channel.hdmaCompleted = false;
            channel.tableAddress = channel.aAddress;
            cycles += CHANNEL_CYCLES + this.loadEntry(channel);
        }
        if (cycles > 0) this.bus.tick(HDMA_START_CYCLES + cycles);
    }

    // Once per visible line, during hblank
    hdmaRun(): void {
        let cycles = 0;
        for (let i = 0; i < 8; i++) {
            const channel = this.channels[i];
            if (!(this.hdmaEnable & (1 << i)) || channel.hdmaCompleted) continue;
            cycles += CHANNEL_CYCLES;
            if (!channel.hdmaDoTransfer) continue;

            for (const offset of channel.offsets) {
                let aAddr: number;
                if (channel.indirect) {
                    aAddr = (channel.indirectBank << 16) | channel.count;
                    channel.count = (channel.count + 1) & 0xFFFF;
                } else {
                    aAddr = (channel.aBank << 16) | channel.tableAddress;
                    channel.tableAddress = (channel.tableAddress + 1) & 0xFFFF;
                }
                this.copy(channel, aAddr, (channel.bAddress + offset) & 0xFF);
                cycles += BYTE_CYCLES;
            }
        }

        for (let i = 0; i < 8; i++) {
            const channel = this.channels[i];
            if (!(this.hdmaEnable & (1 << i)) || channel.hdmaCompleted) continue;
            channel.lineCounter = (channel.lineCounter - 1) & 0xFF;
            // Repeat mode transfers every line, otherwise only the first one
            channel.hdmaDoTransfer = (channel.lineCounter & 0x80) !== 0;
            if ((channel.lineCounter & 0x7F) === 0) cycles += this.loadEntry(channel);
        }
        if (cycles > 0) this.bus.tick(HDMA_START_CYCLES + cycles);
    }

    // Reads the next table entry: a line count, and for indirect HDMA the data's address.
    // Returns the master cycles it took.
    private loadEntry(channel: DmaChannel): number {
        channel.lineCounter = this.readTable(channel);
        channel.hdmaCompleted = channel.lineCounter === 0;
        channel.hdmaDoTransfer = !channel.hdmaCompleted;
        if (!channel.indirect) return BYTE_CYCLES;
        const lo = this.readTable(channel);
        channel.count = lo | (this.readTable(channel) << 8);
        return BYTE_CYCLES * 3;
    }

    private readTable(channel: DmaChannel): number {
        const data = this.bus.readA((channel.aBank << 16) | channel.tableAddress);
        channel.tableAddress = (channel.tableAddress + 1) & 0xFFFF;
        return data;
    }
}

export default Dma;

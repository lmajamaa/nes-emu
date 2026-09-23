// The 5A22's own I/O around the 65816: the H/V counters that pace the frame, NMI and H/V IRQ,
// the multiply and divide units, and reading the controllers ($4016-$4017, $4200-$421F).

import SnesController from './controller';

export const MASTER_CLOCK_NTSC = 21_477_272;
export const CYCLES_PER_LINE = 1364;
export const LINES_PER_FRAME = 262;
const VBLANK_LINE = 225;
const VBLANK_LINE_OVERSCAN = 240;
// Once per line the CPU is paused while the work RAM refreshes
const REFRESH_START = 538;
const REFRESH_CYCLES = 40;
const HBLANK_START = 274 * 4;
const HBLANK_END = 1 * 4;
const HDMA_START = 276 * 4;
const AUTO_JOYPAD_CYCLES = 4224;
const CPU_VERSION = 0x02;

class CpuIo {
    // Position in the frame: master cycles into the line, and line
    h = 0;
    v = 0;
    frame = 0;
    // Set when vblank starts, for the emulation loop
    frameComplete = false;
    // 239 lines of picture instead of 224, set by the PPU
    overscan = false;

    readonly controllers = [new SnesController(), new SnesController()];

    // Edge for the CPU to take an NMI, and the level of its IRQ line
    nmiPending = false;
    irqLine = false;
    // HDMA to set up for the frame, or to run for the line, for the bus to handle
    hdmaInitPending = false;
    hdmaRunPending = false;

    // NMITIMEN
    private nmiEnable = false;
    private hIrqEnable = false;
    private vIrqEnable = false;
    private autoJoypad = false;
    private htime = 0x1FF;
    private vtime = 0x1FF;
    // RDNMI
    private nmiFlag = false;

    wrio = 0xFF;
    private multiplicand = 0xFF;
    private dividend = 0xFFFF;
    private quotient = 0;
    private product = 0;
    // Master cycles in which $4218-$421F are still being filled
    private joypadBusy = 0;
    private readonly joypads = [0, 0, 0, 0];
    private joypadLatch = 0;

    // Memory speed of banks $80-$FF, 6 master cycles with FastROM or 8
    romSpeed = 8;

    reset(): void {
        this.h = 0;
        this.v = 0;
        this.frameComplete = false;
        this.nmiPending = false;
        this.irqLine = false;
        // The counters start at the top of a frame
        this.hdmaInitPending = true;
        this.hdmaRunPending = false;
        this.nmiEnable = false;
        this.hIrqEnable = false;
        this.vIrqEnable = false;
        this.autoJoypad = false;
        this.htime = 0x1FF;
        this.vtime = 0x1FF;
        this.nmiFlag = false;
        this.wrio = 0xFF;
        this.joypadBusy = 0;
        this.romSpeed = 8;
    }

    get vblank(): boolean {
        return this.v >= (this.overscan ? VBLANK_LINE_OVERSCAN : VBLANK_LINE);
    }

    get hblank(): boolean {
        return this.h >= HBLANK_START || this.h < HBLANK_END;
    }

    // Moves the clock on by a CPU access or internal cycle. Returns the master cycles that
    // passed, which includes the work RAM refresh when the access runs into it.
    advance(cycles: number): number {
        const before = this.h;
        this.h += cycles;
        if (this.joypadBusy > 0) this.joypadBusy -= cycles;

        if (before < REFRESH_START && this.h >= REFRESH_START) {
            this.h += REFRESH_CYCLES;
            cycles += REFRESH_CYCLES;
            if (this.joypadBusy > 0) this.joypadBusy -= REFRESH_CYCLES;
        }

        if (this.h >= CYCLES_PER_LINE) {
            this.lineEvents(before, CYCLES_PER_LINE - 1);
            this.h -= CYCLES_PER_LINE;
            this.nextLine();
            this.lineEvents(-1, this.h);
        } else {
            this.lineEvents(before, this.h);
        }
        return cycles;
    }

    // Events at a point in the line, when the H counter moved from after `from` up to `to`
    private lineEvents(from: number, to: number): void {
        this.checkHIrq(from, to);
        if (from < HDMA_START && HDMA_START <= to && !this.vblank) this.hdmaRunPending = true;
    }

    // When the H counter moved from after `from` up to `to` in the current line
    private checkHIrq(from: number, to: number): void {
        if (!this.hIrqEnable) return;
        if (this.vIrqEnable && this.v !== this.vtime) return;
        const target = this.htime * 4;
        if (from < target && target <= to) this.raiseIrq();
    }

    private raiseIrq(): void {
        this.irqLine = true;
    }

    private nextLine(): void {
        this.v++;
        if (this.v === LINES_PER_FRAME) {
            this.v = 0;
            this.frame++;
            this.nmiFlag = false;
            this.hdmaInitPending = true;
        }

        if (this.v === (this.overscan ? VBLANK_LINE_OVERSCAN : VBLANK_LINE)) {
            this.nmiFlag = true;
            if (this.nmiEnable) this.nmiPending = true;
            this.frameComplete = true;
            if (this.autoJoypad) this.readJoypads();
        }

        if (this.vIrqEnable && !this.hIrqEnable && this.v === this.vtime) this.raiseIrq();
    }

    private readJoypads(): void {
        this.joypadBusy = AUTO_JOYPAD_CYCLES;
        for (let port = 0; port < 2; port++) {
            const controller = this.controllers[port];
            controller.latch();
            let value = 0;
            for (let bit = 0; bit < 16; bit++) value = (value << 1) | controller.read();
            this.joypads[port] = value;
        }
    }

    // $4016-$4017, the controllers' serial ports
    readJoypad(port: number, openBus: number): number {
        const bit = this.controllers[port].read();
        return port === 0 ? (openBus & 0xFC) | bit : (openBus & 0xE0) | 0x1C | bit;
    }

    writeJoypadLatch(data: number): void {
        this.joypadLatch = data & 1;
        if (this.joypadLatch) {
            for (const controller of this.controllers) controller.latch();
        }
    }

    // $4200-$421F
    read(addr: number, openBus: number): number {
        switch (addr) {
            case 0x4210: {
                const value = (this.nmiFlag ? 0x80 : 0) | (openBus & 0x70) | CPU_VERSION;
                this.nmiFlag = false;
                return value;
            }
            case 0x4211: {
                const value = (this.irqLine ? 0x80 : 0) | (openBus & 0x7F);
                this.irqLine = false;
                return value;
            }
            case 0x4212:
                return (this.vblank ? 0x80 : 0) | (this.hblank ? 0x40 : 0) | (openBus & 0x3E) | (this.joypadBusy > 0 ? 1 : 0);
            case 0x4213: return this.wrio;
            case 0x4214: return this.quotient & 0xFF;
            case 0x4215: return this.quotient >> 8;
            case 0x4216: return this.product & 0xFF;
            case 0x4217: return this.product >> 8;
            case 0x4218: case 0x421A: case 0x421C: case 0x421E:
                return this.joypads[(addr - 0x4218) >> 1] & 0xFF;
            case 0x4219: case 0x421B: case 0x421D: case 0x421F:
                return this.joypads[(addr - 0x4218) >> 1] >> 8;
            default:
                return openBus;
        }
    }

    write(addr: number, data: number): void {
        switch (addr) {
            case 0x4200: {
                const nmiWasEnabled = this.nmiEnable;
                this.nmiEnable = (data & 0x80) !== 0;
                this.vIrqEnable = (data & 0x20) !== 0;
                this.hIrqEnable = (data & 0x10) !== 0;
                this.autoJoypad = (data & 0x01) !== 0;
                // Enabling NMI during vblank, before RDNMI was read, triggers it straight away
                if (!nmiWasEnabled && this.nmiEnable && this.nmiFlag) this.nmiPending = true;
                if (!this.vIrqEnable && !this.hIrqEnable) this.irqLine = false;
                break;
            }
            case 0x4201: this.wrio = data; break;
            case 0x4202: this.multiplicand = data; break;
            case 0x4203:
                // The real unit takes 8 CPU cycles, the result is available straight away here
                this.product = this.multiplicand * data;
                this.quotient = (data << 8) | this.multiplicand;
                break;
            case 0x4204: this.dividend = (this.dividend & 0xFF00) | data; break;
            case 0x4205: this.dividend = (this.dividend & 0x00FF) | (data << 8); break;
            case 0x4206:
                // Takes 16 CPU cycles on the real unit
                if (data === 0) {
                    this.quotient = 0xFFFF;
                    this.product = this.dividend;
                } else {
                    this.quotient = Math.floor(this.dividend / data);
                    this.product = this.dividend % data;
                }
                break;
            case 0x4207: this.htime = (this.htime & 0x100) | data; break;
            case 0x4208: this.htime = (this.htime & 0x0FF) | ((data & 1) << 8); break;
            case 0x4209: this.vtime = (this.vtime & 0x100) | data; break;
            case 0x420A: this.vtime = (this.vtime & 0x0FF) | ((data & 1) << 8); break;
            case 0x420D: this.romSpeed = data & 1 ? 6 : 8; break;
        }
    }
}

export default CpuIo;

// WDC 65C816, the SNES CPU (in the 5A22). Cycle behaviour follows bsnes: every bus access and
// internal operation is one cycle, so instructions take as long as the work they do.

export interface Bus65816 {
    // 24-bit addresses
    read(addr: number): number;
    write(addr: number, data: number): void;
    // An internal operation, without a bus access
    idle(): void;
}

// Addressing modes of the instructions that read, write or modify memory
const IMM = 0;
const DP = 1;
const DPX = 2;
const DPY = 3;
const DPIND = 4;
const DPXIND = 5;
const DPINDY = 6;
const DPINDL = 7;
const DPINDLY = 8;
const ABS = 9;
const ABSX = 10;
const ABSY = 11;
const LONG = 12;
const LONGX = 13;
const SR = 14;
const SRINDY = 15;

// How the address of the second byte of 16-bit data is formed
const LINEAR = 0;
const BANK0 = 1;
const DIRECT = 2;

// The ALU instructions (ORA AND EOR ADC STA LDA CMP SBC) share their addressing modes by the
// low 5 bits of the opcode, and the operation by the top 3
const ALU_MODES: Record<number, number> = {
    0x01: DPXIND, 0x03: SR, 0x05: DP, 0x07: DPINDL, 0x09: IMM, 0x0D: ABS, 0x0F: LONG,
    0x11: DPINDY, 0x12: DPIND, 0x13: SRINDY, 0x15: DPX, 0x17: DPINDLY, 0x19: ABSY, 0x1D: ABSX, 0x1F: LONGX,
};
const ORA = 0, AND = 1, EOR = 2, ADC = 3, STA = 4, LDA = 5, CMP = 6, SBC = 7;

// Shifts, INC and DEC on memory, by the top 3 bits of the opcode
const ASL = 0, ROL = 1, LSR = 2, ROR = 3, DEC = 6, INC = 7;
const MODIFY_MODES: Record<number, number> = { 0x06: DP, 0x0E: ABS, 0x16: DPX, 0x1E: ABSX };

export const MNEMONICS = (
    'BRK ORA COP ORA TSB ORA ASL ORA PHP ORA ASL PHD TSB ORA ASL ORA ' +
    'BPL ORA ORA ORA TRB ORA ASL ORA CLC ORA INC TCS TRB ORA ASL ORA ' +
    'JSR AND JSL AND BIT AND ROL AND PLP AND ROL PLD BIT AND ROL AND ' +
    'BMI AND AND AND BIT AND ROL AND SEC AND DEC TSC BIT AND ROL AND ' +
    'RTI EOR WDM EOR MVP EOR LSR EOR PHA EOR LSR PHK JMP EOR LSR EOR ' +
    'BVC EOR EOR EOR MVN EOR LSR EOR CLI EOR PHY TCD JML EOR LSR EOR ' +
    'RTS ADC PER ADC STZ ADC ROR ADC PLA ADC ROR RTL JMP ADC ROR ADC ' +
    'BVS ADC ADC ADC STZ ADC ROR ADC SEI ADC PLY TDC JMP ADC ROR ADC ' +
    'BRA STA BRL STA STY STA STX STA DEY BIT TXA PHB STY STA STX STA ' +
    'BCC STA STA STA STY STA STX STA TYA STA TXS TXY STZ STA STZ STA ' +
    'LDY LDA LDX LDA LDY LDA LDX LDA TAY LDA TAX PLB LDY LDA LDX LDA ' +
    'BCS LDA LDA LDA LDY LDA LDX LDA CLV LDA TSX TYX LDY LDA LDX LDA ' +
    'CPY CMP REP CMP CPY CMP DEC CMP INY CMP DEX WAI CPY CMP DEC CMP ' +
    'BNE CMP CMP CMP PEI CMP DEC CMP CLD CMP PHX STP JML CMP DEC CMP ' +
    'CPX SBC SEP SBC CPX SBC INC SBC INX SBC NOP XBA CPX SBC INC SBC ' +
    'BEQ SBC SBC SBC PEA SBC INC SBC SED SBC PLX XCE JSR SBC INC SBC'
).split(' ');

const VECTOR_COP = { native: 0xFFE4, emulation: 0xFFF4 };
const VECTOR_BRK = { native: 0xFFE6, emulation: 0xFFFE };
const VECTOR_NMI = { native: 0xFFEA, emulation: 0xFFFA };
const VECTOR_IRQ = { native: 0xFFEE, emulation: 0xFFFE };
const VECTOR_RESET = 0xFFFC;

class Cpu65816 {
    private readonly bus: Bus65816;

    a = 0;
    x = 0;
    y = 0;
    s = 0x01FF;
    d = 0;
    pc = 0;
    pbr = 0;
    dbr = 0;
    // Emulation mode, where it behaves like a 6502
    e = true;

    // Flags
    n = false;
    v = false;
    // 8-bit accumulator and memory
    m = true;
    // 8-bit index registers, the break flag in emulation mode
    xf = true;
    dec = false;
    i = true;
    z = false;
    c = false;

    // Stopped by WAI until an interrupt, or by STP until reset
    waiting = false;
    stopped = false;

    // Total cycles run
    cycles = 0;

    // Effective address of the current instruction, and how its next byte is found
    private ea = 0;
    private eaKind = LINEAR;

    constructor(bus: Bus65816) {
        this.bus = bus;
    }

    getP(): number {
        return (this.n ? 0x80 : 0) | (this.v ? 0x40 : 0) | (this.m ? 0x20 : 0) | (this.xf ? 0x10 : 0) |
            (this.dec ? 0x08 : 0) | (this.i ? 0x04 : 0) | (this.z ? 0x02 : 0) | (this.c ? 0x01 : 0);
    }

    setP(p: number): void {
        this.n = (p & 0x80) !== 0;
        this.v = (p & 0x40) !== 0;
        this.m = (p & 0x20) !== 0;
        this.xf = (p & 0x10) !== 0;
        this.dec = (p & 0x08) !== 0;
        this.i = (p & 0x04) !== 0;
        this.z = (p & 0x02) !== 0;
        this.c = (p & 0x01) !== 0;
        this.fixModes();
    }

    reset(): void {
        this.e = true;
        this.d = 0;
        this.dbr = 0;
        this.pbr = 0;
        this.i = true;
        this.dec = false;
        this.fixModes();
        this.waiting = false;
        this.stopped = false;
        this.pc = this.read(VECTOR_RESET) | (this.read(VECTOR_RESET + 1) << 8);
    }

    nmi(): void {
        this.waiting = false;
        this.interrupt(VECTOR_NMI);
    }

    irq(): void {
        this.waiting = false;
        if (!this.i) this.interrupt(VECTOR_IRQ);
    }

    // Runs one instruction, returns the cycles it took
    step(): number {
        const start = this.cycles;
        if (this.waiting || this.stopped) {
            this.idle();
        } else {
            this.execute(this.fetch());
        }
        return this.cycles - start;
    }

    // Emulation mode forces 8-bit registers and keeps the stack in page 1
    private fixModes(): void {
        if (this.e) {
            this.m = true;
            this.xf = true;
            this.s = 0x0100 | (this.s & 0xFF);
        }
        if (this.xf) {
            this.x &= 0xFF;
            this.y &= 0xFF;
        }
    }

    // Bus access

    private read(addr: number): number {
        this.cycles++;
        return this.bus.read(addr & 0xFFFFFF);
    }

    private write(addr: number, data: number): void {
        this.cycles++;
        this.bus.write(addr & 0xFFFFFF, data);
    }

    private idle(): void {
        this.cycles++;
        this.bus.idle();
    }

    private fetch(): number {
        const data = this.read((this.pbr << 16) | this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        return data;
    }

    private fetch16(): number {
        const lo = this.fetch();
        return lo | (this.fetch() << 8);
    }

    // Emulation mode keeps the 6502's wrapping within the page when the direct page is page aligned
    private directAddress(offset: number): number {
        if (this.e && (this.d & 0xFF) === 0) return this.d | (offset & 0xFF);
        return (this.d + offset) & 0xFFFF;
    }

    // Used by the instructions the 6502 didn't have, which never wrap within the page
    private readDirectLong(offset: number): number {
        return this.read((this.d + offset) & 0xFFFF);
    }

    // An extra cycle when the direct page isn't page aligned
    private idleDirect(): void {
        if (this.d & 0xFF) this.idle();
    }

    // An extra cycle for indexing with 16-bit registers or across a page
    private idleIndexed(base: number, indexed: number): void {
        if (!this.xf || ((base ^ indexed) & 0xFF00)) this.idle();
    }

    private push(data: number): void {
        this.write(this.s, data);
        this.s = this.e ? 0x0100 | ((this.s - 1) & 0xFF) : (this.s - 1) & 0xFFFF;
    }

    private pull(): number {
        this.s = this.e ? 0x0100 | ((this.s + 1) & 0xFF) : (this.s + 1) & 0xFFFF;
        return this.read(this.s);
    }

    // The new instructions use the whole stack even in emulation mode, and only fix it afterwards
    private pushLong(data: number): void {
        this.write(this.s, data);
        this.s = (this.s - 1) & 0xFFFF;
    }

    private pullLong(): number {
        this.s = (this.s + 1) & 0xFFFF;
        return this.read(this.s);
    }

    private fixStack(): void {
        if (this.e) this.s = 0x0100 | (this.s & 0xFF);
    }

    // Addressing

    private linear(addr: number): void {
        this.ea = addr & 0xFFFFFF;
        this.eaKind = LINEAR;
    }

    private address(mode: number, write: boolean): void {
        switch (mode) {
            case DP:
            case DPX:
            case DPY: {
                const offset = this.fetch();
                this.idleDirect();
                if (mode !== DP) this.idle();
                this.ea = offset + (mode === DPX ? this.x : mode === DPY ? this.y : 0);
                this.eaKind = DIRECT;
                break;
            }
            case DPIND:
            case DPXIND:
            case DPINDY: {
                let offset = this.fetch();
                this.idleDirect();
                if (mode === DPXIND) {
                    this.idle();
                    offset += this.x;
                }
                const pointer = this.read(this.directAddress(offset)) | (this.read(this.directAddress(offset + 1)) << 8);
                if (mode === DPINDY) {
                    if (write) this.idle(); else this.idleIndexed(pointer, pointer + this.y);
                    this.linear((this.dbr << 16) + pointer + this.y);
                } else {
                    this.linear((this.dbr << 16) + pointer);
                }
                break;
            }
            case DPINDL:
            case DPINDLY: {
                const offset = this.fetch();
                this.idleDirect();
                const pointer = this.readDirectLong(offset) | (this.readDirectLong(offset + 1) << 8) |
                    (this.readDirectLong(offset + 2) << 16);
                this.linear(pointer + (mode === DPINDLY ? this.y : 0));
                break;
            }
            case ABS:
                this.linear((this.dbr << 16) + this.fetch16());
                break;
            case ABSX:
            case ABSY: {
                const base = this.fetch16();
                const indexed = base + (mode === ABSX ? this.x : this.y);
                if (write) this.idle(); else this.idleIndexed(base, indexed);
                this.linear((this.dbr << 16) + indexed);
                break;
            }
            case LONG:
            case LONGX: {
                const addr = this.fetch16() | (this.fetch() << 16);
                this.linear(addr + (mode === LONGX ? this.x : 0));
                break;
            }
            case SR: {
                const offset = this.fetch();
                this.idle();
                this.ea = (this.s + offset) & 0xFFFF;
                this.eaKind = BANK0;
                break;
            }
            case SRINDY: {
                const offset = this.fetch();
                this.idle();
                const pointer = this.read((this.s + offset) & 0xFFFF) | (this.read((this.s + offset + 1) & 0xFFFF) << 8);
                this.idle();
                this.linear((this.dbr << 16) + pointer + this.y);
                break;
            }
        }
    }

    private dataAddress(n: number): number {
        switch (this.eaKind) {
            case DIRECT: return this.directAddress(this.ea + n);
            case BANK0: return (this.ea + n) & 0xFFFF;
            default: return (this.ea + n) & 0xFFFFFF;
        }
    }

    private readData(wide: boolean): number {
        const lo = this.read(this.dataAddress(0));
        return wide ? lo | (this.read(this.dataAddress(1)) << 8) : lo;
    }

    private writeData(data: number, wide: boolean): void {
        this.write(this.dataAddress(0), data & 0xFF);
        if (wide) this.write(this.dataAddress(1), data >> 8);
    }

    private operand(mode: number, wide: boolean): number {
        if (mode === IMM) return wide ? this.fetch16() : this.fetch();
        this.address(mode, false);
        return this.readData(wide);
    }

    private store(mode: number, data: number, wide: boolean): void {
        this.address(mode, true);
        this.writeData(data, wide);
    }

    // Read, modify and write back, the high byte first
    private modify(mode: number, op: number): void {
        const wide = !this.m;
        this.address(mode, true);
        const data = this.alterate(op, this.readData(wide), wide);
        this.idle();
        if (wide) this.write(this.dataAddress(1), data >> 8);
        this.write(this.dataAddress(0), data & 0xFF);
    }

    // Operations

    private setNZ(value: number, wide: boolean): void {
        this.z = value === 0;
        this.n = (value & (wide ? 0x8000 : 0x80)) !== 0;
    }

    private setA(value: number, wide: boolean): void {
        this.a = wide ? value : (this.a & 0xFF00) | value;
        this.setNZ(value, wide);
    }

    private setX(value: number): void {
        this.x = value;
        this.setNZ(value, !this.xf);
    }

    private setY(value: number): void {
        this.y = value;
        this.setNZ(value, !this.xf);
    }

    private alu(op: number, data: number): void {
        const wide = !this.m;
        const a = wide ? this.a : this.a & 0xFF;
        switch (op) {
            case ORA: this.setA(a | data, wide); break;
            case AND: this.setA(a & data, wide); break;
            case EOR: this.setA(a ^ data, wide); break;
            case ADC: this.add(data, wide, false); break;
            case LDA: this.setA(data, wide); break;
            case CMP: this.compare(a, data, wide); break;
            case SBC: this.add(data, wide, true); break;
        }
    }

    // ADC and SBC, with the decimal mode behaviour of the 65816 for invalid BCD digits too
    private add(data: number, wide: boolean, subtract: boolean): void {
        const mask = wide ? 0xFFFF : 0xFF;
        const a = this.a & mask;
        if (subtract) data = ~data & mask;

        let result: number;
        if (!this.dec) {
            result = a + data + (this.c ? 1 : 0);
        } else {
            const digits = wide ? 4 : 2;
            let carry = this.c ? 1 : 0;
            result = 0;
            for (let digit = 0; ; digit++) {
                const shift = digit * 4;
                const nibble = 0xF << shift;
                result = (a & nibble) + (data & nibble) + (carry << shift) + (result & ((1 << shift) - 1));
                if (digit === digits - 1) break;
                if (subtract) {
                    if (result <= (0x10 << shift) - 1) result -= 0x6 << shift;
                } else if (result > (0xA << shift) - 1) {
                    result += 0x6 << shift;
                }
                carry = result > (0x10 << shift) - 1 ? 1 : 0;
            }
        }

        const sign = wide ? 0x8000 : 0x80;
        this.v = (~(a ^ data) & (a ^ result) & sign) !== 0;
        if (this.dec) {
            const shift = wide ? 12 : 4;
            if (subtract) {
                if (result <= mask) result -= 0x6 << shift;
            } else if (result > (0xA << shift) - 1) {
                result += 0x6 << shift;
            }
        }
        this.c = result > mask;
        this.setA(result & mask, wide);
    }

    private compare(register: number, data: number, wide: boolean): void {
        const result = register - data;
        this.c = result >= 0;
        this.setNZ(result & (wide ? 0xFFFF : 0xFF), wide);
    }

    private bit(data: number, immediate: boolean): void {
        const wide = !this.m;
        this.z = (this.a & data & (wide ? 0xFFFF : 0xFF)) === 0;
        if (immediate) return;
        this.n = (data & (wide ? 0x8000 : 0x80)) !== 0;
        this.v = (data & (wide ? 0x4000 : 0x40)) !== 0;
    }

    private alterate(op: number, data: number, wide: boolean): number {
        const mask = wide ? 0xFFFF : 0xFF;
        const sign = wide ? 0x8000 : 0x80;
        let result: number;
        switch (op) {
            case ASL:
                this.c = (data & sign) !== 0;
                result = (data << 1) & mask;
                break;
            case ROL:
                result = ((data << 1) | (this.c ? 1 : 0)) & mask;
                this.c = (data & sign) !== 0;
                break;
            case LSR:
                this.c = (data & 1) !== 0;
                result = data >> 1;
                break;
            case ROR:
                result = (data >> 1) | (this.c ? sign : 0);
                this.c = (data & 1) !== 0;
                break;
            case DEC:
                result = (data - 1) & mask;
                break;
            default:
                result = (data + 1) & mask;
                break;
        }
        this.setNZ(result, wide);
        return result;
    }

    private modifyA(op: number): void {
        this.idle();
        const wide = !this.m;
        const result = this.alterate(op, wide ? this.a : this.a & 0xFF, wide);
        this.a = wide ? result : (this.a & 0xFF00) | result;
    }

    // TSB and TRB
    private testBits(mode: number, set: boolean): void {
        const wide = !this.m;
        this.address(mode, true);
        const data = this.readData(wide);
        const a = wide ? this.a : this.a & 0xFF;
        this.z = (a & data) === 0;
        const result = set ? data | a : data & ~a;
        this.idle();
        if (wide) this.write(this.dataAddress(1), result >> 8);
        this.write(this.dataAddress(0), result & 0xFF);
    }

    private branch(take: boolean): void {
        const offset = this.fetch();
        if (!take) return;
        const target = (this.pc + ((offset << 24) >> 24)) & 0xFFFF;
        if (this.e && ((this.pc ^ target) & 0xFF00)) this.idle();
        this.idle();
        this.pc = target;
    }

    private interrupt(vector: { native: number; emulation: number }, software = false): void {
        if (software) {
            // The signature byte after BRK and COP
            this.fetch();
        } else {
            this.idle();
            this.idle();
        }
        if (!this.e) this.push(this.pbr);
        this.push(this.pc >> 8);
        this.push(this.pc & 0xFF);
        // The break flag is only set on the stack by BRK in emulation mode
        this.push(this.e && !software ? this.getP() & ~0x10 : this.getP());
        this.i = true;
        this.dec = false;
        this.pbr = 0;
        const addr = this.e ? vector.emulation : vector.native;
        this.pc = this.read(addr) | (this.read(addr + 1) << 8);
    }

    private blockMove(step: number): void {
        const destination = this.fetch();
        const source = this.fetch();
        this.dbr = destination;
        this.write((destination << 16) | this.y, this.read((source << 16) | this.x));
        this.idle();
        this.idle();
        const mask = this.xf ? 0xFF : 0xFFFF;
        this.x = (this.x + step) & mask;
        this.y = (this.y + step) & mask;
        this.a = (this.a - 1) & 0xFFFF;
        // Repeats itself until the count in A runs out
        if (this.a !== 0xFFFF) this.pc = (this.pc - 3) & 0xFFFF;
    }

    private pushRegister(value: number, wide: boolean): void {
        this.idle();
        if (wide) this.push(value >> 8);
        this.push(value & 0xFF);
    }

    private pullRegister(wide: boolean): number {
        this.idle();
        this.idle();
        const lo = this.pull();
        return wide ? lo | (this.pull() << 8) : lo;
    }

    private execute(opcode: number): void {
        const aluMode = ALU_MODES[opcode & 0x1F];
        if (aluMode !== undefined && opcode !== 0x89) {
            const op = opcode >> 5;
            if (op === STA) {
                this.store(aluMode, this.a, !this.m);
            } else {
                this.alu(op, this.operand(aluMode, !this.m));
            }
            return;
        }

        const modifyMode = MODIFY_MODES[opcode & 0x1F];
        const modifyOp = opcode >> 5;
        if (modifyMode !== undefined && modifyOp !== 4 && modifyOp !== 5) {
            this.modify(modifyMode, modifyOp);
            return;
        }

        const wideIndex = !this.xf;
        switch (opcode) {
            // Loads, stores and compares of the index registers
            case 0xA0: this.setY(this.operand(IMM, wideIndex)); break;
            case 0xA4: this.setY(this.operand(DP, wideIndex)); break;
            case 0xAC: this.setY(this.operand(ABS, wideIndex)); break;
            case 0xB4: this.setY(this.operand(DPX, wideIndex)); break;
            case 0xBC: this.setY(this.operand(ABSX, wideIndex)); break;
            case 0xA2: this.setX(this.operand(IMM, wideIndex)); break;
            case 0xA6: this.setX(this.operand(DP, wideIndex)); break;
            case 0xAE: this.setX(this.operand(ABS, wideIndex)); break;
            case 0xB6: this.setX(this.operand(DPY, wideIndex)); break;
            case 0xBE: this.setX(this.operand(ABSY, wideIndex)); break;
            case 0xC0: this.compare(this.y, this.operand(IMM, wideIndex), wideIndex); break;
            case 0xC4: this.compare(this.y, this.operand(DP, wideIndex), wideIndex); break;
            case 0xCC: this.compare(this.y, this.operand(ABS, wideIndex), wideIndex); break;
            case 0xE0: this.compare(this.x, this.operand(IMM, wideIndex), wideIndex); break;
            case 0xE4: this.compare(this.x, this.operand(DP, wideIndex), wideIndex); break;
            case 0xEC: this.compare(this.x, this.operand(ABS, wideIndex), wideIndex); break;
            case 0x84: this.store(DP, this.y, wideIndex); break;
            case 0x8C: this.store(ABS, this.y, wideIndex); break;
            case 0x94: this.store(DPX, this.y, wideIndex); break;
            case 0x86: this.store(DP, this.x, wideIndex); break;
            case 0x8E: this.store(ABS, this.x, wideIndex); break;
            case 0x96: this.store(DPY, this.x, wideIndex); break;

            case 0x64: this.store(DP, 0, !this.m); break;
            case 0x74: this.store(DPX, 0, !this.m); break;
            case 0x9C: this.store(ABS, 0, !this.m); break;
            case 0x9E: this.store(ABSX, 0, !this.m); break;

            case 0x24: this.bit(this.operand(DP, !this.m), false); break;
            case 0x2C: this.bit(this.operand(ABS, !this.m), false); break;
            case 0x34: this.bit(this.operand(DPX, !this.m), false); break;
            case 0x3C: this.bit(this.operand(ABSX, !this.m), false); break;
            case 0x89: this.bit(this.operand(IMM, !this.m), true); break;

            case 0x04: this.testBits(DP, true); break;
            case 0x0C: this.testBits(ABS, true); break;
            case 0x14: this.testBits(DP, false); break;
            case 0x1C: this.testBits(ABS, false); break;

            case 0x0A: this.modifyA(ASL); break;
            case 0x2A: this.modifyA(ROL); break;
            case 0x4A: this.modifyA(LSR); break;
            case 0x6A: this.modifyA(ROR); break;
            case 0x1A: this.modifyA(INC); break;
            case 0x3A: this.modifyA(DEC); break;

            case 0xE8: this.idle(); this.setX((this.x + 1) & (wideIndex ? 0xFFFF : 0xFF)); break;
            case 0xC8: this.idle(); this.setY((this.y + 1) & (wideIndex ? 0xFFFF : 0xFF)); break;
            case 0xCA: this.idle(); this.setX((this.x - 1) & (wideIndex ? 0xFFFF : 0xFF)); break;
            case 0x88: this.idle(); this.setY((this.y - 1) & (wideIndex ? 0xFFFF : 0xFF)); break;

            // Branches and jumps
            case 0x10: this.branch(!this.n); break;
            case 0x30: this.branch(this.n); break;
            case 0x50: this.branch(!this.v); break;
            case 0x70: this.branch(this.v); break;
            case 0x90: this.branch(!this.c); break;
            case 0xB0: this.branch(this.c); break;
            case 0xD0: this.branch(!this.z); break;
            case 0xF0: this.branch(this.z); break;
            case 0x80: this.branch(true); break;
            case 0x82: {
                const offset = this.fetch16();
                this.idle();
                this.pc = (this.pc + offset) & 0xFFFF;
                break;
            }
            case 0x4C:
                this.pc = this.fetch16();
                break;
            case 0x5C: {
                const addr = this.fetch16();
                this.pbr = this.fetch();
                this.pc = addr;
                break;
            }
            case 0x6C: {
                const pointer = this.fetch16();
                this.pc = this.read(pointer) | (this.read((pointer + 1) & 0xFFFF) << 8);
                break;
            }
            case 0x7C: {
                const pointer = this.fetch16();
                this.idle();
                this.pc = this.readProgramPointer((pointer + this.x) & 0xFFFF);
                break;
            }
            case 0xDC: {
                const pointer = this.fetch16();
                const addr = this.read(pointer) | (this.read((pointer + 1) & 0xFFFF) << 8);
                this.pbr = this.read((pointer + 2) & 0xFFFF);
                this.pc = addr;
                break;
            }
            case 0x20: {
                const addr = this.fetch16();
                this.idle();
                const ret = (this.pc - 1) & 0xFFFF;
                this.push(ret >> 8);
                this.push(ret & 0xFF);
                this.pc = addr;
                break;
            }
            case 0x22: {
                const addr = this.fetch16();
                this.pushLong(this.pbr);
                this.idle();
                const bank = this.fetch();
                const ret = (this.pc - 1) & 0xFFFF;
                this.pushLong(ret >> 8);
                this.pushLong(ret & 0xFF);
                this.pbr = bank;
                this.pc = addr;
                this.fixStack();
                break;
            }
            case 0xFC: {
                const lo = this.fetch();
                this.pushLong(this.pc >> 8);
                this.pushLong(this.pc & 0xFF);
                const pointer = lo | (this.fetch() << 8);
                this.idle();
                this.pc = this.readProgramPointer((pointer + this.x) & 0xFFFF);
                this.fixStack();
                break;
            }
            case 0x60: {
                this.idle();
                this.idle();
                const addr = this.pull() | (this.pull() << 8);
                this.idle();
                this.pc = (addr + 1) & 0xFFFF;
                break;
            }
            case 0x6B: {
                this.idle();
                this.idle();
                const addr = this.pullLong() | (this.pullLong() << 8);
                this.pbr = this.pullLong();
                this.pc = (addr + 1) & 0xFFFF;
                this.fixStack();
                break;
            }
            case 0x40: {
                this.idle();
                this.idle();
                this.setP(this.pull());
                const addr = this.pull() | (this.pull() << 8);
                if (!this.e) this.pbr = this.pull();
                this.pc = addr;
                break;
            }
            case 0x00: this.interrupt(VECTOR_BRK, true); break;
            case 0x02: this.interrupt(VECTOR_COP, true); break;

            // Stack
            case 0x48: this.pushRegister(this.a, !this.m); break;
            case 0xDA: this.pushRegister(this.x, wideIndex); break;
            case 0x5A: this.pushRegister(this.y, wideIndex); break;
            case 0x08: this.pushRegister(this.getP(), false); break;
            case 0x8B: this.pushRegister(this.dbr, false); break;
            case 0x4B: this.pushRegister(this.pbr, false); break;
            case 0x68: this.setA(this.pullRegister(!this.m), !this.m); break;
            case 0xFA: this.setX(this.pullRegister(wideIndex)); break;
            case 0x7A: this.setY(this.pullRegister(wideIndex)); break;
            case 0x28: this.setP(this.pullRegister(false)); break;
            case 0xAB:
                this.idle();
                this.idle();
                this.dbr = this.pullLong();
                this.setNZ(this.dbr, false);
                this.fixStack();
                break;
            case 0x0B:
                this.idle();
                this.pushLong(this.d >> 8);
                this.pushLong(this.d & 0xFF);
                this.fixStack();
                break;
            case 0x2B:
                this.idle();
                this.idle();
                this.d = this.pullLong() | (this.pullLong() << 8);
                this.setNZ(this.d, true);
                this.fixStack();
                break;
            case 0xF4:
                this.pushWord(this.fetch16());
                break;
            case 0xD4: {
                const offset = this.fetch();
                this.idleDirect();
                this.pushWord(this.readDirectLong(offset) | (this.readDirectLong(offset + 1) << 8));
                break;
            }
            case 0x62: {
                const offset = this.fetch16();
                this.idle();
                this.pushWord((this.pc + offset) & 0xFFFF);
                break;
            }

            // Transfers
            case 0xAA: this.idle(); this.setX(this.xf ? this.a & 0xFF : this.a); break;
            case 0xA8: this.idle(); this.setY(this.xf ? this.a & 0xFF : this.a); break;
            case 0x8A: this.idle(); this.setA(this.m ? this.x & 0xFF : this.x, !this.m); break;
            case 0x98: this.idle(); this.setA(this.m ? this.y & 0xFF : this.y, !this.m); break;
            case 0x9B: this.idle(); this.setY(this.x); break;
            case 0xBB: this.idle(); this.setX(this.y); break;
            case 0xBA: this.idle(); this.setX(this.xf ? this.s & 0xFF : this.s); break;
            case 0x9A:
                this.idle();
                this.s = this.e ? 0x0100 | (this.x & 0xFF) : this.x;
                break;
            case 0x1B:
                this.idle();
                this.s = this.e ? 0x0100 | (this.a & 0xFF) : this.a;
                break;
            case 0x3B: this.idle(); this.setA(this.s, true); break;
            case 0x5B: this.idle(); this.d = this.a; this.setNZ(this.d, true); break;
            case 0x7B: this.idle(); this.setA(this.d, true); break;
            case 0xEB:
                this.idle();
                this.idle();
                this.a = ((this.a & 0xFF) << 8) | (this.a >> 8);
                this.setNZ(this.a & 0xFF, false);
                break;

            // Flags and modes
            case 0x18: this.idle(); this.c = false; break;
            case 0x38: this.idle(); this.c = true; break;
            case 0x58: this.idle(); this.i = false; break;
            case 0x78: this.idle(); this.i = true; break;
            case 0xB8: this.idle(); this.v = false; break;
            case 0xD8: this.idle(); this.dec = false; break;
            case 0xF8: this.idle(); this.dec = true; break;
            case 0xC2: {
                const mask = this.fetch();
                this.idle();
                this.setP(this.getP() & ~mask);
                break;
            }
            case 0xE2: {
                const mask = this.fetch();
                this.idle();
                this.setP(this.getP() | mask);
                break;
            }
            case 0xFB: {
                this.idle();
                const carry = this.c;
                this.c = this.e;
                this.e = carry;
                this.fixModes();
                break;
            }

            case 0x54: this.blockMove(1); break;
            case 0x44: this.blockMove(-1); break;

            case 0xEA: this.idle(); break;
            case 0x42: this.fetch(); break;
            case 0xCB:
                this.idle();
                this.idle();
                this.waiting = true;
                break;
            case 0xDB:
                this.idle();
                this.idle();
                this.stopped = true;
                break;
        }
    }

    private readProgramPointer(pointer: number): number {
        const bank = this.pbr << 16;
        return this.read(bank | pointer) | (this.read(bank | ((pointer + 1) & 0xFFFF)) << 8);
    }

    private pushWord(value: number): void {
        this.pushLong(value >> 8);
        this.pushLong(value & 0xFF);
        this.fixStack();
    }
}

export default Cpu65816;

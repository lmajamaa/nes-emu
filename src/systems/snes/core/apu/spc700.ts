// Sony SPC700, the S-SMP CPU of the SNES sound system. Cycle behaviour follows bsnes: every
// bus access and internal operation is one cycle, so instructions take as long as the work
// they do.

export interface SpcBus {
    read(addr: number): number;
    write(addr: number, data: number): void;
    // An internal operation, without a bus access
    idle(): void;
}

// ALU operations of the OR/AND/EOR/CMP/ADC/SBC rows, by the opcode's high nibble / 2
const OR = 0, AND = 1, EOR = 2, CMP = 3, ADC = 4, SBC = 5, LD = 6;
// Read-modify-write operations of the ASL/ROL/LSR/ROR/DEC/INC rows
const ASL = 0, ROL = 1, LSR = 2, ROR = 3, DEC = 4, INC = 5;

class Spc700 {
    private readonly bus: SpcBus;

    a = 0;
    x = 0;
    y = 0;
    sp = 0xEF;
    pc = 0;

    // PSW
    n = false;
    v = false;
    // Direct page at $0100 instead of $0000
    p = false;
    b = false;
    h = false;
    i = false;
    z = false;
    c = false;

    // Halted by SLEEP or STOP until reset
    stopped = false;
    cycles = 0;

    constructor(bus: SpcBus) {
        this.bus = bus;
    }

    getPsw(): number {
        return (this.n ? 0x80 : 0) | (this.v ? 0x40 : 0) | (this.p ? 0x20 : 0) | (this.b ? 0x10 : 0) |
            (this.h ? 0x08 : 0) | (this.i ? 0x04 : 0) | (this.z ? 0x02 : 0) | (this.c ? 0x01 : 0);
    }

    setPsw(psw: number): void {
        this.n = (psw & 0x80) !== 0;
        this.v = (psw & 0x40) !== 0;
        this.p = (psw & 0x20) !== 0;
        this.b = (psw & 0x10) !== 0;
        this.h = (psw & 0x08) !== 0;
        this.i = (psw & 0x04) !== 0;
        this.z = (psw & 0x02) !== 0;
        this.c = (psw & 0x01) !== 0;
    }

    reset(): void {
        this.a = 0;
        this.x = 0;
        this.y = 0;
        this.sp = 0xEF;
        this.setPsw(0x02);
        this.stopped = false;
        this.pc = this.bus.read(0xFFFE) | (this.bus.read(0xFFFF) << 8);
    }

    // Runs one instruction, returns the cycles it took
    step(): number {
        const start = this.cycles;
        if (this.stopped) {
            this.idle();
            this.idle();
        } else {
            this.execute(this.fetch());
        }
        return this.cycles - start;
    }

    // Bus access

    private read(addr: number): number {
        this.cycles++;
        return this.bus.read(addr & 0xFFFF);
    }

    private write(addr: number, data: number): void {
        this.cycles++;
        this.bus.write(addr & 0xFFFF, data & 0xFF);
    }

    private idle(): void {
        this.cycles++;
        this.bus.idle();
    }

    private fetch(): number {
        const data = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        return data;
    }

    private fetch16(): number {
        const lo = this.fetch();
        return lo | (this.fetch() << 8);
    }

    // Direct page, wrapping within it
    private load(addr: number): number {
        return this.read((this.p ? 0x100 : 0) | (addr & 0xFF));
    }

    private store(addr: number, data: number): void {
        this.write((this.p ? 0x100 : 0) | (addr & 0xFF), data);
    }

    private push(data: number): void {
        this.write(0x100 | this.sp, data);
        this.sp = (this.sp - 1) & 0xFF;
    }

    private pull(): number {
        this.sp = (this.sp + 1) & 0xFF;
        return this.read(0x100 | this.sp);
    }

    private setNZ(value: number): void {
        this.z = (value & 0xFF) === 0;
        this.n = (value & 0x80) !== 0;
    }

    // ALU

    private alu(op: number, x: number, y: number): number {
        switch (op) {
            case OR: x |= y; break;
            case AND: x &= y; break;
            case EOR: x ^= y; break;
            case CMP: {
                const result = x - y;
                this.c = result >= 0;
                this.setNZ(result);
                return x;
            }
            case ADC: return this.adc(x, y);
            case SBC: return this.adc(x, ~y & 0xFF);
            case LD: x = y; break;
        }
        this.setNZ(x);
        return x;
    }

    private adc(x: number, y: number): number {
        const result = x + y + (this.c ? 1 : 0);
        this.c = result > 0xFF;
        this.h = ((x ^ y ^ result) & 0x10) !== 0;
        this.v = (~(x ^ y) & (x ^ result) & 0x80) !== 0;
        this.setNZ(result);
        return result & 0xFF;
    }

    private modifyOp(op: number, x: number): number {
        switch (op) {
            case ASL:
                this.c = (x & 0x80) !== 0;
                x = (x << 1) & 0xFF;
                break;
            case ROL: {
                const carry = this.c ? 1 : 0;
                this.c = (x & 0x80) !== 0;
                x = ((x << 1) | carry) & 0xFF;
                break;
            }
            case LSR:
                this.c = (x & 1) !== 0;
                x >>= 1;
                break;
            case ROR: {
                const carry = this.c ? 0x80 : 0;
                this.c = (x & 1) !== 0;
                x = carry | (x >> 1);
                break;
            }
            case DEC: x = (x - 1) & 0xFF; break;
            case INC: x = (x + 1) & 0xFF; break;
        }
        this.setNZ(x);
        return x;
    }

    private get ya(): number {
        return (this.y << 8) | this.a;
    }

    private set ya(value: number) {
        this.a = value & 0xFF;
        this.y = (value >> 8) & 0xFF;
    }

    // Instructions, named like bsnes's

    private directRead(op: number, target: 'a' | 'x' | 'y'): void {
        const address = this.fetch();
        this[target] = this.alu(op, this[target], this.load(address));
    }

    private absoluteRead(op: number, target: 'a' | 'x' | 'y'): void {
        const address = this.fetch16();
        this[target] = this.alu(op, this[target], this.read(address));
    }

    private immediateRead(op: number, target: 'a' | 'x' | 'y'): void {
        this[target] = this.alu(op, this[target], this.fetch());
    }

    private directIndexedRead(op: number, target: 'a' | 'x' | 'y', index: number): void {
        const address = this.fetch();
        this.idle();
        this[target] = this.alu(op, this[target], this.load(address + index));
    }

    private absoluteIndexedRead(op: number, index: number): void {
        const address = this.fetch16();
        this.idle();
        this.a = this.alu(op, this.a, this.read(address + index));
    }

    private indirectXRead(op: number): void {
        this.read(this.pc);
        this.a = this.alu(op, this.a, this.load(this.x));
    }

    private indexedIndirectRead(op: number): void {
        const indirect = this.fetch();
        this.idle();
        const address = this.load(indirect + this.x) | (this.load(indirect + this.x + 1) << 8);
        this.a = this.alu(op, this.a, this.read(address));
    }

    private indirectIndexedRead(op: number): void {
        const indirect = this.fetch();
        const address = this.load(indirect) | (this.load(indirect + 1) << 8);
        this.idle();
        this.a = this.alu(op, this.a, this.read(address + this.y));
    }

    private directDirect(op: number): void {
        const source = this.fetch();
        const rhs = this.load(source);
        const target = this.fetch();
        const lhs = this.load(target);
        const result = this.alu(op, lhs, rhs);
        if (op === CMP) this.idle(); else this.store(target, result);
    }

    private directImmediate(op: number): void {
        const immediate = this.fetch();
        const address = this.fetch();
        const result = this.alu(op, this.load(address), immediate);
        if (op === CMP) this.idle(); else this.store(address, result);
    }

    private indirectXIndirectY(op: number): void {
        this.read(this.pc);
        const rhs = this.load(this.y);
        const result = this.alu(op, this.load(this.x), rhs);
        if (op === CMP) this.idle(); else this.store(this.x, result);
    }

    private directModify(op: number): void {
        const address = this.fetch();
        this.store(address, this.modifyOp(op, this.load(address)));
    }

    private absoluteModify(op: number): void {
        const address = this.fetch16();
        this.write(address, this.modifyOp(op, this.read(address)));
    }

    private directIndexedModify(op: number): void {
        const address = this.fetch();
        this.idle();
        this.store(address + this.x, this.modifyOp(op, this.load(address + this.x)));
    }

    private impliedModify(op: number, target: 'a' | 'x' | 'y'): void {
        this.read(this.pc);
        this[target] = this.modifyOp(op, this[target]);
    }

    private directWrite(data: number): void {
        const address = this.fetch();
        this.load(address);
        this.store(address, data);
    }

    private absoluteWrite(data: number): void {
        const address = this.fetch16();
        this.read(address);
        this.write(address, data);
    }

    private directIndexedWrite(data: number, index: number): void {
        const address = this.fetch();
        this.idle();
        this.load(address + index);
        this.store(address + index, data);
    }

    private absoluteIndexedWrite(index: number): void {
        const address = this.fetch16();
        this.idle();
        this.read(address + index);
        this.write(address + index, this.a);
    }

    private indirectXWrite(): void {
        this.read(this.pc);
        this.load(this.x);
        this.store(this.x, this.a);
    }

    private indexedIndirectWrite(): void {
        const indirect = this.fetch();
        this.idle();
        const address = this.load(indirect + this.x) | (this.load(indirect + this.x + 1) << 8);
        this.read(address);
        this.write(address, this.a);
    }

    private indirectIndexedWrite(): void {
        const indirect = this.fetch();
        const address = this.load(indirect) | (this.load(indirect + 1) << 8);
        this.idle();
        this.read(address + this.y);
        this.write(address + this.y, this.a);
    }

    private directImmediateWrite(): void {
        const immediate = this.fetch();
        const address = this.fetch();
        this.load(address);
        this.store(address, immediate);
    }

    private directDirectWrite(): void {
        const source = this.fetch();
        const data = this.load(source);
        const target = this.fetch();
        this.store(target, data);
    }

    private transfer(from: 'a' | 'x' | 'y' | 'sp', to: 'a' | 'x' | 'y' | 'sp'): void {
        this.read(this.pc);
        this[to] = this[from];
        if (to !== 'sp') this.setNZ(this[to]);
    }

    private bitSet(bit: number, value: boolean): void {
        const address = this.fetch();
        const data = this.load(address);
        this.store(address, value ? data | (1 << bit) : data & ~(1 << bit));
    }

    private branch(take: boolean): void {
        const displacement = this.fetch();
        if (!take) return;
        this.idle();
        this.idle();
        this.pc = (this.pc + ((displacement << 24) >> 24)) & 0xFFFF;
    }

    private branchBit(bit: number, set: boolean): void {
        const address = this.fetch();
        const data = this.load(address);
        this.idle();
        this.branch(((data >> bit) & 1) === (set ? 1 : 0));
    }

    private absoluteBit(mode: number): void {
        const operand = this.fetch16();
        const bit = operand >> 13;
        const address = operand & 0x1FFF;
        let data = this.read(address);
        const set = ((data >> bit) & 1) === 1;
        switch (mode) {
            case 0: this.idle(); this.c ||= set; break;
            case 1: this.idle(); this.c ||= !set; break;
            case 2: this.c &&= set; break;
            case 3: this.c &&= !set; break;
            case 4: this.idle(); this.c = this.c !== set; break;
            case 5: this.c = set; break;
            case 6:
                this.idle();
                data = this.c ? data | (1 << bit) : data & ~(1 << bit);
                this.write(address, data);
                break;
            case 7:
                this.write(address, data ^ (1 << bit));
                break;
        }
    }

    private testSetBits(set: boolean): void {
        const address = this.fetch16();
        const data = this.read(address);
        this.setNZ(this.a - data);
        this.read(address);
        this.write(address, set ? data | this.a : data & ~this.a);
    }

    private directWord(kind: 'cmp' | 'add' | 'sub' | 'ld'): void {
        const address = this.fetch();
        let data = this.load(address);
        if (kind !== 'cmp') this.idle();
        data |= this.load(address + 1) << 8;
        const ya = this.ya;
        switch (kind) {
            case 'cmp': {
                const result = ya - data;
                this.c = result >= 0;
                this.z = (result & 0xFFFF) === 0;
                this.n = (result & 0x8000) !== 0;
                break;
            }
            case 'add': {
                this.c = false;
                const lo = this.adc(ya & 0xFF, data & 0xFF);
                const hi = this.adc(ya >> 8, data >> 8);
                this.ya = (hi << 8) | lo;
                this.z = this.ya === 0;
                break;
            }
            case 'sub': {
                this.c = true;
                const lo = this.adc(ya & 0xFF, ~data & 0xFF);
                const hi = this.adc(ya >> 8, (~data >> 8) & 0xFF);
                this.ya = (hi << 8) | lo;
                this.z = this.ya === 0;
                break;
            }
            case 'ld':
                this.ya = data;
                this.z = data === 0;
                this.n = (data & 0x8000) !== 0;
                break;
        }
    }

    private directModifyWord(adjust: number): void {
        const address = this.fetch();
        let data = this.load(address) + adjust;
        this.store(address, data & 0xFF);
        data += this.load(address + 1) << 8;
        this.store(address + 1, (data >> 8) & 0xFF);
        data &= 0xFFFF;
        this.z = data === 0;
        this.n = (data & 0x8000) !== 0;
    }

    private pushRegister(data: number): void {
        this.read(this.pc);
        this.push(data);
        this.idle();
    }

    private pullRegister(): number {
        this.read(this.pc);
        this.idle();
        return this.pull();
    }

    private callTable(vector: number): void {
        this.read(this.pc);
        this.idle();
        this.push(this.pc >> 8);
        this.push(this.pc & 0xFF);
        this.idle();
        const address = 0xFFDE - (vector << 1);
        this.pc = this.read(address) | (this.read(address + 1) << 8);
    }

    private execute(opcode: number): void {
        const hi = opcode >> 4;
        const lo = opcode & 0x0F;
        const odd = (hi & 1) === 1;

        // The regular part of the table
        if (lo === 0x01) return this.callTable(hi);
        if (lo === 0x02) return this.bitSet(hi >> 1, !odd);
        if (lo === 0x03) return this.branchBit(hi >> 1, !odd);
        if (hi <= 0xB && lo >= 0x04 && lo <= 0x09) {
            const op = hi >> 1;
            if (!odd) {
                switch (lo) {
                    case 0x4: return this.directRead(op, 'a');
                    case 0x5: return this.absoluteRead(op, 'a');
                    case 0x6: return this.indirectXRead(op);
                    case 0x7: return this.indexedIndirectRead(op);
                    case 0x8: return this.immediateRead(op, 'a');
                    case 0x9: return this.directDirect(op);
                }
            } else {
                switch (lo) {
                    case 0x4: return this.directIndexedRead(op, 'a', this.x);
                    case 0x5: return this.absoluteIndexedRead(op, this.x);
                    case 0x6: return this.absoluteIndexedRead(op, this.y);
                    case 0x7: return this.indirectIndexedRead(op);
                    case 0x8: return this.directImmediate(op);
                    case 0x9: return this.indirectXIndirectY(op);
                }
            }
        }
        if (hi <= 0xB && (lo === 0x0B || lo === 0x0C)) {
            const op = hi >> 1;
            if (!odd) return lo === 0x0B ? this.directModify(op) : this.absoluteModify(op);
            return lo === 0x0B ? this.directIndexedModify(op) : this.impliedModify(op, 'a');
        }

        switch (opcode) {
            case 0x00: this.read(this.pc); break;
            case 0x0A: this.absoluteBit(0); break;
            case 0x2A: this.absoluteBit(1); break;
            case 0x4A: this.absoluteBit(2); break;
            case 0x6A: this.absoluteBit(3); break;
            case 0x8A: this.absoluteBit(4); break;
            case 0xAA: this.absoluteBit(5); break;
            case 0xCA: this.absoluteBit(6); break;
            case 0xEA: this.absoluteBit(7); break;
            case 0x0E: this.testSetBits(true); break;
            case 0x4E: this.testSetBits(false); break;

            case 0x0D: this.pushRegister(this.getPsw()); break;
            case 0x2D: this.pushRegister(this.a); break;
            case 0x4D: this.pushRegister(this.x); break;
            case 0x6D: this.pushRegister(this.y); break;
            case 0x8E: this.setPsw(this.pullRegister()); break;
            case 0xAE: this.a = this.pullRegister(); break;
            case 0xCE: this.x = this.pullRegister(); break;
            case 0xEE: this.y = this.pullRegister(); break;

            case 0x10: this.branch(!this.n); break;
            case 0x30: this.branch(this.n); break;
            case 0x50: this.branch(!this.v); break;
            case 0x70: this.branch(this.v); break;
            case 0x90: this.branch(!this.c); break;
            case 0xB0: this.branch(this.c); break;
            case 0xD0: this.branch(!this.z); break;
            case 0xF0: this.branch(this.z); break;
            case 0x2F: this.branch(true); break;
            case 0x2E: {
                const address = this.fetch();
                const data = this.load(address);
                this.idle();
                this.branch(this.a !== data);
                break;
            }
            case 0xDE: {
                const address = this.fetch();
                this.idle();
                const data = this.load(address + this.x);
                this.idle();
                this.branch(this.a !== data);
                break;
            }
            case 0x6E: {
                const address = this.fetch();
                const data = (this.load(address) - 1) & 0xFF;
                this.store(address, data);
                this.branch(data !== 0);
                break;
            }
            case 0xFE:
                this.read(this.pc);
                this.idle();
                this.y = (this.y - 1) & 0xFF;
                this.branch(this.y !== 0);
                break;

            case 0x1F: {
                const address = this.fetch16();
                this.idle();
                this.pc = this.read(address + this.x) | (this.read(address + this.x + 1) << 8);
                break;
            }
            case 0x5F: this.pc = this.fetch16(); break;
            case 0x3F: {
                const address = this.fetch16();
                this.idle();
                this.push(this.pc >> 8);
                this.push(this.pc & 0xFF);
                this.idle();
                this.idle();
                this.pc = address;
                break;
            }
            case 0x4F: {
                const address = this.fetch();
                this.idle();
                this.push(this.pc >> 8);
                this.push(this.pc & 0xFF);
                this.idle();
                this.pc = 0xFF00 | address;
                break;
            }
            case 0x6F:
                this.read(this.pc);
                this.idle();
                this.pc = this.pull() | (this.pull() << 8);
                break;
            case 0x7F:
                this.read(this.pc);
                this.idle();
                this.setPsw(this.pull());
                this.pc = this.pull() | (this.pull() << 8);
                break;
            case 0x0F:
                this.read(this.pc);
                this.push(this.pc >> 8);
                this.push(this.pc & 0xFF);
                this.push(this.getPsw());
                this.idle();
                this.pc = this.read(0xFFDE) | (this.read(0xFFDF) << 8);
                this.i = false;
                this.b = true;
                break;

            case 0x1A: this.directModifyWord(-1); break;
            case 0x3A: this.directModifyWord(1); break;
            case 0x5A: this.directWord('cmp'); break;
            case 0x7A: this.directWord('add'); break;
            case 0x9A: this.directWord('sub'); break;
            case 0xBA: this.directWord('ld'); break;
            case 0xDA: {
                const address = this.fetch();
                this.load(address);
                this.store(address, this.a);
                this.store(address + 1, this.y);
                break;
            }

            case 0x1D: this.impliedModify(DEC, 'x'); break;
            case 0x3D: this.impliedModify(INC, 'x'); break;
            case 0xDC: this.impliedModify(DEC, 'y'); break;
            case 0xFC: this.impliedModify(INC, 'y'); break;

            case 0x1E: this.absoluteRead(CMP, 'x'); break;
            case 0x3E: this.directRead(CMP, 'x'); break;
            case 0x5E: this.absoluteRead(CMP, 'y'); break;
            case 0x7E: this.directRead(CMP, 'y'); break;
            case 0xC8: this.immediateRead(CMP, 'x'); break;
            case 0xAD: this.immediateRead(CMP, 'y'); break;

            case 0x5D: this.transfer('a', 'x'); break;
            case 0x7D: this.transfer('x', 'a'); break;
            case 0x9D: this.transfer('sp', 'x'); break;
            case 0xBD: this.transfer('x', 'sp'); break;
            case 0xDD: this.transfer('y', 'a'); break;
            case 0xFD: this.transfer('a', 'y'); break;

            case 0x8D: this.immediateRead(LD, 'y'); break;
            case 0xCD: this.immediateRead(LD, 'x'); break;
            case 0xE4: this.directRead(LD, 'a'); break;
            case 0xE5: this.absoluteRead(LD, 'a'); break;
            case 0xE6: this.indirectXRead(LD); break;
            case 0xE7: this.indexedIndirectRead(LD); break;
            case 0xE8: this.immediateRead(LD, 'a'); break;
            case 0xE9: this.absoluteRead(LD, 'x'); break;
            case 0xEB: this.directRead(LD, 'y'); break;
            case 0xEC: this.absoluteRead(LD, 'y'); break;
            case 0xF4: this.directIndexedRead(LD, 'a', this.x); break;
            case 0xF5: this.absoluteIndexedRead(LD, this.x); break;
            case 0xF6: this.absoluteIndexedRead(LD, this.y); break;
            case 0xF7: this.indirectIndexedRead(LD); break;
            case 0xF8: this.directRead(LD, 'x'); break;
            case 0xF9: this.directIndexedRead(LD, 'x', this.y); break;
            case 0xFB: this.directIndexedRead(LD, 'y', this.x); break;
            case 0xFA: this.directDirectWrite(); break;
            case 0x8F: this.directImmediateWrite(); break;

            case 0xC4: this.directWrite(this.a); break;
            case 0xC5: this.absoluteWrite(this.a); break;
            case 0xC6: this.indirectXWrite(); break;
            case 0xC7: this.indexedIndirectWrite(); break;
            case 0xC9: this.absoluteWrite(this.x); break;
            case 0xCB: this.directWrite(this.y); break;
            case 0xCC: this.absoluteWrite(this.y); break;
            case 0xD4: this.directIndexedWrite(this.a, this.x); break;
            case 0xD5: this.absoluteIndexedWrite(this.x); break;
            case 0xD6: this.absoluteIndexedWrite(this.y); break;
            case 0xD7: this.indirectIndexedWrite(); break;
            case 0xD8: this.directWrite(this.x); break;
            case 0xD9: this.directIndexedWrite(this.x, this.y); break;
            case 0xDB: this.directIndexedWrite(this.y, this.x); break;

            case 0xAF:
                this.read(this.pc);
                this.idle();
                this.store(this.x, this.a);
                this.x = (this.x + 1) & 0xFF;
                break;
            case 0xBF:
                this.read(this.pc);
                this.a = this.load(this.x);
                this.x = (this.x + 1) & 0xFF;
                this.idle();
                this.setNZ(this.a);
                break;

            case 0x20: this.read(this.pc); this.p = false; break;
            case 0x40: this.read(this.pc); this.p = true; break;
            case 0x60: this.read(this.pc); this.c = false; break;
            case 0x80: this.read(this.pc); this.c = true; break;
            case 0xA0: this.read(this.pc); this.idle(); this.i = true; break;
            case 0xC0: this.read(this.pc); this.idle(); this.i = false; break;
            case 0xE0: this.read(this.pc); this.v = false; this.h = false; break;
            case 0xED: this.read(this.pc); this.idle(); this.c = !this.c; break;

            case 0x9F:
                this.read(this.pc);
                this.idle();
                this.idle();
                this.idle();
                this.a = ((this.a >> 4) | (this.a << 4)) & 0xFF;
                this.setNZ(this.a);
                break;
            case 0xCF: {
                this.read(this.pc);
                for (let i = 0; i < 7; i++) this.idle();
                const product = this.y * this.a;
                this.ya = product;
                // The flags only reflect the high byte
                this.setNZ(this.y);
                break;
            }
            case 0x9E: {
                this.read(this.pc);
                for (let i = 0; i < 10; i++) this.idle();
                const ya = this.ya;
                const { x } = this;
                this.h = (this.y & 15) >= (x & 15);
                this.v = this.y >= x;
                if (this.y < (x << 1)) {
                    this.a = Math.floor(ya / x) & 0xFF;
                    this.y = ya % x;
                } else {
                    // The quotient doesn't fit in 9 bits, the S-SMP's odd result
                    this.a = (255 - Math.floor((ya - (x << 9)) / (256 - x))) & 0xFF;
                    this.y = (x + (ya - (x << 9)) % (256 - x)) & 0xFF;
                }
                this.setNZ(this.a);
                break;
            }
            case 0xDF:
                this.read(this.pc);
                this.idle();
                if (this.c || this.a > 0x99) {
                    this.a = (this.a + 0x60) & 0xFF;
                    this.c = true;
                }
                if (this.h || (this.a & 15) > 9) this.a = (this.a + 0x06) & 0xFF;
                this.setNZ(this.a);
                break;
            case 0xBE:
                this.read(this.pc);
                this.idle();
                if (!this.c || this.a > 0x99) {
                    this.a = (this.a - 0x60) & 0xFF;
                    this.c = false;
                }
                if (!this.h || (this.a & 15) > 9) this.a = (this.a - 0x06) & 0xFF;
                this.setNZ(this.a);
                break;

            case 0xEF:
            case 0xFF:
                this.read(this.pc);
                this.idle();
                this.stopped = true;
                break;
        }
    }
}

export default Spc700;

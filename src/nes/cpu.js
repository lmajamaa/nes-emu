import { instructions } from './instructions';
import { hex } from '../utilities';

// MOS 6502 CPU Implementation -  Thanks for https://github.com/OneLoneCoder/olcNES and https://github.com/fredericcambon/nes

class Cpu {
    constructor(bus) {
        this.bus = bus;

        // Registers
        this.a = 0; // Accumulator register
        this.x = 0; // X register
        this.y = 0; // Y register
        this.stkp = 0x00; // Stack pointer (location on bus)
        this.pc = 0x00; // Program counter
        // this.status used to be here, using getFlags / setFlags instead

        // Flags
        this.c = 0; // Carry bit
        this.z = 0; // Zero
        this.i = 0; // Disable interrupts
        this.d = 0; // Decimal mode (unused)
        this.b = 0; // Break;
        this.u = 0; // Unused;
        this.v = 0; // Overflow
        this.n = 0; // Negative

        this.fetched = 0x00;
        this.addr_abs = 0x0000;
        this.addr_rel = 0x00;
        this.opcode = 0x00;
        this.cycles = 0;
    }

    clock() {
        if (this.cycles === 0) {
            this.opcode = this.read(this.pc);
            this.pc++;

            // Get starting number of cycles
            try {
                const instruction = this.lookup(this.opcode);
                if (Number.isNaN(instruction.cycles)) {
                    this.cycles = 1;
                    throw new Error('Cycles not defined for opcode', this.opcode)
                }
                //console.log(instruction.opcode, instruction.addrmode);
                const additional_cycle1 = this[instruction.addrmode]();
                const additional_cycle2 = this[instruction.opcode]();

                this.cycles += (additional_cycle1 + additional_cycle2);
            } catch (e) {
                console.log('Unable to execute opcode: ' + this.opcode, e);
            }
        }
        
        if (this.cycles !== 0)
            this.cycles--;
    }

    reset() {
        this.a = 0;
        this.x = 0;
        this.y = 0;
        this.stkp = 0xFD;
        this.setFlags(0x00 | Flags6502.U);

        this.addr_abs = 0xFFFC;

        const lo = this.read(this.addr_abs + 0);
        const hi = this.read(this.addr_abs + 1);
        this.pc = (hi << 8) | lo;
        this.addr_rel = 0x0000;
        this.addr_abs = 0x0000;
        this.fetched = 0x00;

        this.cycles = 8;
    }

    irq() {
        if (this.i === 0) {
            this.write(0x0100 + this.stkp, (this.pc >> 8) & 0x00FF);
            this.stkp--;
            this.write(0x0100 + this.stkp, this.pc & 0x00FF);
            this.stkp--;

            this.b = 0;
            this.u = 1;
            this.i = 1;
            this.write(0x0100 + this.stkp, this.getFlags());
            this.stkp--;

            this.addr_abs = 0xFFFE;
            const lo = this.read(this.addr_abs + 0);
            const hi = this.read(this.addr_abs + 1);
            this.pc = (hi << 8) | lo;

            this.cycles = 7;
        }
    }

    nmi() {
        this.write(0x0100 + this.stkp, (this.pc >> 8) & 0x00FF);
        this.stkp--;
        this.write(0x0100 + this.stkp, this.pc & 0x00FF);
        this.stkp--;

        this.b = 0;
        this.u = 1;
        this.i = 1;
        this.write(0x0100 + this.stkp, this.getFlags());
        this.stkp--;

        this.addr_abs = 0xFFFA;
        const lo = this.read(this.addr_abs + 0);
        const hi = this.read(this.addr_abs + 1);
        this.pc = (hi << 8) | lo;

        this.cycles = 8;
    }

    fetch() {
        const addrmode = this.lookup(this.opcode).addrmode;
        if (addrmode !== 'IMP') {
            this.fetched = this.read(this.addr_abs);
        }
        return this.fetched;
    }

    read(addr) {
        return this.bus.cpuRead(addr, false);
    }

    write(addr, data) {
        this.bus.cpuWrite(addr, data);
    }

    getFlags() {
        // Concatenate the values of the flags in an int
        var flags = 0;

        flags = flags | (this.c << 0);
        flags = flags | (this.z << 1);
        flags = flags | (this.i << 2);
        flags = flags | (this.d << 3);
        flags = flags | (this.b << 4);
        flags = flags | (this.u << 5);
        flags = flags | (this.v << 6);
        flags = flags | (this.n << 7);
        return flags;
    }

    setFlags(value) {
        this.c = (value >> 0) & 1;
        this.z = (value >> 1) & 1;
        this.i = (value >> 2) & 1;
        this.d = (value >> 3) & 1;
        this.b = (value >> 4) & 1;
        this.u = (value >> 5) & 1;
        this.v = (value >> 6) & 1;
        this.n = (value >> 7) & 1;
    }

    lookup(number) {
        const instruction = instructions[number];
        if (instruction) {
            const [opcode, addrmode, size, cycles] = instruction;

            return { number, opcode, addrmode, size, cycles };
        } else {
            return { number, opcode: '???', addrmode: '???', size: 1, cycles: 1 };
        }
    }

    // Addressing modes
    IMP() {
        this.fetched = this.a;
        return 0;
    }
    IMM() {
        this.addr_abs = this.pc++;
        return 0;
    }
    ZP0() {
        this.addr_abs = this.read(this.pc);
        this.pc++;
        this.addr_abs &= 0x00FF;
        return 0;
    }
    ZPX() {
        this.addr_abs = this.read(this.pc) + this.x;
        this.pc++;
        this.addr_abs &= 0x00FF;
        return 0;
    }
    ZPY() {
        this.addr_abs = this.read(this.pc) + this.y;
        this.pc++;
        this.addr_abs &= 0x00FF;
        return 0;
    }
    ABS() {
        const lo = this.read(this.pc);
        this.pc++;
        const hi = this.read(this.pc);
        this.pc++;

        this.addr_abs = (hi << 8) | lo;
        return 0;
    }
    ABX() {
        const lo = this.read(this.pc);
        this.pc++;
        const hi = this.read(this.pc);
        this.pc++;

        this.addr_abs = (hi << 8) | lo;
        this.addr_abs += this.x;

        if ((this.addr_abs & 0xFF00) !== (hi << 8))
            return 1;
        else
            return 0;
    }
    ABY() {
        const lo = this.read(this.pc);
        this.pc++;
        const hi = this.read(this.pc);
        this.pc++;

        this.addr_abs = (hi << 8) | lo;
        this.addr_abs += this.y;

        if ((this.addr_abs & 0xFF00) !== (hi << 8))
            return 1;
        else
            return 0;
    }
    IND() {
        const ptr_lo = this.read(this.pc);
        this.pc++;
        const ptr_hi = this.read(this.pc);
        this.pc++;

        const ptr = (ptr_hi << 8) | ptr_lo;

        if (ptr_lo === 0x00FF) { // Simulate page boundary hardware bug
            this.addr_abs = (this.read(ptr & 0xFF00) << 8) | this.read(ptr + 0);
        } else {
            this.addr_abs = (this.read(ptr + 1) << 8) | this.read(ptr + 0);
        }

        return 0;
    }
    IZX() {
        const t = this.read(this.pc);
        this.pc++;

        const lo = this.read((t + this.x) & 0x00FF);
        const hi = this.read((t + this.x + 1) & 0x00FF);

        this.addr_abs = (hi << 8) | lo;
        return 0;
    }
    IZY() {
        const t = this.read(this.pc);
        this.pc++;

        const lo = this.read(t & 0x00FF);
        const hi = this.read((t + 1) & 0x00FF);

        this.addr_abs = (hi << 8) | lo;
        this.addr_abs += this.y;

        if ((this.addr_abs & 0xFF00) !== (hi << 8))
            return 1;
        else
            return 0;
    }
    REL() {
        this.addr_rel = this.read(this.pc);
        this.pc++;
        if ((this.addr_rel & 0x80) !== 0) {
            this.addr_rel |= 0xFF00;
        }
        if (this.addr_rel > 32767) { // unsigned to signed
            this.addr_rel = this.addr_rel - 65536;
        }
        return 0;
    }

    ///////////////////////////////////////////////////////////////////////////////
    // Instructions

    /** Instruction: Bitwise Logic AND */
    AND() {
        this.fetch();
        this.a = this.a & this.fetched;

        this.z = this.a === 0x00 ? 1 : 0;
        this.n = (this.a & 0x80) !== 0 ? 1 : 0;
        return 1;
    }
    /** Instruction: Arithmetic Shift Left */
    ASL() {
        this.fetch();
        const temp = this.fetched << 1;
        this.c = temp & 0xFF00 > 0 ? 1 : 0;
        this.z = temp & 0x00FF == 0x00 ? 1 : 0;
        this.n = (temp & 0x80) !== 0 ? 1 : 0;
        if (this.lookup(this.opcode).addrmode === 'IMP') {
            this.a = temp & 0x00FF;
        } else {
            this.write(this.addr_abs, temp & 0x00FF);
        }
        return 0;
    }
    /** Instruction: Branch if Carry Clear */
    BCC() {
        if (this.c === 0) { // Carry bit
            this.cycles++;
            this.addr_abs = this.pc + this.addr_rel;

            if ((this.addr_abs & 0xFF00) !== (this.pc & 0xFF00))
                this.cycles++;

            this.pc = this.addr_abs;
        }
        return 0;
    }
    /** Instruction: Branch if Carry Set */
    BCS() {
        if (this.c === 1) { // Carry bit
            this.cycles++;
            this.addr_abs = this.pc + this.addr_rel;

            if ((this.addr_abs & 0xFF00) !== (this.pc & 0xFF00))
                this.cycles++;

            this.pc = this.addr_abs;
        }
        return 0;
    }
    /** Instruction: Branch if Equal */
    BEQ() {
        if (this.z === 1) { // Zero
            this.cycles++;
            this.addr_abs = this.pc + this.addr_rel;

            if ((this.addr_abs & 0xFF00) !== (this.pc & 0xFF00))
                this.cycles++;

            this.pc = this.addr_abs;
        }
        return 0;
    }
    BIT() {
        this.fetch();
        const temp = this.a & this.fetched;
        this.z = temp & 0x00FF == 0x00 ? 1 : 0;
        this.n = temp & (1 << 7);
        this.v = temp & (1 << 6);
        return 0;
    }
    /** Instruction: Branch if Negative */
    BMI() {
        if (this.n === 1) { // Negative
            this.cycles++;
            this.addr_abs = this.pc + this.addr_rel;

            if ((this.addr_abs & 0xFF00) !== (this.pc & 0xFF00))
                this.cycles++;

            this.pc = this.addr_abs;
        }
        return 0;
    }
    /** Instruction: Branch if Not Equal */
    BNE() {
        if (this.z === 0) {
            this.cycles++;
            this.addr_abs = this.pc + this.addr_rel;

            if ((this.addr_abs & 0xFF00) !== (this.pc & 0xFF00))
                this.cycles++;

            this.pc = this.addr_abs;
        }
        return 0;
    }
    /** Instruction: Branch if Positive */
    BPL() {
        if (this.n === 0) {
            this.cycles++;
            this.addr_abs = this.pc + this.addr_rel;

            if ((this.addr_abs & 0xFF00) !== (this.pc & 0xFF00))
                this.cycles++;

            this.pc = this.addr_abs;
        }
        return 0;
    }
    /** Break */
    BRK() {
        this.pc++;

        this.i = 1;
        this.write(0x0100 + this.stkp, (this.pc >> 8) & 0x00FF);
        this.stkp--;
        this.write(0x0100 + this.stkp, this.pc & 0x00FF);
        this.stkp--;

        this.b = 1;
        this.write(0x0100 + this.stkp, this.getFlags());
        this.stkp--;
        this.b = 0;

        this.pc = this.read(0xFFFE) | (this.read(0xFFFF) << 8);
        return 0;
    }
    /** Instruction: Branch if Overflow Clear */
    BVC() {
        if (this.v === 0) {
            this.cycles++;
            this.addr_abs = this.pc + this.addr_rel;

            if ((this.addr_abs & 0xFF00) !== (this.pc & 0xFF00))
                this.cycles++;

            this.pc = this.addr_abs;
        }
        return 0;
    }
    /** Instruction: Branch if Overflow Set */
    BVS() {
        if (this.v === 1) {
            this.cycles++;
            this.addr_abs = this.pc + this.addr_rel;

            if ((this.addr_abs & 0xFF00) !== (this.pc & 0xFF00))
                this.cycles++;

            this.pc = this.addr_abs;
        }
        return 0;
    }
    /** Instruction: Clear Carry Flag */
    CLC() {
        this.c = 0;
        return 0;
    }
    /** Instruction: Clear Decimal Flag */
    CLD() {
        this.d = 0;
        return 0;
    }
    /** Instruction: Disable Interrupts / Clear Interrupt Flag */
    CLI() {
        this.i = 0;
        return 0;
    }
    /** Instruction: Clear Overflow Flag */
    CLV() {
        this.v = 0;
        return 0;
    }
    /** Instruction: Compare Accumulator */
    CMP() {
        this.fetch();
        const temp = this.a - this.fetched;
        this.c = this.a >= this.fetched ? 1 : 0;
        this.z = (temp & 0x00FF) === 0x0000 ? 1 : 0;
        this.n = temp & 0x0080;
        return 1;
    }
    /** Compare X Register */
    CPX() {
        this.fetch();
        const temp = this.x - this.fetched;
        this.c = this.x >= this.fetched ? 1 : 0;
        this.z = (temp & 0x00FF) === 0x0000 ? 1 : 0;
        this.n = temp & 0x0080;
        return 0;
    }
    /** Compare Y Register */
    CPY() {
        this.fetch();
        const temp = this.y - this.fetched;
        this.c = this.y >= this.fetched ? 1 : 0;
        this.z = (temp & 0x00FF) === 0x0000 ? 1 : 0;
        this.n = temp & 0x0080;
        return 0;
    }
    /** Instruction: Decrement Value at Memory Location */
    DEC() {
        this.fetch();
        const temp = this.fetched - 1;
        this.write(this.addr_abs, temp & 0x00FF);
        this.z = (temp & 0x00FF) === 0x0000 ? 1 : 0;
        this.n = temp & 0x0080;
        return 0;
    }
    /** Decrement X Register */
    DEX() {
        this.x--;
        this.z = this.x === 0 ? 1 : 0;
        this.n = (this.x & 0x80) !== 0 ? 1 : 0;
        return 0;
    }
    /** Decrement Y Register */
    DEY() {
        this.y--;
        this.z = this.y === 0 ? 1 : 0;
        this.n = (this.y & 0x80) !== 0 ? 1 : 0;
        return 0;
    }
    /** Bitwise Logic XOR */
    EOR() {
        this.fetch();
        this.a = this.a ^ this.fetched;
        this.z = this.a === 0x00 ? 1 : 0;
        this.n = (this.a & 0x80) !== 0 ? 1 : 0;
        return 1;

    }
    /** Instruction: Increment Value at Memory Location */
    INC() {
        this.fetch();
        const temp = this.fetched + 1;
        this.write(this.addr_abs, temp & 0x00FF);
        this.z = (temp & 0x00FF) === 0x0000 ? 1 : 0;
        this.n = temp & 0x0080;
        return 0;
    }
    /** Instruction: Increment X Register */
    INX() {
        this.x++;
        this.z = this.x === 0 ? 1 : 0;
        this.n = (this.x & 0x80) !== 0 ? 1 : 0;
        return 0;
    }
    /** Instruction: Increment Y Register */
    INY() {
        this.y++;
        this.z = this.y === 0 ? 1 : 0;
        this.n = (this.y & 0x80) !== 0 ? 1 : 0;
        return 0;
    }
    /** Instruction: Jump To Location */
    JMP() {
        this.pc = this.addr_abs;
        return 0;
    }
    /** Instruction: Jump To Sub-Routine */
    JSR() {
        this.pc--;

        this.write(0x0100 + this.stkp, (this.pc >> 8) & 0x00FF);
        this.stkp--;
        this.write(0x0100 + this.stkp, this.pc & 0x00FF);
        this.stkp--;

        this.pc = this.addr_abs;
        return 0;
    }
    /** Instruction: Load The Accumulator */
    LDA() {
        this.fetch();
        this.a = this.fetched;
        this.z = this.a === 0x00 ? 1 : 0;
        this.n = (this.a & 0x80) !== 0 ? 1 : 0;
        return 1;
    }
    /** Instruction: Load The X Register */
    LDX() {
        this.fetch();
        this.x = this.fetched;
        this.z = this.x === 0x00 ? 1 : 0;
        this.n = (this.x & 0x80) !== 0 ? 1 : 0;
        return 1;
    }
    /** Instruction: Load The Y Register */
    LDY() {
        this.fetch();
        this.y = this.fetched;
        this.z = this.y === 0x00 ? 1 : 0;
        this.n = (this.y & 0x80) !== 0 ? 1 : 0;
        return 1;
    }
    LSR() {
        this.fetch();
        this.c = this.fetched & 0x0001;
        const temp = this.fetched >> 1;
        this.z = (temp & 0x00FF) === 0x0000 ? 1 : 0;
        this.n = temp & 0x0080;
        if (this.lookup(this.opcode).addrmode === 'IMP') {
            this.a = temp & 0x00FF;
        } else {
            this.write(this.addr_abs, temp & 0x00FF);
        }
        return 0;
    }
    NOP() {
        // Sadly not all NOPs are equal, Ive added a few here
        // based on https://wiki.nesdev.com/w/index.php/CPU_unofficial_opcodes
        // and will add more based on game compatibility, and ultimately
        // I'd like to cover all illegal opcodes too
        switch (this.opcode) {
            case 0x1C:
            case 0x3C:
            case 0x5C:
            case 0x7C:
            case 0xDC:
            case 0xFC:
                return 1;
            default:
                break;
        }
        return 0;
    }
    /** Instruction: Bitwise Logic OR */
    ORA() {
        this.fetch();
        this.a = this.a | this.fetched;
        this.z = this.a === 0x00 ? 1 : 0;
    }
    /**  Instruction: Add with Carry In */
    ADC() {
        this.fetch();
        const temp = this.a + this.fetched + this.c;
        this.c = temp > 255 ? 1 : 0;
        this.z = (temp & 0x00FF == 0) ? 1 : 0;
        this.n = (temp & 0x80) !== 0 ? 1 : 0;
        this.v = ~(this.a ^ this.fetched) & (this.a ^ temp) & 0x0080;
        this.a = temp & 0x00FF;

        return 1;
    }
    /** Instruction: Subtraction with Borrow In */
    SBC() {
        this.fetch();
        const value = this.fetched ^ 0x00FF;

        const temp = this.a + value + this.c;
        this.c = temp > 255 ? 1 : 0;
        this.z = (temp & 0x00FF == 0) ? 1 : 0;
        this.n = (temp & 0x80) !== 0 ? 1 : 0;
        this.v = ~(this.a ^ this.fetched) & (this.a ^ temp) & 0x0080;
        this.a = temp & 0x00FF;

        return 1;
    }
    /** Instruction: Push Accumulator to Stack */
    PHA() {
        this.write(0x0100 + this.stkp, this.a);
        this.stkp--;
        return 0;
    }
    /** Instruction: Push Status Register to Stack */
    PHP() {
        this.write(0x0100 + this.stkp, this.getFlags() | Flags6502.B | Flags6502.U);
        this.b = 0;
        this.u = 0;
        this.stkp--;
        return 0;
    }
    /** Instruction: Pop Accumulator off Stack */
    PLA() {
        this.stkp++;
        this.a = this.read(0x0100 + this.stkp);
        this.z = this.a === 0x00 ? 1 : 0;
        this.n = (this.a & 0x80) !== 0 ? 1 : 0;
        return 0;
    }
    /** Instruction: Pop Status Register off Stack */
    PLP() {
        this.stkp++;
        this.setFlags(this.read(0x0100 + this.stkp));
        this.u = 1;
        return 0;
    }
    ROL() {
        this.fetch();
        const temp = (this.fetched << 1) | this.c;
        this.c = temp & 0xFF00 ? 1 : 0;
        this.z = (temp & 0x00FF) === 0x0000 ? 1 : 0;
        this.n = temp & 0x0080;
        if (this.lookup(this.opcode).addrmode === 'IMP') {
            this.a = temp & 0x00FF;
        } else {
            this.write(this.addr_abs, temp & 0x00FF);
        }
        return 0;
    }
    ROR() {
        this.fetch();
        const temp = (this.c << 7) | (this.fetched >> 1);
        this.c = this.fetched & 0x01;
        this.z = (temp & 0x00FF) === 0x00 ? 1 : 0;
        this.n = temp & 0x0080;
        if (this.lookup(this.opcode).addrmode === 'IMP') {
            this.a = temp & 0x00FF;
        } else {
            this.write(this.addr_abs, temp & 0x00FF);
        }
        return 0;
    }
    RTI() {
        this.stkp++;
        this.setFlags(this.read(0x0100 + this.stkp));
        let status = this.getFlags()
        status &= ~Flags6502.B;
        status &= ~Flags6502.U;
        this.setFlags(status);

        this.stkp++;
        this.setFlags(this.read(0x0100 + this.stkp));
        this.stkp++;
        this.pc |= this.read(0x0100 + this.stkp) << 8;
        return 0;
    }
    RTS() {
        this.stkp++;
        this.pc = this.read(0x0100 + this.stkp);
        this.stkp++;
        this.pc |= this.read(0x0100 + this.stkp) << 8;

        this.pc++;
        return 0;
    }
    /** Instruction: Set Carry Flag */
    SEC() {
        this.c = 1;
        return 0;
    }
    /** Set Decimal Flag */
    SED() {
        this.d = 1;
        return 0;
    }
    /** Set Interrupt Flag / Enable Interrupts */
    SEI() {
        this.i = 1;
        return 0;
    }
    /** Instruction: Store Accumulator at Address */
    STA() {
        this.write(this.addr_abs, this.a);
        return 0;
    }
    /** Store X Register at Address */
    STX() {
        this.write(this.addr_abs, this.x);
        return 0;
    }
    /** Instruction: Store Y Register at Address */
    STY() {
        this.write(this.addr_abs, this.y);
        return 0;
    }
    /** Instruction: Transfer Accumulator to X Register */
    TAX() {
        this.x = this.a;
        this.z = this.x === 0x00 ? 1 : 0;
        this.n = (this.x & 0x80) !== 0 ? 1 : 0;
        return 0;
    }
    /** Instruction: Transfer Accumulator to Y Register */
    TAY() {
        this.y = this.a;
        this.z = this.y === 0x00 ? 1 : 0;
        this.n = (this.y & 0x80) !== 0 ? 1 : 0;
        return 0;
    }
    /** Instruction: Transfer Stack Pointer to X Register */
    TSX() {
        this.x = this.stkp;
        this.z = this.x === 0x00 ? 1 : 0;
        this.n = (this.x & 0x80) !== 0 ? 1 : 0;
        return 0;
    }
    /**  Instruction: Transfer X Register to Accumulator */
    TXA() {
        this.a = this.x;
        this.z = this.a === 0x00 ? 1 : 0;
        this.n = (this.a & 0x80) !== 0 ? 1 : 0;
        return 0;
    }
    /** Instruction: Transfer X Register to Stack Pointer */
    TXS() {
        this.stkp = this.x;
        return 0;
    }
    /** Instruction: Transfer Y Register to Accumulator */
    TYA() {
        this.a = this.y;
        this.z = this.a === 0x00 ? 1 : 0;
        this.n = (this.a & 0x80) !== 0 ? 1 : 0;
        return 0;
    }
    /** Illegal opcodes */
    XXX() {
        console.log('Illegal opcode', this.opcode);
        return 0;
    }

    ///////////////////////////////////////////////////////////////////////////////

    // Helper functions
    complete() {
        return this.cycles === 0 || Number.isNaN(this.cycles);
    }

    disassemble(nStart, nStop) {
        let addr = nStart;
        let value = 0x00; let hi = 0x00; let lo = 0x00;
        const mapLines = [];
        let line_addr = 0;
        while (addr <= nStop) {
            line_addr = addr;
            // Prefix line with instruction address
            let sInst = '$' + hex(addr, 4) + ': ';

            // Read instruction, and get its readable name
            const id = this.bus.cpuRead(addr, true); addr++;
            const instruction = this.lookup(id);
            const opcode = instruction.opcode;
            const addrmode = instruction.addrmode;
            sInst += opcode + ' ';
            // Get operands from desired locations, and form the
            // instruction based upon its addressing mode. These
            // routines mimmick the actual fetch routine of the
            // 6502 in order to get accurate data as part of the
            // instruction
            if (addrmode === 'IMP') {
                sInst += ' {IMP}';
            } else if (addrmode === 'IMM') {
                value = this.bus.cpuRead(addr, true); addr++;
                sInst += '#$' + hex(value, 2) + ' {IMM}';
            } else if (addrmode === 'ZP0') {
                lo = this.bus.cpuRead(addr, true); addr++;
                hi = 0x00;
                sInst += '$' + hex(lo, 2) + ' {ZP0}';
            } else if (addrmode === 'ZPX') {
                lo = this.bus.cpuRead(addr, true); addr++;
                hi = 0x00;
                sInst += '$' + hex(lo, 2) + ', X {ZPX}';
            } else if (addrmode === 'ZPY') {
                lo = this.bus.cpuRead(addr, true); addr++;
                hi = 0x00;
                sInst += '$' + hex(lo, 2) + ', Y {ZPY}';
            } else if (addrmode === 'IZX') {
                lo = this.bus.cpuRead(addr, true); addr++;
                hi = 0x00;
                sInst += '($' + hex(lo, 2) + ', X) {IZX}';
            } else if (addrmode === 'IZY') {
                lo = this.bus.cpuRead(addr, true); addr++;
                hi = 0x00;
                sInst += '($' + hex(lo, 2) + '), Y {IZY}';
            } else if (addrmode === 'ABS') {
                lo = this.bus.cpuRead(addr, true); addr++;
                hi = this.bus.cpuRead(addr, true); addr++;
                sInst += '$' + hex((hi << 8) | lo, 4) + ' {ABS}';
            } else if (addrmode === 'ABX') {
                lo = this.bus.cpuRead(addr, true); addr++;
                hi = this.bus.cpuRead(addr, true); addr++;
                sInst += '$' + hex((hi << 8) | lo, 4) + ', X {ABX}';
            } else if (addrmode === 'ABY') {
                lo = this.bus.cpuRead(addr, true); addr++;
                hi = this.bus.cpuRead(addr, true); addr++;
                sInst += '$' + hex((hi << 8) | lo, 4) + ', Y {ABY}';
            } else if (addrmode === 'IND') {
                lo = this.bus.cpuRead(addr, true); addr++;
                hi = this.bus.cpuRead(addr, true); addr++;
                sInst += '($' + hex((hi << 8) | lo, 4) + ') {IND}';
            } else if (addrmode === 'REL') {
                value = this.bus.cpuRead(addr, true); addr++;
                sInst += '$' + hex(value, 2) + ' [$' + hex(addr + value, 4) + '] {REL}';
            }

            mapLines[line_addr] = sInst;
        }

        return mapLines;
    }
}

const Flags6502 = {
    C: 1 << 0,
    Z: 1 << 1,
    I: 1 << 2,
    D: 1 << 3,
    B: 1 << 4,
    U: 1 << 5,
    V: 1 << 6,
    N: 1 << 7,
}

export default Cpu;
import { instructions, type AddressingMode } from './instructions';
import { hex, convertUint8ToInt } from '../../../utils';

// MOS 6502 CPU Implementation -  Thanks for https://github.com/OneLoneCoder/olcNES and https://github.com/fredericcambon/nes

// Part of the unstable XAA and LXA results, they depend on the chip. LXA uses what blargg's
// tests, verified on a NES, expect. XAA isn't tested by them and uses the usual 6502 value.
const LXA_MAGIC = 0xFF;
const XAA_MAGIC = 0xEE;

export interface CpuBus {
    cpuRead(addr: number, readOnly?: boolean): number;
    cpuWrite(addr: number, data: number): void;
}

const Flag = {
    C: 1 << 0,
    Z: 1 << 1,
    I: 1 << 2,
    D: 1 << 3,
    B: 1 << 4,
    U: 1 << 5,
    V: 1 << 6,
    N: 1 << 7,
} as const;

export type CpuState = Pick<Cpu, 'a' | 'x' | 'y' | 'stkp' | 'pc' | 'c' | 'z' | 'i' | 'd' | 'b' | 'u' | 'v' | 'n'>;

class Cpu {
    private readonly bus: CpuBus;

    // Registers
    a = 0; // Accumulator register
    x = 0; // X register
    y = 0; // Y register
    stkp = 0x00; // Stack pointer (location on bus)
    pc = 0x00; // Program counter

    // Flags, each 0 or 1
    c = 0; // Carry bit
    z = 0; // Zero
    i = 0; // Disable interrupts
    d = 0; // Decimal mode (unused)
    b = 0; // Break;
    u = 0; // Unused;
    v = 0; // Overflow
    n = 0; // Negative

    fetched = 0x00;
    addrAbs = 0x0000;
    addrRel = 0x00;
    opcode = 0x00;
    // Of the instruction being executed
    private mode: AddressingMode = 'IMP';
    cycles = 0;

    constructor(bus: CpuBus) {
        this.bus = bus;
    }

    clock(): void {
        if (this.cycles === 0) {
            this.opcode = this.read(this.pc);
            this.pc++;

            // Get starting number of cycles
            const [mnemonic, mode, , cycles] = instructions[this.opcode];
            this.mode = mode;
            this.cycles = cycles;

            const modeExtraCycle = this[mode]();
            const opExtraCycle = this[mnemonic]();

            // An extra cycle is only needed when the addressing mode crossed
            // a page AND the instruction is one that is affected by it
            this.cycles += (modeExtraCycle & opExtraCycle);
            this.pc &= 0xFFFF;
        }

        if (this.cycles !== 0) this.cycles--;
    }

    reset(): void {
        // Get address to set program counter to
        this.addrAbs = 0xFFFC;
        const lo = this.read(this.addrAbs + 0);
        const hi = this.read(this.addrAbs + 1);

        // Set it
        this.pc = (hi << 8) | lo;

        // Reset internal registers
        this.a = 0;
        this.x = 0;
        this.y = 0;
        this.stkp = 0xFD;
        this.setFlags(Flag.U | Flag.I);

        // Clear internal helper variables
        this.addrRel = 0x0000;
        this.addrAbs = 0x0000;
        this.fetched = 0x00;

        // Reset takes time
        this.cycles = 8;
    }

    irq(): void {
        if (this.i === 0) {
            this.push((this.pc >> 8) & 0x00FF);
            this.push(this.pc & 0x00FF);

            // Then push the status register to the stack
            this.b = 0;
            this.u = 1;
            this.push(this.getFlags());
            this.i = 1;

            // Read new program counter location from fixed address
            this.addrAbs = 0xFFFE;
            const lo = this.read(this.addrAbs + 0);
            const hi = this.read(this.addrAbs + 1);
            this.pc = (hi << 8) | lo;

            // IRQs take time
            this.cycles = 7;
        }
    }

    nmi(): void {
        this.push((this.pc >> 8) & 0x00FF);
        this.push(this.pc & 0x00FF);

        this.b = 0;
        this.u = 1;
        this.push(this.getFlags());
        this.i = 1;

        this.addrAbs = 0xFFFA;
        const lo = this.read(this.addrAbs + 0);
        const hi = this.read(this.addrAbs + 1);
        this.pc = (hi << 8) | lo;

        // NMIs take time
        this.cycles = 8;
    }

    fetch(): number {
        if (this.mode !== 'IMP') {
            this.fetched = this.read(this.addrAbs);
        }
        return this.fetched;
    }

    read(addr: number): number {
        return this.bus.cpuRead(addr & 0xFFFF, false);
    }

    write(addr: number, data: number): void {
        this.bus.cpuWrite(addr, data);
    }

    push(data: number): void {
        this.write(0x0100 + this.stkp, data);
        this.stkp = (this.stkp - 1) & 0xFF;
    }

    pull(): number {
        this.stkp = (this.stkp + 1) & 0xFF;
        return this.read(0x0100 + this.stkp);
    }

    setZN(value: number): void {
        this.z = (value & 0xFF) === 0x00 ? 1 : 0;
        this.n = (value & 0x80) !== 0 ? 1 : 0;
    }

    branch(condition: boolean): number {
        if (condition) {
            this.cycles++;
            this.addrAbs = (this.pc + this.addrRel) & 0xFFFF;

            // Crossing a page takes one more cycle
            if ((this.addrAbs & 0xFF00) !== (this.pc & 0xFF00))
                this.cycles++;

            this.pc = this.addrAbs;
        }
        return 0;
    }

    getFlags(): number {
        return this.c | (this.z << 1) | (this.i << 2) | (this.d << 3)
            | (this.b << 4) | (this.u << 5) | (this.v << 6) | (this.n << 7);
    }

    setFlags(value: number): void {
        this.c = (value >> 0) & 1;
        this.z = (value >> 1) & 1;
        this.i = (value >> 2) & 1;
        this.d = (value >> 3) & 1;
        this.b = (value >> 4) & 1;
        this.u = (value >> 5) & 1;
        this.v = (value >> 6) & 1;
        this.n = (value >> 7) & 1;
    }

    // Addressing modes
    /** Address Mode: Implied */
    IMP(): number {
        this.fetched = this.a;
        return 0;
    }

    /** Address Mode: Immediate */
    IMM(): number {
        this.addrAbs = this.pc++;
        return 0;
    }

    /** Address Mode: Zero Page */
    ZP0(): number {
        this.addrAbs = this.read(this.pc);
        this.pc++;
        this.addrAbs &= 0x00FF;
        return 0;
    }

    /** Address Mode: Zero Page with X Offset */
    ZPX(): number {
        this.addrAbs = this.read(this.pc) + this.x;
        this.pc++;
        this.addrAbs &= 0x00FF;
        return 0;
    }

    /** Address Mode: Zero Page with Y Offset */
    ZPY(): number {
        this.addrAbs = this.read(this.pc) + this.y;
        this.pc++;
        this.addrAbs &= 0x00FF;
        return 0;
    }

    /** Address Mode: Absolute  */
    ABS(): number {
        const lo = this.read(this.pc);
        this.pc++;
        const hi = this.read(this.pc);
        this.pc++;

        this.addrAbs = (hi << 8) | lo;
        return 0;
    }

    /** Address Mode: Absolute with X Offset */
    ABX(): number {
        const lo = this.read(this.pc);
        this.pc++;
        const hi = this.read(this.pc);
        this.pc++;

        this.addrAbs = (((hi << 8) | lo) + this.x) & 0xFFFF;
        return (this.addrAbs & 0xFF00) !== (hi << 8) ? 1 : 0;
    }

    /** Address Mode: Absolute with Y Offset */
    ABY(): number {
        const lo = this.read(this.pc);
        this.pc++;
        const hi = this.read(this.pc);
        this.pc++;

        this.addrAbs = (((hi << 8) | lo) + this.y) & 0xFFFF;
        return (this.addrAbs & 0xFF00) !== (hi << 8) ? 1 : 0;
    }

    /** Address Mode: Indirect */
    IND(): number {
        const ptrLo = this.read(this.pc);
        this.pc++;
        const ptrHi = this.read(this.pc);
        this.pc++;

        const ptr = (ptrHi << 8) | ptrLo;

        if (ptrLo === 0x00FF) { // Simulate page boundary hardware bug
            this.addrAbs = (this.read(ptr & 0xFF00) << 8) | this.read(ptr + 0);
        } else {
            this.addrAbs = (this.read(ptr + 1) << 8) | this.read(ptr + 0);
        }

        return 0;
    }

    /** Address Mode: Indirect X */
    IZX(): number {
        const t = this.read(this.pc);
        this.pc++;

        const lo = this.read((t + this.x) & 0x00FF);
        const hi = this.read((t + this.x + 1) & 0x00FF);

        this.addrAbs = (hi << 8) | lo;
        return 0;
    }

    /** Address Mode: Indirect Y */
    IZY(): number {
        const t = this.read(this.pc);
        this.pc++;

        const lo = this.read(t & 0x00FF);
        const hi = this.read((t + 1) & 0x00FF);

        this.addrAbs = (((hi << 8) | lo) + this.y) & 0xFFFF;
        return (this.addrAbs & 0xFF00) !== (hi << 8) ? 1 : 0;
    }

    /**  Address Mode: Relative */
    REL(): number {
        this.addrRel = convertUint8ToInt(this.read(this.pc));
        this.pc++;
        return 0;
    }

    ///////////////////////////////////////////////////////////////////////////////
    // Instructions

    /** Instruction: Bitwise Logic AND */
    AND(): number {
        this.fetch();
        this.a = this.a & this.fetched;
        this.setZN(this.a);
        return 1;
    }
    /** Instruction: Arithmetic Shift Left */
    ASL(): number {
        this.fetch();
        const temp = this.fetched << 1;
        this.c = (temp & 0xFF00) !== 0 ? 1 : 0;
        this.setZN(temp);
        if (this.mode === 'IMP') {
            this.a = temp & 0x00FF;
        } else {
            this.write(this.addrAbs, temp & 0x00FF);
        }
        return 0;
    }
    /** Instruction: Branch if Carry Clear */
    BCC(): number {
        return this.branch(this.c === 0);
    }
    /** Instruction: Branch if Carry Set */
    BCS(): number {
        return this.branch(this.c === 1);
    }
    /** Instruction: Branch if Equal */
    BEQ(): number {
        return this.branch(this.z === 1);
    }
    /** Instruction: Test Bits in Memory with Accumulator */
    BIT(): number {
        this.fetch();
        // Z comes from A & M, but N and V are copied straight from memory
        this.z = (this.a & this.fetched) === 0x00 ? 1 : 0;
        this.n = (this.fetched >> 7) & 1;
        this.v = (this.fetched >> 6) & 1;
        return 0;
    }
    /** Instruction: Branch if Negative */
    BMI(): number {
        return this.branch(this.n === 1);
    }
    /** Instruction: Branch if Not Equal */
    BNE(): number {
        return this.branch(this.z === 0);
    }
    /** Instruction: Branch if Positive */
    BPL(): number {
        return this.branch(this.n === 0);
    }
    /** Break */
    BRK(): number {
        // BRK has a padding byte after the opcode, skip it
        this.pc++;

        this.push((this.pc >> 8) & 0x00FF);
        this.push(this.pc & 0x00FF);

        // Status is pushed with the B flag set
        this.push(this.getFlags() | Flag.B | Flag.U);
        this.i = 1;

        this.pc = this.read(0xFFFE) | (this.read(0xFFFF) << 8);
        return 0;
    }
    /** Instruction: Branch if Overflow Clear */
    BVC(): number {
        return this.branch(this.v === 0);
    }
    /** Instruction: Branch if Overflow Set */
    BVS(): number {
        return this.branch(this.v === 1);
    }
    /** Instruction: Clear Carry Flag */
    CLC(): number {
        this.c = 0;
        return 0;
    }
    /** Instruction: Clear Decimal Flag */
    CLD(): number {
        this.d = 0;
        return 0;
    }
    /** Instruction: Disable Interrupts / Clear Interrupt Flag */
    CLI(): number {
        this.i = 0;
        return 0;
    }
    /** Instruction: Clear Overflow Flag */
    CLV(): number {
        this.v = 0;
        return 0;
    }
    compare(register: number): void {
        this.fetch();
        this.c = register >= this.fetched ? 1 : 0;
        this.setZN(register - this.fetched);
    }
    /** Instruction: Compare Accumulator */
    CMP(): number {
        this.compare(this.a);
        return 1;
    }
    /** Compare X Register */
    CPX(): number {
        this.compare(this.x);
        return 0;
    }
    /** Compare Y Register */
    CPY(): number {
        this.compare(this.y);
        return 0;
    }
    /** Instruction: Decrement Value at Memory Location */
    DEC(): number {
        this.fetch();
        const temp = (this.fetched - 1) & 0x00FF;
        this.write(this.addrAbs, temp);
        this.setZN(temp);
        return 0;
    }
    /** Decrement X Register */
    DEX(): number {
        this.x = (this.x - 1) & 0xFF;
        this.setZN(this.x);
        return 0;
    }
    /** Decrement Y Register */
    DEY(): number {
        this.y = (this.y - 1) & 0xFF;
        this.setZN(this.y);
        return 0;
    }
    /** Bitwise Logic XOR */
    EOR(): number {
        this.fetch();
        this.a = this.a ^ this.fetched;
        this.setZN(this.a);
        return 1;
    }
    /** Instruction: Increment Value at Memory Location */
    INC(): number {
        this.fetch();
        const temp = (this.fetched + 1) & 0x00FF;
        this.write(this.addrAbs, temp);
        this.setZN(temp);
        return 0;
    }
    /** Instruction: Increment X Register */
    INX(): number {
        this.x = (this.x + 1) & 0xFF;
        this.setZN(this.x);
        return 0;
    }
    /** Instruction: Increment Y Register */
    INY(): number {
        this.y = (this.y + 1) & 0xFF;
        this.setZN(this.y);
        return 0;
    }
    /** Instruction: Jump To Location */
    JMP(): number {
        this.pc = this.addrAbs;
        return 0;
    }
    /** Instruction: Jump To Sub-Routine */
    JSR(): number {
        // The return address pushed is the last byte of the JSR instruction
        this.pc--;

        this.push((this.pc >> 8) & 0x00FF);
        this.push(this.pc & 0x00FF);

        // The 6502 reads the high byte of the target only after the pushes,
        // which matters if the push overwrote it (code running in the stack page)
        this.addrAbs = (this.read(this.pc) << 8) | (this.addrAbs & 0x00FF);

        this.pc = this.addrAbs;
        return 0;
    }
    /** Instruction: Load The Accumulator */
    LDA(): number {
        this.fetch();
        this.a = this.fetched;
        this.setZN(this.a);
        return 1;
    }
    /** Instruction: Load The X Register */
    LDX(): number {
        this.fetch();
        this.x = this.fetched;
        this.setZN(this.x);
        return 1;
    }
    /** Instruction: Load The Y Register */
    LDY(): number {
        this.fetch();
        this.y = this.fetched;
        this.setZN(this.y);
        return 1;
    }
    /** Instruction: Logical Shift Right */
    LSR(): number {
        this.fetch();
        this.c = this.fetched & 0x0001;
        const temp = this.fetched >> 1;
        this.setZN(temp);
        if (this.mode === 'IMP') {
            this.a = temp & 0x00FF;
        } else {
            this.write(this.addrAbs, temp & 0x00FF);
        }
        return 0;
    }
    // The unofficial NOPs with an operand read it, and the absolute,X ones take a cycle
    // more when crossing a page
    NOP(): number {
        this.fetch();
        return 1;
    }
    /** Instruction: Bitwise Logic OR */
    ORA(): number {
        this.fetch();
        this.a = this.a | this.fetched;
        this.setZN(this.a);
        return 1;
    }
    /**  Instruction: Add with Carry In */
    ADC(): number {
        this.fetch();
        return this.addWithCarry(this.fetched);
    }
    /** Instruction: Subtraction with Borrow In */
    SBC(): number {
        this.fetch();
        // A - M - (1 - C) is the same as A + ~M + C
        return this.addWithCarry(this.fetched ^ 0x00FF);
    }
    // No decimal mode, the NES CPU doesn't have one
    addWithCarry(value: number): number {
        const temp = this.a + value + this.c;
        this.c = temp > 0xFF ? 1 : 0;
        // Overflow when both operands have the same sign and the result's sign differs
        this.v = (~(this.a ^ value) & (this.a ^ temp) & 0x0080) !== 0 ? 1 : 0;
        this.a = temp & 0x00FF;
        this.setZN(this.a);
        return 1;
    }
    /** Instruction: Push Accumulator to Stack */
    PHA(): number {
        this.push(this.a);
        return 0;
    }
    /** Instruction: Push Status Register to Stack */
    PHP(): number {
        // Status is pushed with the B flag set
        this.push(this.getFlags() | Flag.B | Flag.U);
        return 0;
    }
    /** Instruction: Pop Accumulator off Stack */
    PLA(): number {
        this.a = this.pull();
        this.setZN(this.a);
        return 0;
    }
    /** Instruction: Pop Status Register off Stack */
    PLP(): number {
        this.setFlags(this.pull());
        // B only exists on the stack and U always reads as set
        this.b = 0;
        this.u = 1;
        return 0;
    }
    /** Instruction: Rotate Left */
    ROL(): number {
        this.fetch();
        const temp = (this.fetched << 1) | this.c;
        this.c = (temp & 0xFF00) !== 0 ? 1 : 0;
        this.setZN(temp);
        if (this.mode === 'IMP') {
            this.a = temp & 0x00FF;
        } else {
            this.write(this.addrAbs, temp & 0x00FF);
        }
        return 0;
    }
    /** Instruction: Rotate Right */
    ROR(): number {
        this.fetch();
        const temp = (this.c << 7) | (this.fetched >> 1);
        this.c = this.fetched & 0x01;
        this.setZN(temp);
        if (this.mode === 'IMP') {
            this.a = temp & 0x00FF;
        } else {
            this.write(this.addrAbs, temp & 0x00FF);
        }
        return 0;
    }
    /** Instruction: Return from Interrupt */
    RTI(): number {
        this.setFlags(this.pull());
        // B only exists on the stack and U always reads as set
        this.b = 0;
        this.u = 1;

        this.pc = this.pull();
        this.pc |= this.pull() << 8;
        return 0;
    }
    /** Instruction: Return from Sub-Routine */
    RTS(): number {
        this.pc = this.pull();
        this.pc |= this.pull() << 8;

        this.pc++;
        return 0;
    }
    /** Instruction: Set Carry Flag */
    SEC(): number {
        this.c = 1;
        return 0;
    }
    /** Set Decimal Flag */
    SED(): number {
        this.d = 1;
        return 0;
    }
    /** Set Interrupt Flag / Enable Interrupts */
    SEI(): number {
        this.i = 1;
        return 0;
    }
    /** Instruction: Store Accumulator at Address */
    STA(): number {
        this.write(this.addrAbs, this.a);
        return 0;
    }
    /** Store X Register at Address */
    STX(): number {
        this.write(this.addrAbs, this.x);
        return 0;
    }
    /** Instruction: Store Y Register at Address */
    STY(): number {
        this.write(this.addrAbs, this.y);
        return 0;
    }
    /** Instruction: Transfer Accumulator to X Register */
    TAX(): number {
        this.x = this.a;
        this.setZN(this.x);
        return 0;
    }
    /** Instruction: Transfer Accumulator to Y Register */
    TAY(): number {
        this.y = this.a;
        this.setZN(this.y);
        return 0;
    }
    /** Instruction: Transfer Stack Pointer to X Register */
    TSX(): number {
        this.x = this.stkp;
        this.setZN(this.x);
        return 0;
    }
    /**  Instruction: Transfer X Register to Accumulator */
    TXA(): number {
        this.a = this.x;
        this.setZN(this.a);
        return 0;
    }
    /** Instruction: Transfer X Register to Stack Pointer */
    TXS(): number {
        this.stkp = this.x;
        return 0;
    }
    /** Instruction: Transfer Y Register to Accumulator */
    TYA(): number {
        this.a = this.y;
        this.setZN(this.a);
        return 0;
    }
    // Unofficial instructions, see https://www.nesdev.org/wiki/CPU_unofficial_opcodes

    // Read-modify-write followed by an ALU operation, which reads the value just written
    SLO(): number {
        this.ASL();
        this.ORA();
        return 0;
    }
    RLA(): number {
        this.ROL();
        this.AND();
        return 0;
    }
    SRE(): number {
        this.LSR();
        this.EOR();
        return 0;
    }
    RRA(): number {
        this.ROR();
        this.ADC();
        return 0;
    }
    DCP(): number {
        this.DEC();
        this.CMP();
        return 0;
    }
    ISC(): number {
        this.INC();
        this.SBC();
        return 0;
    }
    LAX(): number {
        this.fetch();
        this.a = this.fetched;
        this.x = this.fetched;
        this.setZN(this.a);
        return 1;
    }
    SAX(): number {
        this.write(this.addrAbs, this.a & this.x);
        return 0;
    }
    ANC(): number {
        this.AND();
        this.c = this.n;
        return 0;
    }
    ALR(): number {
        this.fetch();
        const value = this.a & this.fetched;
        this.c = value & 0x01;
        this.a = value >> 1;
        this.setZN(this.a);
        return 0;
    }
    ARR(): number {
        this.fetch();
        this.a = ((this.a & this.fetched) >> 1) | (this.c << 7);
        this.setZN(this.a);
        this.c = (this.a >> 6) & 0x01;
        this.v = ((this.a >> 6) ^ (this.a >> 5)) & 0x01;
        return 0;
    }
    // X = (A & X) - M, setting the flags like CMP
    AXS(): number {
        this.fetch();
        const value = this.a & this.x;
        this.c = value >= this.fetched ? 1 : 0;
        this.x = (value - this.fetched) & 0xFF;
        this.setZN(this.x);
        return 0;
    }
    LAS(): number {
        this.fetch();
        const value = this.fetched & this.stkp;
        this.a = value;
        this.x = value;
        this.stkp = value;
        this.setZN(value);
        return 1;
    }
    // A = X = (A | magic) & M
    LXA(): number {
        this.fetch();
        this.a = (this.a | LXA_MAGIC) & this.fetched;
        this.x = this.a;
        this.setZN(this.a);
        return 0;
    }
    XAA(): number {
        this.fetch();
        this.a = (this.a | XAA_MAGIC) & this.x & this.fetched;
        this.setZN(this.a);
        return 0;
    }
    // Stores the value ANDed with (high byte of the base address + 1). When the index crosses
    // a page, that result also replaces the high byte of the address.
    private storeAndHigh(value: number, index: number): void {
        const base = (this.addrAbs - index) & 0xFFFF;
        const result = value & ((base >> 8) + 1) & 0xFF;
        let addr = this.addrAbs;
        if ((base & 0xFF00) !== (addr & 0xFF00)) addr = (result << 8) | (addr & 0x00FF);
        this.write(addr, result);
    }
    SHY(): number {
        this.storeAndHigh(this.y, this.x);
        return 0;
    }
    SHX(): number {
        this.storeAndHigh(this.x, this.y);
        return 0;
    }
    SHA(): number {
        this.storeAndHigh(this.a & this.x, this.y);
        return 0;
    }
    TAS(): number {
        this.stkp = this.a & this.x;
        this.storeAndHigh(this.stkp, this.y);
        return 0;
    }
    // Locks up the CPU until reset
    JAM(): number {
        this.pc = (this.pc - 1) & 0xFFFF;
        return 0;
    }

    ///////////////////////////////////////////////////////////////////////////////

    // Helper functions
    complete(): boolean {
        return this.cycles === 0 || Number.isNaN(this.cycles);
    }

    // Each instruction's text by its address, reading without side effects
    disassemble(start: number, stop: number): Map<number, string> {
        const lines = new Map<number, string>();
        const read = (addr: number) => this.bus.cpuRead(addr, true);
        let addr = start;
        const byte = () => hex(read(addr++), 2);
        const word = () => {
            const value = read(addr) | (read(addr + 1) << 8);
            addr += 2;
            return hex(value, 4);
        };
        while (addr <= stop) {
            const lineAddr = addr;
            const [mnemonic, mode] = instructions[read(addr++)];
            let operand = '';
            switch (mode) {
                case 'IMP': break;
                case 'IMM': operand = `#$${byte()}`; break;
                case 'ZP0': operand = `$${byte()}`; break;
                case 'ZPX': operand = `$${byte()}, X`; break;
                case 'ZPY': operand = `$${byte()}, Y`; break;
                case 'IZX': operand = `($${byte()}, X)`; break;
                case 'IZY': operand = `($${byte()}), Y`; break;
                case 'ABS': operand = `$${word()}`; break;
                case 'ABX': operand = `$${word()}, X`; break;
                case 'ABY': operand = `$${word()}, Y`; break;
                case 'IND': operand = `($${word()})`; break;
                case 'REL': {
                    const offset = read(addr++);
                    operand = `$${hex(offset, 2)} [$${hex(addr + convertUint8ToInt(offset), 4)}]`;
                    break;
                }
            }
            lines.set(lineAddr, `$${hex(lineAddr, 4)}: ${mnemonic} ${operand} {${mode}}`);
        }
        return lines;
    }
}

export default Cpu;

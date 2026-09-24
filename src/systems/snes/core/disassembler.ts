// Disassembles 65816 code. The size of immediate operands depends on the M and X flags, so the
// decoder follows REP and SEP along the way.

import { MNEMONICS } from './cpu';

// Addressing modes, by opcode
const MODES = (
    'sig dpxi sig sr dp dp dp dpil imp immm acc imp abs abs abs long ' +
    'rel dpiy dpi sriy dp dpx dpx dpily imp absy acc imp abs absx absx longx ' +
    'abs dpxi long sr dp dp dp dpil imp immm acc imp abs abs abs long ' +
    'rel dpiy dpi sriy dpx dpx dpx dpily imp absy acc imp absx absx absx longx ' +
    'imp dpxi imm8 sr blk dp dp dpil imp immm acc imp abs abs abs long ' +
    'rel dpiy dpi sriy blk dpx dpx dpily imp absy imp imp long absx absx longx ' +
    'imp dpxi rell sr dp dp dp dpil imp immm acc imp absi abs abs long ' +
    'rel dpiy dpi sriy dpx dpx dpx dpily imp absy imp imp absxi absx absx longx ' +
    'rel dpxi rell sr dp dp dp dpil imp immm imp imp abs abs abs long ' +
    'rel dpiy dpi sriy dpx dpx dpy dpily imp absy imp imp abs absx absx longx ' +
    'immx dpxi immx sr dp dp dp dpil imp immm imp imp abs abs abs long ' +
    'rel dpiy dpi sriy dpx dpx dpy dpily imp absy imp imp absx absx absy longx ' +
    'immx dpxi imm8 sr dp dp dp dpil imp immm imp imp abs abs abs long ' +
    'rel dpiy dpi sriy dpi dpx dpx dpily imp absy imp imp absil absx absx longx ' +
    'immx dpxi imm8 sr dp dp dp dpil imp immm imp imp abs abs abs long ' +
    'rel dpiy dpi sriy abs dpx dpx dpily imp absy imp imp absxi absx absx longx'
).split(' ');

export interface DisassembledInstruction {
    address: number;
    size: number;
    text: string;
}

export interface DecodeFlags {
    // 8-bit accumulator and memory, 8-bit index registers
    m: boolean;
    x: boolean;
}

const hex = (value: number, digits: number) => value.toString(16).toUpperCase().padStart(digits, '0');

// Decodes the instruction at a 24-bit address, and updates the flags for REP and SEP
export function disassemble(read: (addr: number) => number, address: number, flags: DecodeFlags): DisassembledInstruction {
    const bank = address & 0xFF0000;
    const byte = (n: number) => read(bank | ((address + n) & 0xFFFF));
    const opcode = byte(0);
    const mode = MODES[opcode];
    const b1 = byte(1);
    const w = b1 | (byte(2) << 8);
    const l = w | (byte(3) << 16);

    let size = 1;
    let operand = '';
    switch (mode) {
        case 'imp': break;
        case 'acc': operand = 'A'; break;
        case 'sig': case 'imm8': size = 2; operand = `#$${hex(b1, 2)}`; break;
        case 'immm':
            size = flags.m ? 2 : 3;
            operand = flags.m ? `#$${hex(b1, 2)}` : `#$${hex(w, 4)}`;
            break;
        case 'immx':
            size = flags.x ? 2 : 3;
            operand = flags.x ? `#$${hex(b1, 2)}` : `#$${hex(w, 4)}`;
            break;
        case 'dp': size = 2; operand = `$${hex(b1, 2)}`; break;
        case 'dpx': size = 2; operand = `$${hex(b1, 2)},X`; break;
        case 'dpy': size = 2; operand = `$${hex(b1, 2)},Y`; break;
        case 'dpi': size = 2; operand = `($${hex(b1, 2)})`; break;
        case 'dpxi': size = 2; operand = `($${hex(b1, 2)},X)`; break;
        case 'dpiy': size = 2; operand = `($${hex(b1, 2)}),Y`; break;
        case 'dpil': size = 2; operand = `[$${hex(b1, 2)}]`; break;
        case 'dpily': size = 2; operand = `[$${hex(b1, 2)}],Y`; break;
        case 'sr': size = 2; operand = `$${hex(b1, 2)},S`; break;
        case 'sriy': size = 2; operand = `($${hex(b1, 2)},S),Y`; break;
        case 'abs': size = 3; operand = `$${hex(w, 4)}`; break;
        case 'absx': size = 3; operand = `$${hex(w, 4)},X`; break;
        case 'absy': size = 3; operand = `$${hex(w, 4)},Y`; break;
        case 'absi': size = 3; operand = `($${hex(w, 4)})`; break;
        case 'absxi': size = 3; operand = `($${hex(w, 4)},X)`; break;
        case 'absil': size = 3; operand = `[$${hex(w, 4)}]`; break;
        case 'long': size = 4; operand = `$${hex(l, 6)}`; break;
        case 'longx': size = 4; operand = `$${hex(l, 6)},X`; break;
        case 'blk': size = 3; operand = `$${hex(byte(2), 2)},$${hex(b1, 2)}`; break;
        case 'rel': {
            size = 2;
            const target = (address + 2 + ((b1 << 24) >> 24)) & 0xFFFF;
            operand = `$${hex(target, 4)}`;
            break;
        }
        case 'rell': {
            size = 3;
            const target = (address + 3 + ((w << 16) >> 16)) & 0xFFFF;
            operand = `$${hex(target, 4)}`;
            break;
        }
    }

    // REP and SEP change the size of the following immediates
    if (opcode === 0xC2) {
        if (b1 & 0x20) flags.m = false;
        if (b1 & 0x10) flags.x = false;
    } else if (opcode === 0xE2) {
        if (b1 & 0x20) flags.m = true;
        if (b1 & 0x10) flags.x = true;
    }

    const bytes = Array.from({ length: size }, (_, n) => hex(byte(n), 2)).join(' ');
    return {
        address,
        size,
        text: `$${hex(address >> 16, 2)}:${hex(address & 0xFFFF, 4)}  ${bytes.padEnd(12)}${MNEMONICS[opcode]} ${operand}`.trimEnd(),
    };
}

// Instructions from an address on
export function disassembleFrom(read: (addr: number) => number, address: number, flags: DecodeFlags, count: number): DisassembledInstruction[] {
    const decodeFlags = { ...flags };
    const lines: DisassembledInstruction[] = [];
    for (let i = 0; i < count; i++) {
        const line = disassemble(read, address, decodeFlags);
        lines.push(line);
        address = (address & 0xFF0000) | ((address + line.size) & 0xFFFF);
    }
    return lines;
}

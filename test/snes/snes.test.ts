import { describe, expect, test } from 'bun:test';
import SnesCartridge from '../../src/systems/snes/core/cartridge';
import { CYCLES_PER_LINE, LINES_PER_FRAME } from '../../src/systems/snes/core/io';
import Snes from '../../src/systems/snes/core/snes';
import { buildRom } from './helpers';

// LoROM offsets of $8000 (the reset vector), $9000 and the emulation mode vectors
const MAIN = 0x0000;
const HANDLER = 0x1000;
const NMI_VECTOR = 0x7FFA;
const IRQ_VECTOR = 0x7FFE;

function boot(patches: Record<number, number[]>): Snes {
    const rom = buildRom({ patches });
    const snes = new Snes(new SnesCartridge(rom.buffer as ArrayBuffer));
    snes.reset();
    return snes;
}

function runFrames(snes: Snes, frames: number): void {
    for (let i = 0; i < frames; i++) snes.runFrame();
}

// Runs a little further, so an interrupt raised at the end of a frame is handled
function settle(snes: Snes): void {
    for (let i = 0; i < 50; i++) snes.step();
}

describe('SNES system', () => {
    test('takes an NMI every frame', () => {
        const snes = boot({
            [MAIN]: [
                0x78,                   // SEI
                0xA9, 0x80,             // LDA #$80
                0x8D, 0x00, 0x42,       // STA NMITIMEN
                0x80, 0xFE,             // BRA *
            ],
            [HANDLER]: [
                0xEE, 0x00, 0x00,       // INC $0000
                0xAD, 0x10, 0x42,       // LDA RDNMI
                0x40,                   // RTI
            ],
            [NMI_VECTOR]: [0x00, 0x90],
        });
        runFrames(snes, 5);
        settle(snes);
        expect(snes.bus.wram[0]).toBe(5);
    });

    test('a frame takes 262 lines of master cycles', () => {
        const snes = boot({ [MAIN]: [0x80, 0xFE] });
        snes.runFrame();
        const start = snes.bus.cycles;
        snes.runFrame();
        const frame = snes.bus.cycles - start;
        // Instructions don't end exactly on the line boundary
        expect(Math.abs(frame - CYCLES_PER_LINE * LINES_PER_FRAME)).toBeLessThan(30);
    });

    test('WAI sleeps until the NMI', () => {
        const snes = boot({
            [MAIN]: [
                0xA9, 0x80,             // LDA #$80
                0x8D, 0x00, 0x42,       // STA NMITIMEN
                0xCB,                   // WAI
                0xEE, 0x01, 0x00,       // INC $0001
                0x80, 0xFA,             // BRA WAI
            ],
            [HANDLER]: [
                0xAD, 0x10, 0x42,       // LDA RDNMI
                0x40,                   // RTI
            ],
            [NMI_VECTOR]: [0x00, 0x90],
        });
        runFrames(snes, 3);
        settle(snes);
        expect(snes.bus.wram[1]).toBe(3);
    });

    test('takes a V IRQ once per frame', () => {
        const snes = boot({
            [MAIN]: [
                0xA9, 100,              // LDA #100
                0x8D, 0x09, 0x42,       // STA VTIMEL
                0x9C, 0x0A, 0x42,       // STZ VTIMEH
                0xA9, 0x20,             // LDA #$20
                0x8D, 0x00, 0x42,       // STA NMITIMEN
                0x58,                   // CLI
                0x80, 0xFE,             // BRA *
            ],
            [HANDLER]: [
                0xEE, 0x02, 0x00,       // INC $0002
                0xAD, 0x11, 0x42,       // LDA TIMEUP
                0x40,                   // RTI
            ],
            [IRQ_VECTOR]: [0x00, 0x90],
        });
        runFrames(snes, 4);
        expect(snes.bus.wram[2]).toBe(4);
    });

    test('an IRQ with interrupts disabled only wakes WAI', () => {
        const snes = boot({
            [MAIN]: [
                0x78,                   // SEI
                0xA9, 100,              // LDA #100
                0x8D, 0x09, 0x42,       // STA VTIMEL
                0x9C, 0x0A, 0x42,       // STZ VTIMEH
                0xA9, 0x20,             // LDA #$20
                0x8D, 0x00, 0x42,       // STA NMITIMEN
                0xCB,                   // WAI
                0xAD, 0x11, 0x42,       // LDA TIMEUP
                0xEE, 0x03, 0x00,       // INC $0003
                0x80, 0xF7,             // BRA WAI
            ],
            [HANDLER]: [0xEE, 0x04, 0x00, 0x40],
            [IRQ_VECTOR]: [0x00, 0x90],
        });
        runFrames(snes, 3);
        expect(snes.bus.wram[3]).toBe(3);
        expect(snes.bus.wram[4]).toBe(0);
    });

    test('keeps time after STP', () => {
        const snes = boot({ [MAIN]: [0xDB] });
        runFrames(snes, 2);
        expect(snes.cpu.stopped).toBe(true);
        expect(snes.bus.io.frame).toBe(1);
    });

    test('reads the controller through auto joypad read', () => {
        const snes = boot({
            [MAIN]: [
                0xA9, 0x81,             // LDA #$81
                0x8D, 0x00, 0x42,       // STA NMITIMEN
                0x80, 0xFE,             // BRA *
            ],
            [HANDLER]: [
                0xAD, 0x12, 0x42,       // LDA HVBJOY
                0x29, 0x01,             // AND #$01
                0xD0, 0xF9,             // BNE wait until done
                0xAD, 0x19, 0x42,       // LDA JOY1H
                0x8D, 0x05, 0x00,       // STA $0005
                0xAD, 0x10, 0x42,       // LDA RDNMI
                0x40,                   // RTI
            ],
            [NMI_VECTOR]: [0x00, 0x90],
        });
        snes.bus.io.controllers[0].buttons = 0x8000 | 0x1000;
        runFrames(snes, 2);
        settle(snes);
        for (let i = 0; i < 1000 && snes.bus.wram[5] === 0; i++) snes.step();
        expect(snes.bus.wram[5]).toBe(0x90);
    });
});

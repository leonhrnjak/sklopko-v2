//! The clock, the keypad, the pixel screen and the text console.

use super::util::*;
use super::kind::*;
use super::Cell;
use super::Shared;
use super::{CONSOLE_EVENT_LIMIT, FB_SIZE, VIDEO_BYTES, VIDEO_REGS};

#[allow(unused_variables)]
#[inline(always)]
pub fn eval(kind: i32, c: &mut Cell, sh: &mut Shared) {
    let ins = c.ins;
    let outs = &mut *c.outs;
    let no = c.no;
    match kind {
        CLOCK => outs[0] = *c.q,
        KEYPAD => {
            // p0: sticky, p1: the key pressed last, p2: a key is held. st_pc: held at the last look, st_q: latched.
            let pressed = c.p2 == 1;
            if pressed && *c.pc == 0 { *c.q = 1; }
            *c.pc = pressed as u8;
            if ins[0] == 1 { *c.q = 0; }
            let key = c.p1;
            for b in 0..4 { outs[b] = ((key >> b) & 1) as u8; }
            outs[4] = if c.p0 == 1 { *c.q } else { pressed as u8 };
        }
        FRAMEBUFFER => {
            // p0: bits per pixel (1 or 2), p1: 1 if a pixel can be read back.
            let nd = c.p0 as usize;
            let we = ins[8 + nd];
            let clr = ins[9 + nd];
            let clk = ins[10 + nd];
            let edge = *c.pc == 0 && clk == 1;
            *c.pc = clk;
            let base = c.mem_off;
            if clr == 1 {
                for p in &mut sh.fb[base..base + FB_SIZE * FB_SIZE] { *p = 0; }
            } else if edge && we == 1 {
                let x = to_num(ins, 0, 4);
                let y = to_num(ins, 4, 4);
                let d = to_num(ins, 8, nd);
                if x >= 0 && y >= 0 && d >= 0 {
                    sh.fb[base + y as usize * FB_SIZE + x as usize] = d as u8;
                }
            }
            if c.p1 == 1 {
                let rx = to_num(ins, 11 + nd, 4);
                let ry = to_num(ins, 15 + nd, 4);
                if rx < 0 || ry < 0 {
                    for b in 0..nd { outs[b] = X; }
                } else {
                    write_num(outs, 0, nd, sh.fb[base + ry as usize * FB_SIZE + rx as usize] as i32);
                }
            }
        }
        CONSOLE => {
            let clk = ins[9];
            let edge = *c.pc == 0 && clk == 1;
            *c.pc = clk;
            if edge && ins[8] == 1 {
                let code = to_num(ins, 0, 8);
                if code >= 0 {
                    let con = &mut sh.consoles[c.mem_off];
                if con.events.len() >= CONSOLE_EVENT_LIMIT { con.events.remove(0); }
                con.events.push(code as u16);
                }
            }
        }
        VIDEO => {
            // The video chip: `ins` are PHI2, RESB, CS0, CS1B, RS0..RS3, RWB, DI0..7. The part's number packs the address register (bits 0 to 15), the
            // hold flag (bit 16) and what the data pins show (bits 24 to 31). Like the other chips of a board, it answers at the rising edge of PHI2.
            // After the picture's bytes come the column-fill registers: x, top, bottom, colour, width, sky, floor.
            let phi2 = ins[0];
            let rising = *c.pc == 0 && phi2 == 1;
            if phi2 <= 1 { *c.pc = phi2; }
            let packed = *c.n as u32;
            let mut addr = (packed & 0xffff) as usize;
            let mut hold = (packed >> 16) & 1;
            let mut out = packed >> 24;
            let base = c.mem_off;
            let regs = base + VIDEO_BYTES;
            if ins[1] == 0 {
                addr = 0;
                hold = 0;
                out = 0;
                for k in 0..VIDEO_REGS { sh.fb[regs + k] = 0; }
                sh.fb[regs + 4] = 1;
            } else if rising {
                out = 0;
                if ins[2] == 1 && ins[3] == 0 && ins[4] <= 1 && ins[5] <= 1 && ins[6] <= 1 && ins[7] <= 1 {
                    let rs = (ins[4] | (ins[5] << 1) | (ins[6] << 2) | (ins[7] << 3)) as usize;
                    let at = addr % VIDEO_BYTES;
                    if ins[8] == 1 {
                        out = match rs {
                            0 => (addr & 255) as u32,
                            1 => (addr >> 8) as u32,
                            2 => {
                                let v = sh.fb[base + at] as u32;
                                if hold == 0 { addr = (at + 1) % VIDEO_BYTES; }
                                v
                            }
                            3 => hold,
                            4..=10 => sh.fb[regs + rs - 4] as u32,
                            _ => 0,
                        };
                    } else if ins[8] == 0 {
                        let d = to_num(ins, 9, 8);
                        if d >= 0 {
                            let d = d as usize;
                            match rs {
                                0 => addr = (addr & 0xff00) | d,
                                1 => addr = (addr & 0x00ff) | (d << 8),
                                2 => {
                                    sh.fb[base + at] = d as u8;
                                    if hold == 0 { addr = (at + 1) % VIDEO_BYTES; }
                                }
                                3 => {
                                    hold = (d & 1) as u32;
                                    if d & 0x80 != 0 { for p in &mut sh.fb[base..base + VIDEO_BYTES] { *p = 0; } }
                                }
                                4..=10 => {
                                    sh.fb[regs + rs - 4] = d as u8;
                                    // Writing the colour starts the fill: `width` columns from x, each sky above `top`, the colour from `top` to `bottom`, floor below.
                                    if rs == 7 {
                                        let (x, top, bottom) = (sh.fb[regs] as usize, sh.fb[regs + 1] as usize, sh.fb[regs + 2] as usize);
                                        let (col, width) = ((d & 15) as u8, sh.fb[regs + 4] as usize);
                                        let (sky, floor) = (sh.fb[regs + 5] & 15, sh.fb[regs + 6] & 15);
                                        let px = |y: usize| if y < top { sky } else if y < bottom { col } else { floor };
                                        for k in 0..width {
                                            let column = base + ((x + k) % 160) * 50;
                                            for j in 0..50 { sh.fb[column + j] = (px(2 * j) << 4) | px(2 * j + 1); }
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
            *c.n = (addr as u32 | (hold << 16) | (out << 24)) as i32;
            for b in 0..8 { outs[b] = ((out >> b) & 1) as u8; }
        }
        NETRECV => outs[0] = X,
        _ => {}
    }
}

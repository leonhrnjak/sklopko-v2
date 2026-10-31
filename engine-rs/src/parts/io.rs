//! The clock, the keypad, the pixel screen and the text console.

use super::util::*;
use super::kind::*;
use super::Cell;
use super::Shared;
use super::{CONSOLE_EVENT_LIMIT, FB_SIZE};

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
        _ => {}
    }
}

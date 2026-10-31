//! Parts that work on a bus of bits: multiplexer, adder, register, counter, gates, comparator.

use super::util::*;
use super::kind::*;
use super::Cell;
use super::util::{and2, or2, xor2};

// busgate operations (p1)
const G_AND: i32 = 0;
const G_OR: i32 = 1;
const G_XOR: i32 = 2;
const G_NAND: i32 = 3;
const G_NOR: i32 = 4;
const G_XNOR: i32 = 5;

#[allow(unused_variables)]
#[inline(always)]
pub fn eval(kind: i32, c: &mut Cell) {
    let ins = c.ins;
    let outs = &mut *c.outs;
    let no = c.no;
    match kind {
        BUSMUX => {
            let w = c.p0 as usize;
            let k = c.p1 as usize;
            let sel = c.p2 as usize;
            let s = to_num(ins, w * k, sel);
            if s < 0 {
                for b in 0..w { outs[b] = X; }
            } else {
                let s = s as usize;
                for b in 0..w { outs[b] = ins[s * w + b]; }
            }
        }
        BUSADD => {
            let n = c.p0 as usize;
            if ins.iter().any(|&v| v == X) {
                for b in 0..=n { outs[b] = X; }
            } else {
                let a = to_num(ins, 0, n);
                let b = to_num(ins, n, n);
                let sum = a + b + ins[2 * n] as i32;
                for k in 0..=n { outs[k] = ((sum >> k) & 1) as u8; }
            }
        }
        BUSREG => {
            let n = c.p0 as usize;
            let pc = *c.pc;
            let clk = ins[n + 1];
            let edge = pc == 0 && clk == 1;
            *c.pc = clk;
            if ins[n + 2] == 1 {
                *c.n = 0;
            } else if edge && ins[n] == 1 {
                *c.n = to_num(ins, 0, n);
            }
            write_num(outs, 0, n, *c.n);
        }
        BUSCTR => {
            let n = c.p0 as usize;
            let mask = (1i32 << n) - 1;
            let ld = ins[n];
            let en = ins[n + 1];
            let r = ins[n + 3];
            let clk = ins[n + 2];
            let edge = *c.pc == 0 && clk == 1;
            *c.pc = clk;
            if r == 1 {
                *c.n = 0;
            } else if edge {
                if ld == 1 {
                    let d = to_num(ins, 0, n);
                    if d >= 0 { *c.n = d; }
                } else if ld == 0 && en == 1 {
                    *c.n = (*c.n + 1) & mask;
                }
            }
            let st = *c.n;
            write_num(outs, 0, n, st);
            outs[n] = if en == X { X } else if st == mask && en == 1 { 1 } else { 0 };
        }
        BUSGATE => {
            let n = c.p0 as usize;
            let op = c.p1;
            for b in 0..n {
                let a = ins[b];
                outs[b] = match op {
                    G_AND => and2(a, ins[n + b]),
                    G_OR => or2(a, ins[n + b]),
                    G_XOR => xor2(a, ins[n + b]),
                    G_NAND => flip(and2(a, ins[n + b])),
                    G_NOR => flip(or2(a, ins[n + b])),
                    G_XNOR => flip(xor2(a, ins[n + b])),
                    _ => flip(a),
                };
            }
        }
        BUSCMP => {
            let n = c.p0 as usize;
            if ins.iter().any(|&v| v == X) {
                outs[0] = X; outs[1] = X; outs[2] = X;
            } else {
                let a = to_num(ins, 0, n);
                let b = to_num(ins, n, n);
                outs[0] = (a > b) as u8;
                outs[1] = (a == b) as u8;
                outs[2] = (a < b) as u8;
            }
        }
        _ => {}
    }
}

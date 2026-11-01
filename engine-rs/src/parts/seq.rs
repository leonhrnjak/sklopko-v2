//! Latches, flip-flops, counters, registers and the shift register.

use super::util::*;
use super::kind::*;
use super::Cell;

#[allow(unused_variables)]
#[inline(always)]
pub fn eval(kind: i32, c: &mut Cell) {
    let ins = c.ins;
    let outs = &mut *c.outs;
    let no = c.no;
    match kind {
        DFF => {
            let d = ins[0];
            let clk = ins[1];
            let s = ins[2];
            let r = ins[3];
            let edge = *c.pc == 0 && clk == 1;
            *c.pc = clk;
            if r == 1 { *c.q = 0; }
            else if s == 1 { *c.q = 1; }
            else if edge { *c.q = d; }
            let q = *c.q;
            outs[0] = q;
            outs[1] = flip(q);
        }
        TFF => {
            let t = ins[0];
            let clk = ins[1];
            let s = ins[2];
            let r = ins[3];
            let edge = *c.pc == 0 && clk == 1;
            *c.pc = clk;
            if r == 1 { *c.q = 0; }
            else if s == 1 { *c.q = 1; }
            else if edge {
                if t == X { *c.q = X; }
                else if t == 1 { *c.q = flip(*c.q); }
            }
            let q = *c.q;
            outs[0] = q;
            outs[1] = flip(q);
        }
        JKFF => {
            let (j, clk, k, s, r) = (ins[0], ins[1], ins[2], ins[3], ins[4]);
            let edge = *c.pc == 0 && clk == 1;
            *c.pc = clk;
            if r == 1 { *c.q = 0; }
            else if s == 1 { *c.q = 1; }
            else if edge {
                if j == X || k == X { *c.q = X; }
                else if j != 0 && k != 0 { *c.q = flip(*c.q); }
                else if j != 0 { *c.q = 1; }
                else if k != 0 { *c.q = 0; }
            }
            let q = *c.q;
            outs[0] = q;
            outs[1] = flip(q);
        }
        SRLATCH => {
            let s = ins[0];
            let r = ins[1];
            if s == 1 && r == 1 {
                outs[0] = 0;
                outs[1] = 0;
            } else {
                if s == 1 && r == 0 { *c.q = 1; }
                else if r == 1 && s == 0 { *c.q = 0; }
                let q = *c.q;
                outs[0] = q;
                outs[1] = flip(q);
            }
        }
        DLATCH => {
            if ins[1] == 1 { *c.q = ins[0]; }
            let q = *c.q;
            outs[0] = q;
            outs[1] = flip(q);
        }
        COUNTER => {
            let (clk, en, ud, r) = (ins[0], ins[1], ins[2], ins[3]);
            let m = c.p0;
            let edge = *c.pc == 0 && clk == 1;
            *c.pc = clk;
            let mut n = *c.n;
            if r == 1 { n = 0; }
            else if edge && en == 1 && ud != X {
                n = if ud != 0 { (n + 1) % m } else { (n + m - 1) % m };
            }
            n %= m;
            *c.n = n;
            write_num(outs, 0, 4, n);
            outs[4] = if en == X || ud == X { X } else if n == (if ud != 0 { m - 1 } else { 0 }) && en == 1 { 1 } else { 0 };
        }
        COUNTERLD => {
            let (ld, en, clk, r) = (ins[4], ins[5], ins[6], ins[7]);
            let edge = *c.pc == 0 && clk == 1;
            *c.pc = clk;
            if r == 1 { *c.n = 0; }
            else if edge {
                if ld == 1 {
                    let d = to_num(ins, 0, 4);
                    if d >= 0 { *c.n = d; }
                } else if ld == 0 && en == 1 {
                    *c.n = (*c.n + 1) & 15;
                }
            }
            let n = *c.n;
            write_num(outs, 0, 4, n);
            outs[4] = if en == X { X } else if n == 15 && en == 1 { 1 } else { 0 };
        }
        REGISTER => {
            let edge = *c.pc == 0 && ins[5] == 1;
            *c.pc = ins[5];
            if ins[6] == 1 { *c.n = 0; }
            else if edge && ins[4] == 1 { *c.n = to_num(ins, 0, 4); }
            write_num(outs, 0, 4, *c.n);
        }
        SHIFTREG => {
            // The four bits are kept two bits each in st_n (a bit can be 0, 1, X or Z).
            let edge = *c.pc == 0 && ins[6] == 1;
            *c.pc = ins[6];
            let mut b = *c.n;
            let bit = |b: i32, k: i32| (b >> (2 * k)) & 3;
            if ins[7] == 1 { b = 0; }
            else if edge {
                if ins[5] == 1 {
                    b = ins[1] as i32 | (ins[2] as i32) << 2 | (ins[3] as i32) << 4 | (ins[4] as i32) << 6;
                } else if ins[5] == 0 {
                    b = ins[0] as i32 | bit(b, 0) << 2 | bit(b, 1) << 4 | bit(b, 2) << 6;
                }
            }
            *c.n = b;
            for k in 0..4 { outs[k] = bit(b, k as i32) as u8; }
        }
        RINGCOUNTER => {
            // The four bits are kept two bits each in st_n, as in the shift register. p0: 1 for a Johnson counter.
            let edge = *c.pc == 0 && ins[0] == 1;
            *c.pc = ins[0];
            let mut b = *c.n;
            let bit = |b: i32, k: i32| (b >> (2 * k)) & 3;
            if ins[1] == 1 {
                b = if c.p0 == 1 { 0 } else { 1 };
            } else if edge {
                let last = bit(b, 3) as u8;
                let first = if c.p0 == 1 { flip(last) as i32 } else { last as i32 };
                b = first | bit(b, 0) << 2 | bit(b, 1) << 4 | bit(b, 2) << 6;
            }
            *c.n = b;
            for k in 0..4 { outs[k] = bit(b, k as i32) as u8; }
        }
        _ => {}
    }
}

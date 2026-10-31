//! Logic gates and the multiplexer.

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
        AND | NAND => {
            let mut r = 1u8;
            for &v in ins {
                if v == 0 { r = 0; break; }
                if v == X { r = X; }
            }
            outs[0] = if kind == NAND { flip(r) } else { r };
        }
        OR | NOR => {
            let mut r = 0u8;
            for &v in ins {
                if v == 1 { r = 1; break; }
                if v == X { r = X; }
            }
            outs[0] = if kind == NOR { flip(r) } else { r };
        }
        XOR | XNOR => {
            let mut r = 0u8;
            for &v in ins {
                if v == X { r = X; break; }
                r ^= v;
            }
            outs[0] = if kind == XNOR { flip(r) } else { r };
        }
        NOT => outs[0] = flip(ins[0]),
        BUF => outs[0] = ins[0],
        MUX => {
            let n = c.p0 as usize;
            let k = c.p1 as usize;
            let mut s = 0usize;
            let mut bad = false;
            for b in 0..k {
                let v = ins[n + k - 1 - b];
                if v == X { bad = true; break; }
                s |= (v as usize) << b;
            }
            outs[0] = if bad { X } else { ins[s] };
        }
        _ => {}
    }
}

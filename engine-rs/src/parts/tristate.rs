//! The tri-state buffer and the bus junction (a line several parts drive, one at a time).

use super::kind::*;
use super::util::{X, Z};
use super::Cell;

#[inline(always)]
pub fn eval(kind: i32, c: &mut Cell) {
    let ins = c.ins;
    let outs = &mut *c.outs;
    match kind {
        TRIBUF => {
            // p0: bits. The enable follows the data.
            let n = c.p0 as usize;
            let en = ins[n];
            for i in 0..n {
                outs[i] = if en == 1 { ins[i] } else if en == 0 { Z } else { X };
            }
        }
        BUSJOIN => {
            // p0: bits, p1: drivers, p2: what it reads with no driver (0 floats, 1 pulled down, 2 pulled up).
            let n = c.p0 as usize;
            let d = c.p1 as usize;
            for bit in 0..n {
                let mut value = Z;
                let mut clash = false;
                for i in 0..d {
                    let v = ins[i * n + bit];
                    if v == Z { continue; }
                    if value == Z { value = v; } else if v != value { clash = true; }
                    if v == X { clash = true; }
                }
                outs[bit] = if clash {
                    X
                } else if value != Z {
                    value
                } else {
                    match c.p2 { 1 => 0, 2 => 1, _ => X }
                };
            }
        }
        _ => {}
    }
}

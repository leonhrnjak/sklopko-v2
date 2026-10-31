//! The 6551-style terminal part.

use super::kind::*;
use super::Cell;
use super::Shared;

#[allow(unused_variables)]
#[inline(always)]
pub fn eval(kind: i32, c: &mut Cell, sh: &mut Shared) {
    let ins = c.ins;
    let outs = &mut *c.outs;
    let no = c.no;
    match kind {
        ACIA => {
            let a = &mut sh.acias[c.mem_off];
            a.evaluate(ins);
            let d = a.out();
            for b in 0..8 {
                outs[b] = (d >> b) & 1;
            }
            outs[8] = if a.irq() { 0 } else { 1 };
        }
        _ => {}
    }
}

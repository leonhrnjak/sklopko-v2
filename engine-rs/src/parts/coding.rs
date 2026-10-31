//! Decoders, encoders and number conversions.

use super::util::*;
use super::kind::*;
use super::Cell;
use super::SEG_HEX;

#[allow(unused_variables)]
#[inline(always)]
pub fn eval(kind: i32, c: &mut Cell) {
    let ins = c.ins;
    let outs = &mut *c.outs;
    let no = c.no;
    match kind {
        DECODER => {
            if ins.iter().any(|&v| v == X) { for b in 0..no { outs[b] = X; } }
            else {
                let k = c.p0 as usize;
                let a = to_num(ins, 0, k);
                for b in 0..no { outs[b] = (ins[k] == 1 && b as i32 == a) as u8; }
            }
        }
        ENCODER => {
            if ins.iter().any(|&v| v == X) { for b in 0..no { outs[b] = X; } }
            else {
                let hi = ins.iter().rposition(|&v| v == 1).map_or(-1, |p| p as i32);
                put_bits(outs, no - 1, hi.max(0));
                outs[no - 1] = (hi >= 0) as u8;
            }
        }
        BCD7 => {
            if ins.iter().any(|&v| v == X) { for b in 0..7 { outs[b] = X; } }
            else {
                let n = to_num(ins, 0, 4);
                let seg = if n >= 0 && (c.p0 == 1 || n < 10) { SEG_HEX[n as usize] } else { 0 };
                put_bits(outs, 7, seg);
            }
        }
        BCDDEC => {
            if ins.iter().any(|&v| v == X) { for b in 0..10 { outs[b] = X; } }
            else {
                let n = to_num(ins, 0, 4);
                for b in 0..10 { outs[b] = (b as i32 == n) as u8; }
            }
        }
        BIN2BCD => {
            if ins.iter().any(|&v| v == X) {
                for b in 0..5 { outs[b] = X; }
            } else {
                let n = to_num(ins, 0, 4);
                let o = n % 10;
                for b in 0..4 { outs[b] = ((o >> b) & 1) as u8; }
                outs[4] = (n >= 10) as u8;
            }
        }
        _ => {}
    }
}

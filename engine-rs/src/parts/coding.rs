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
        GRAY => {
            if ins.iter().any(|&v| v == X) { for b in 0..4 { outs[b] = X; } }
            else {
                let mut n = to_num(ins, 0, 4);
                if c.p0 == 1 {
                    let mut s = n >> 1;
                    while s != 0 { n ^= s; s >>= 1; }
                    put_bits(outs, 4, n);
                } else {
                    put_bits(outs, 4, n ^ (n >> 1));
                }
            }
        }
        PARITY => {
            if ins.iter().any(|&v| v == X) { outs[0] = X; outs[1] = X; }
            else {
                let odd = ins.iter().fold(0u8, |a, &b| a ^ b);
                outs[0] = (odd != 0) as u8;
                outs[1] = (odd == 0) as u8;
            }
        }
        _ => {}
    }
}

//! Adders, subtractors, the comparator, the ALU and the multiplier.

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
        ADD4 => {
            if ins.iter().any(|&v| v == X) { for b in 0..5 { outs[b] = X; } }
            else { put_bits(outs, 5, to_num(ins, 0, 4) + to_num(ins, 4, 4) + ins[8] as i32); }
        }
        SUB4 => {
            if ins.iter().any(|&v| v == X) { for b in 0..5 { outs[b] = X; } }
            else {
                let d = to_num(ins, 0, 4) - to_num(ins, 4, 4) - ins[8] as i32;
                put_bits(outs, 4, d & 15);
                outs[4] = (d < 0) as u8;
            }
        }
        ADDSUB4 => {
            if ins.iter().any(|&v| v == X) { for b in 0..6 { outs[b] = X; } }
            else {
                let signed = |n: i32| if n & 8 != 0 { n - 16 } else { n };
                let a = to_num(ins, 0, 4);
                let bn = to_num(ins, 4, 4);
                let m = ins[8] as i32;
                let b = if m != 0 { !bn & 15 } else { bn };
                let r = a + b + m;
                let exact = if m != 0 { signed(a) - signed(bn) } else { signed(a) + signed(b) };
                put_bits(outs, 5, r);
                outs[5] = (exact < -8 || exact > 7) as u8;
            }
        }
        CMP4 => {
            if ins.iter().any(|&v| v == X) { for b in 0..3 { outs[b] = X; } }
            else {
                let a = to_num(ins, 0, 4);
                let b = to_num(ins, 4, 4);
                outs[0] = (a > b) as u8;
                outs[1] = (a == b) as u8;
                outs[2] = (a < b) as u8;
            }
        }
        ALU => {
            let a = to_num(ins, 0, 4);
            let b = to_num(ins, 4, 4);
            let op = to_num(ins, 8, 3);
            let code = if op < 0 { -1 } else { ((op & 1) << 2) | (op & 2) | (op >> 2) };
            if code < 0 || a < 0 || (code < 5 && b < 0) {
                for k in 0..6 { outs[k] = X; }
            } else {
                let mut co = 0u8;
                let mut r;
                match code {
                    0 => { r = a + b; co = (r > 15) as u8; }
                    1 => { r = a - b; co = (r < 0) as u8; }
                    2 => r = a & b,
                    3 => r = a | b,
                    4 => r = a ^ b,
                    5 => r = !a,
                    6 => { r = a + 1; co = (r > 15) as u8; }
                    _ => { r = a - 1; co = (r < 0) as u8; }
                }
                r &= 15;
                write_num(outs, 0, 4, r);
                outs[4] = co;
                outs[5] = (r == 0) as u8;
            }
        }
        MUL => {
            if ins.iter().any(|&v| v == X) { for b in 0..no { outs[b] = X; } }
            else {
                let n = c.p0 as usize;
                put_bits(outs, 2 * n, to_num(ins, 0, n) * to_num(ins, n, n));
            }
        }
        HALFADD => {
            if ins.iter().any(|&v| v == X) { outs[0] = X; outs[1] = X; }
            else { outs[0] = ((ins[0] ^ ins[1]) != 0) as u8; outs[1] = ((ins[0] & ins[1]) != 0) as u8; }
        }
        FULLADD => {
            if ins.iter().any(|&v| v == X) { outs[0] = X; outs[1] = X; }
            else { put_bits(outs, 2, ins[0] as i32 + ins[1] as i32 + ins[2] as i32); }
        }
        HALFSUB => {
            if ins.iter().any(|&v| v == X) { outs[0] = X; outs[1] = X; }
            else { outs[0] = ((ins[0] ^ ins[1]) != 0) as u8; outs[1] = (ins[0] == 0 && ins[1] != 0) as u8; }
        }
        FULLSUB => {
            if ins.iter().any(|&v| v == X) { outs[0] = X; outs[1] = X; }
            else {
                let d = ins[0] as i32 - ins[1] as i32 - ins[2] as i32;
                outs[0] = (d & 1) as u8;
                outs[1] = (d < 0) as u8;
            }
        }
        BCDADD => {
            if ins.iter().any(|&v| v == X) {
                for b in 0..5 { outs[b] = X; }
            } else {
                let mut z = to_num(ins, 0, 4) + to_num(ins, 4, 4) + ins[8] as i32;
                if z > 9 { z += 6; }
                for b in 0..4 { outs[b] = ((z >> b) & 1) as u8; }
                outs[4] = (z > 15) as u8;
            }
        }
        _ => {}
    }
}

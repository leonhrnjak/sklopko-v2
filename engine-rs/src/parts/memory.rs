//! ROM and RAM.

use super::util::*;
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
        ROM => {
            let abits = c.p0 as usize;
            let dbits = c.p1 as usize;
            let addr = to_num(ins, 0, abits);
            if addr < 0 {
                for b in 0..dbits { outs[b] = X; }
            } else {
                let w = sh.rom[c.mem_off + addr as usize] as i32;
                write_num(outs, 0, dbits, w);
            }
            // The table port: 256 bytes that follow the words (p2 is 1 when the part has it).
            if c.p2 == 1 {
                let t = to_num(ins, abits, 8);
                if t < 0 {
                    for b in 0..8 { outs[dbits + b] = X; }
                } else {
                    let w = sh.rom[c.mem_off + (1usize << abits) + t as usize] as i32;
                    write_num(outs, dbits, 8, w);
                }
            }
        }
        RAM => {
            let n = c.p0 as usize;
            let abits = c.p1 as usize;
            let addr = to_num(ins, n + 2, abits);
            let clk = ins[n + 1];
            let edge = *c.pc == 0 && clk == 1;
            *c.pc = clk;
            let base = c.mem_off;
            if edge && ins[n] == 1 {
                let data = to_num(ins, 0, n);
                if addr >= 0 && data >= 0 {
                    sh.ram[base + addr as usize] = data as u8;
                }
            }
            if addr < 0 {
                for b in 0..no {
                    outs[b] = X;
                }
            } else {
                let w = sh.ram[base + addr as usize] as i32;
                write_num(outs, 0, n, w);
            }
        }
        _ => {}
    }
}

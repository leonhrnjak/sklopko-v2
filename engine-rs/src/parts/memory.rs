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
        LUT => {
            // The inputs pick a row, the first one the most significant; the rows are words in the ROM. p0: inputs.
            let n = c.p0 as usize;
            let mut addr = 0usize;
            let mut bad = false;
            for i in 0..n {
                let v = ins[i];
                if v == X { bad = true; break; }
                addr = (addr << 1) | v as usize;
            }
            if bad {
                for b in 0..no { outs[b] = X; }
            } else {
                let word = if addr < (1usize << n) { sh.rom[c.mem_off + addr] as i32 } else { 0 };
                put_bits(outs, no, word);
            }
        }
        _ => {}
    }
}

// Table tests: each row is the inputs of one evaluation and the outputs it must give. Copy this pattern for a new part (see testkit.rs).
#[cfg(test)]
mod tests {
    use super::super::testkit::{table, Part};
    use super::*;

    #[test]
    fn ram_four_words_of_four_bits() {
        // Inputs: four data bits, write enable, clock, two address bits (least significant first). Outputs: the word at the address.
        let mut r = Part::new(RAM, 4).params(4, 2, 0).ram(4);
        table(&mut r, &[
            ("0000 0 0 00", "0000"),
            ("1010 1 0 01", "0000"), // write enabled, clock low: nothing written
            ("1010 1 1 01", "1010"), // rising edge: 5 is written to address 2 (the read shows it at once)
            ("0000 0 0 01", "1010"),
            ("0000 0 0 00", "0000"), // another address
            ("1111 1 0 00", "0000"),
            ("1111 1 1 00", "1111"),
            ("0000 0 0 01", "1010"), // the first word is still there
            ("0000 0 0 11", "0000"),
            ("1111 0 1 11", "0000"), // an edge with write disabled writes nothing
            ("0000 0 0 X1", "XXXX"), // an unknown address reads unknown
        ]);
        assert_eq!(r.sh.ram, vec![15, 0, 5, 0]);
    }

    #[test]
    fn rom_reads_its_words() {
        // Inputs: two address bits. Outputs: four bits.
        let mut r = Part::new(ROM, 4).params(2, 4, 0).rom(&[3, 5, 10, 15]);
        table(&mut r, &[("00", "1100"), ("10", "1010"), ("01", "0101"), ("11", "1111"), ("X0", "XXXX")]);
    }

    #[test]
    fn lookup_table_rows_start_at_the_first_input() {
        // An XOR table: two inputs (the first the most significant), one output.
        let mut l = Part::new(LUT, 1).params(2, 0, 0).rom(&[0, 1, 1, 0]);
        table(&mut l, &[("00", "0"), ("01", "1"), ("10", "1"), ("11", "0"), ("X1", "X")]);
    }
}

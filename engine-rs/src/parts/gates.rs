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
        DEMUX => {
            // p0: outputs, p1: select bits. The select lines are laid out MSB first after the input.
            let n = c.p0 as usize;
            let k = c.p1 as usize;
            let mut s = 0usize;
            let mut bad = false;
            for b in 0..k {
                let v = ins[k - b];
                if v == X { bad = true; break; }
                s |= (v as usize) << b;
            }
            for i in 0..n { outs[i] = if bad { X } else if i == s { ins[0] } else { 0 }; }
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
    fn and_nand() {
        table(&mut Part::new(AND, 1), &[("00", "0"), ("01", "0"), ("11", "1"), ("0X", "0"), ("1X", "X"), ("111", "1"), ("110", "0")]);
        table(&mut Part::new(NAND, 1), &[("00", "1"), ("11", "0"), ("0X", "1"), ("1X", "X")]);
    }

    #[test]
    fn or_nor() {
        table(&mut Part::new(OR, 1), &[("00", "0"), ("01", "1"), ("11", "1"), ("1X", "1"), ("0X", "X"), ("000", "0"), ("001", "1")]);
        table(&mut Part::new(NOR, 1), &[("00", "1"), ("01", "0"), ("1X", "0"), ("0X", "X")]);
    }

    #[test]
    fn xor_xnor() {
        table(&mut Part::new(XOR, 1), &[("00", "0"), ("01", "1"), ("10", "1"), ("11", "0"), ("1X", "X"), ("0X", "X"), ("111", "1")]);
        table(&mut Part::new(XNOR, 1), &[("00", "1"), ("01", "0"), ("11", "1"), ("1X", "X")]);
    }

    #[test]
    fn not_and_buffer() {
        table(&mut Part::new(NOT, 1), &[("0", "1"), ("1", "0"), ("X", "X"), ("Z", "X")]);
        table(&mut Part::new(BUF, 1), &[("0", "0"), ("1", "1"), ("X", "X")]);
    }

    #[test]
    fn mux_four_to_one() {
        // Four data inputs, then two select lines, the most significant first.
        let mut m = Part::new(MUX, 1).params(4, 2, 0);
        table(&mut m, &[("0110 00", "0"), ("0110 01", "1"), ("0110 10", "1"), ("0110 11", "0"), ("0110 X0", "X"), ("0110 0X", "X")]);
    }

    #[test]
    fn demux_one_to_four() {
        // The input, then two select lines, the most significant first.
        let mut d = Part::new(DEMUX, 4).params(4, 2, 0);
        table(&mut d, &[("1 00", "1000"), ("1 01", "0100"), ("1 10", "0010"), ("1 11", "0001"), ("0 10", "0000"), ("1 1X", "XXXX")]);
    }
}

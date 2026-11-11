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

// Table tests: each row is the inputs of one evaluation and the outputs it must give; the part keeps its state from row to row, so a
// table is a short run. Copy this pattern for a new part (see testkit.rs).
#[cfg(test)]
mod tests {
    use super::super::testkit::{table, Part};
    use super::*;

    #[test]
    fn d_flip_flop() {
        // Inputs: D, clock, set, reset. Outputs: Q, not Q.
        table(&mut Part::new(DFF, 2), &[
            ("1 0 0 0", "0 1"), // clock low: nothing is stored yet
            ("1 1 0 0", "1 0"), // rising edge: Q takes D
            ("0 1 0 0", "1 0"), // clock stays high: no new edge
            ("0 0 0 0", "1 0"), // falling edge: nothing
            ("0 1 0 0", "0 1"), // rising edge: Q takes 0
            ("1 0 1 0", "1 0"), // set works without a clock
            ("1 0 0 1", "0 1"), // reset works without a clock
            ("1 1 1 1", "0 1"), // reset wins over set, and over the edge
            ("1 0 0 0", "0 1"),
            ("X 1 0 0", "X X"), // an unknown D at the edge
        ]);
    }

    #[test]
    fn t_flip_flop() {
        // Inputs: T, clock, set, reset.
        table(&mut Part::new(TFF, 2), &[
            ("1 0 0 0", "0 1"),
            ("1 1 0 0", "1 0"), // T=1: toggles
            ("1 0 0 0", "1 0"),
            ("1 1 0 0", "0 1"), // and back
            ("0 0 0 0", "0 1"),
            ("0 1 0 0", "0 1"), // T=0: holds
            ("X 0 0 0", "0 1"),
            ("X 1 0 0", "X X"),
        ]);
    }

    #[test]
    fn jk_flip_flop() {
        // Inputs: J, clock, K, set, reset.
        table(&mut Part::new(JKFF, 2), &[
            ("1 0 0 0 0", "0 1"),
            ("1 1 0 0 0", "1 0"), // J=1, K=0: set
            ("0 0 0 0 0", "1 0"),
            ("0 1 1 0 0", "0 1"), // J=0, K=1: reset
            ("0 0 0 0 0", "0 1"),
            ("1 1 1 0 0", "1 0"), // J=1, K=1: toggle
            ("1 0 1 0 0", "1 0"),
            ("1 1 1 0 0", "0 1"),
        ]);
    }

    #[test]
    fn sr_latch() {
        // Inputs: S, R. Outputs: Q, not Q.
        table(&mut Part::new(SRLATCH, 2), &[("00", "01"), ("10", "10"), ("00", "10"), ("01", "01"), ("00", "01"), ("11", "00")]);
    }

    #[test]
    fn d_latch() {
        // Inputs: D, enable.
        table(&mut Part::new(DLATCH, 2), &[("10", "01"), ("11", "10"), ("10", "10"), ("00", "10"), ("01", "01")]);
    }

    #[test]
    fn counter_modulo_ten_up_and_down() {
        // Inputs: clock, enable, up, reset. Outputs: the four bits (least significant first), then the carry.
        let mut c = Part::new(COUNTER, 5).params(10, 0, 0);
        table(&mut c, &[
            ("0 1 1 0", "0000 0"),
            ("1 1 1 0", "1000 0"), // 1
            ("0 1 1 0", "1000 0"),
            ("1 1 1 0", "0100 0"), // 2
            ("0 1 0 0", "0100 0"), // now counting down
            ("1 1 0 0", "1000 0"), // 1
            ("0 1 0 0", "1000 0"),
            ("1 1 0 0", "0000 1"), // 0, and the down carry
            ("0 1 0 0", "0000 1"),
            ("1 1 0 0", "1001 0"), // wraps to 9
            ("0 0 0 1", "0000 0"), // reset
        ]);
    }

    #[test]
    fn counter_wraps_at_its_modulus_and_holds_when_disabled() {
        let mut c = Part::new(COUNTER, 5).params(10, 0, 0);
        for i in 0..25 {
            c.eval(&[0, 1, 1, 0]);
            c.eval(&[1, 1, 1, 0]);
            assert_eq!(c.state(), (i + 1) % 10);
        }
        // Disabled: the edge does nothing.
        let before = c.state();
        c.eval(&[0, 0, 1, 0]);
        c.eval(&[1, 0, 1, 0]);
        assert_eq!(c.state(), before);
        // An unknown enable gives an unknown carry and counts nothing.
        c.eval(&[0, 2, 1, 0]);
        let out = c.eval(&[1, 2, 1, 0]);
        assert_eq!(out[4], 2);
        assert_eq!(c.state(), before);
    }

    #[test]
    fn counter_with_load() {
        // Inputs: four data bits, load, enable, clock, reset. Outputs: four bits, carry.
        table(&mut Part::new(COUNTERLD, 5), &[
            ("0000 0 0 0 0", "0000 0"),
            ("1010 1 0 0 0", "0000 0"), // load, clock low: nothing yet
            ("1010 1 0 1 0", "1010 0"), // rising edge loads 5
            ("1010 0 1 0 0", "1010 0"),
            ("1010 0 1 1 0", "0110 0"), // counts: 6
            ("0000 0 0 0 1", "0000 0"), // reset
            ("1111 1 0 0 0", "0000 0"),
            ("1111 1 0 1 0", "1111 0"), // loads 15, not enabled: no carry
            ("1111 0 1 0 0", "1111 1"), // enabled at 15: carry
            ("0000 0 1 1 0", "0000 0"), // wraps to 0
        ]);
    }

    #[test]
    fn register() {
        // Inputs: four data bits, load enable, clock, reset.
        table(&mut Part::new(REGISTER, 4), &[
            ("1010 1 0 0", "0000"),
            ("1010 1 1 0", "1010"), // rising edge with load enabled
            ("0101 1 1 0", "1010"), // no new edge
            ("0101 1 0 0", "1010"),
            ("0101 0 1 0", "1010"), // edge, load disabled
            ("0101 1 0 0", "1010"),
            ("0101 1 1 0", "0101"),
            ("0101 1 0 0", "0101"),
            ("0101 1 0 1", "0000"), // reset
            ("X101 1 0 0", "0000"),
            ("X101 1 1 0", "XXXX"), // an unknown bit at the edge makes the whole word unknown
        ]);
    }

    #[test]
    fn shift_register() {
        // Inputs: serial in, four parallel bits, load, clock, reset.
        table(&mut Part::new(SHIFTREG, 4), &[
            ("1 0000 0 0 0", "0000"),
            ("1 0000 0 1 0", "1000"), // shifts a 1 in
            ("0 0000 0 0 0", "1000"),
            ("0 0000 0 1 0", "0100"),
            ("0 0000 0 0 0", "0100"),
            ("1 0000 0 1 0", "1010"),
            ("0 1111 1 0 0", "1010"),
            ("0 1111 1 1 0", "1111"), // parallel load
            ("0 0000 0 0 1", "0000"), // reset
        ]);
    }

    #[test]
    fn ring_and_johnson_counters() {
        // Inputs: clock, reset.
        table(&mut Part::new(RINGCOUNTER, 4).params(0, 0, 0), &[
            ("0 1", "1000"), ("1 0", "0100"), ("0 0", "0100"), ("1 0", "0010"), ("0 0", "0010"), ("1 0", "0001"), ("0 0", "0001"), ("1 0", "1000"),
        ]);
        table(&mut Part::new(RINGCOUNTER, 4).params(1, 0, 0), &[
            ("0 1", "0000"), ("1 0", "1000"), ("0 0", "1000"), ("1 0", "1100"), ("0 0", "1100"), ("1 0", "1110"), ("0 0", "1110"),
            ("1 0", "1111"), ("0 0", "1111"), ("1 0", "0111"),
        ]);
    }
}

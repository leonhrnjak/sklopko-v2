//! Helpers for the tests of the parts (`cargo test` in `engine-rs/`, on the host: no WebAssembly needed).
//!
//! A part is evaluated with its inputs and its own state, which `Part` keeps between calls, so a table of rows (inputs, expected
//! outputs) is a short run of the part: each row is one `eval`. Pins are written as strings of `0`, `1`, `X` (unknown) and `Z`
//! (floating), the first character being pin 0, so a 4-bit number reads backwards: `"1000"` is 1.
//!
//! ```ignore
//! let mut dff = Part::new(DFF, 2);
//! table(&mut dff, &[
//!     ("1 0 0 0", "0 1"),   // D=1, clock low: nothing stored yet
//!     ("1 1 0 0", "1 0"),   // clock rises: Q takes D
//! ]);
//! ```
//! Spaces in a row are ignored, so the pins can be grouped.

use super::util::{X, Z};
use super::{eval, Cell, Shared};

pub struct Part {
    kind: i32,
    no: usize,
    p: [i32; 3],
    n: i32,
    pc: u8,
    q: u8,
    pub sh: Shared,
}

impl Part {
    /// A part of this kind (`kind::*`) with `no` outputs, in its power-on state.
    pub fn new(kind: i32, no: usize) -> Part {
        Part {
            kind,
            no,
            p: [0; 3],
            n: 0,
            pc: 0,
            q: 0,
            sh: Shared { rom: vec![], ram: vec![], fb: vec![], acias: vec![], consoles: vec![], vias: vec![], lcds: vec![], cpus: vec![], programs: None },
        }
    }

    /// The part's parameters (what the page's compiled circuit gives as p0, p1 and p2).
    pub fn params(mut self, p0: i32, p1: i32, p2: i32) -> Part {
        self.p = [p0, p1, p2];
        self
    }

    /// The words of the ROM (and the LUT's rows) the part reads, starting at its `mem_off` (0 here).
    pub fn rom(mut self, words: &[u16]) -> Part {
        self.sh.rom = words.to_vec();
        self
    }

    /// `bytes` bytes of RAM, all zero.
    pub fn ram(mut self, bytes: usize) -> Part {
        self.sh.ram = vec![0; bytes];
        self
    }

    /// The part's state number, as the page reads it (`st_n`).
    pub fn state(&self) -> i32 {
        self.n
    }

    /// Evaluate the part once with these inputs and return its outputs.
    pub fn eval(&mut self, ins: &[u8]) -> Vec<u8> {
        let mut outs = vec![0u8; self.no.max(1)];
        let mut cell = Cell {
            ins,
            outs: &mut outs,
            no: self.no,
            n: &mut self.n,
            pc: &mut self.pc,
            q: &mut self.q,
            p0: self.p[0],
            p1: self.p[1],
            p2: self.p[2],
            mem_off: 0,
        };
        eval(self.kind, &mut cell, &mut self.sh);
        outs.truncate(self.no);
        outs
    }
}

/// `"10X"` as pin values [1, 0, X]. Spaces are skipped.
pub fn pins(s: &str) -> Vec<u8> {
    s.chars()
        .filter(|c| !c.is_whitespace())
        .map(|c| match c {
            '0' => 0,
            '1' => 1,
            'X' => X,
            'Z' => Z,
            other => panic!("pin character {other:?} in {s:?}"),
        })
        .collect()
}

/// Pin values as text, the inverse of `pins`.
pub fn show(v: &[u8]) -> String {
    v.iter().map(|&b| ['0', '1', 'X', 'Z'][b as usize]).collect()
}

/// Run the rows: evaluate the part with each row's inputs, and compare the outputs with the row's expected outputs. A failure names
/// the row.
#[track_caller]
pub fn table(part: &mut Part, rows: &[(&str, &str)]) {
    for (i, (ins, want)) in rows.iter().enumerate() {
        let got = show(&part.eval(&pins(ins)));
        let want: String = want.chars().filter(|c| !c.is_whitespace()).collect();
        assert_eq!(got, want, "row {i}: inputs {ins:?}");
    }
}

//! The HD44780 character LCD (`src/engine/hd44780.ts` and `components/lcd.ts`), step for step.
//!
//! What the inspector says was last done (`last`, a sentence) is kept as a code and its numbers, and the page makes the sentence.

use super::kind::*;
use super::util::Z;
use super::{Cell, Shared};

/// Everything is a number, in the order of the page's `LCD_KEYS` (`src/engine/wasmengine.ts`), so that the page reads a whole `Lcd` as an
/// array of `LCD_FIELDS` numbers (`#[repr(C)]`); a flag is 0 or 1.
#[repr(C)]
#[derive(Clone)]
pub struct Lcd {
    ddram: [i32; 128],
    cgram: [i32; 64],
    ac: i32,
    cg: i32,
    up: i32,
    entry_shift: i32,
    display: i32,
    cursor: i32,
    blink: i32,
    shift: i32,
    dl8: i32,
    two_line: i32,
    busy: i32,
    dropped: i32,
    nibble: i32,
    read_byte: i32,
    read_half: i32,
    rev: i32,
    /// What was done last, as a code (`LAST_*`) with up to three numbers; `LAST_KEEP` leaves the page's own sentence.
    last_kind: i32,
    last_a: i32,
    last_b: i32,
    last_c: i32,
    /// The clock and E as they were last time (X = 2 at the start), what is driven on the data pins now (-1 for nothing) and its mask.
    cp: i32,
    ep: i32,
    drive: i32,
    mask: i32,
}

pub const LCD_FIELDS: usize = 216;

const LAST_IGNORED_DATA: i32 = 1;
const LAST_IGNORED_INSTRUCTION: i32 = 2;
const LAST_DATA: i32 = 3;
const LAST_DDRAM: i32 = 4;
const LAST_CGRAM: i32 = 5;
const LAST_FUNCTION_4: i32 = 6;
const LAST_FUNCTION: i32 = 7;
const LAST_SHIFT: i32 = 8;
const LAST_DISPLAY: i32 = 9;
const LAST_ENTRY: i32 = 10;
const LAST_HOME: i32 = 11;
const LAST_CLEAR: i32 = 12;
const LAST_NOP: i32 = 13;

impl Lcd {
    pub fn from_numbers(v: &[i32]) -> Lcd {
        assert!(v.len() == LCD_FIELDS);
        let mut s = Lcd { ddram: [0x20; 128], cgram: [0; 64], ac: 0, cg: 0, up: 1, entry_shift: 0, display: 0, cursor: 0, blink: 0, shift: 0, dl8: 1,
            two_line: 0, busy: 0, dropped: 0, nibble: -1, read_byte: 0, read_half: 0, rev: 0, last_kind: 0, last_a: 0, last_b: 0, last_c: 0,
            cp: 2, ep: 2, drive: -1, mask: 0 };
        // SAFETY: `Lcd` is `repr(C)` and made of LCD_FIELDS i32.
        unsafe { std::ptr::copy_nonoverlapping(v.as_ptr(), &mut s as *mut Lcd as *mut i32, LCD_FIELDS) };
        s
    }

    fn wrap(&self, ac: i32) -> i32 {
        if self.cg != 0 { ac & 0x3f } else { ac & 0x7f }
    }

    fn step(&mut self) {
        self.ac = self.wrap(self.ac + if self.up != 0 { 1 } else { -1 });
    }

    fn last(&mut self, kind: i32, a: i32, b: i32, c: i32) {
        self.last_kind = kind;
        self.last_a = a;
        self.last_b = b;
        self.last_c = c;
    }

    fn long_time(time: i32) -> i32 { [1520, 8, 0][time as usize] }
    fn short_time(time: i32) -> i32 { [37, 2, 0][time as usize] }

    fn exec(&mut self, rs: i32, d: i32, time: i32) {
        let byte = d & 0xff;
        if self.busy > 0 {
            self.dropped += 1;
            self.last(if rs != 0 { LAST_IGNORED_DATA } else { LAST_IGNORED_INSTRUCTION }, byte, 0, 0);
            return;
        }
        self.rev += 1;
        if rs != 0 {
            self.last(LAST_DATA, byte, 0, 0);
            if self.cg != 0 {
                self.cgram[(self.ac & 0x3f) as usize] = byte;
            } else {
                self.ddram[(self.ac & 0x7f) as usize] = byte;
                if self.entry_shift != 0 { self.shift = (self.shift + if self.up != 0 { 1 } else { -1 } + 80) % 80; }
            }
            self.step();
            self.busy = Self::short_time(time);
            return;
        }
        let mut long = false;
        if byte & 0x80 != 0 {
            self.cg = 0;
            self.ac = byte & 0x7f;
            self.last(LAST_DDRAM, self.ac, 0, 0);
        } else if byte & 0x40 != 0 {
            self.cg = 1;
            self.ac = byte & 0x3f;
            self.last(LAST_CGRAM, self.ac, 0, 0);
        } else if byte & 0x20 != 0 {
            let dl8 = (byte & 0x10) != 0;
            if self.dl8 != 0 && !dl8 {
                self.dl8 = 0;
                self.last(LAST_FUNCTION_4, 0, 0, 0);
            } else {
                self.dl8 = dl8 as i32;
                self.two_line = ((byte & 0x08) != 0) as i32;
                self.last(LAST_FUNCTION, self.dl8, self.two_line, 0);
            }
        } else if byte & 0x10 != 0 {
            let right = (byte & 0x04) != 0;
            if byte & 0x08 != 0 {
                self.shift = (self.shift + if right { -1 } else { 1 } + 80) % 80;
            } else {
                self.ac = self.wrap(self.ac + if right { 1 } else { -1 });
            }
            self.last(LAST_SHIFT, ((byte & 0x08) != 0) as i32, right as i32, 0);
        } else if byte & 0x08 != 0 {
            self.display = ((byte & 4) != 0) as i32;
            self.cursor = ((byte & 2) != 0) as i32;
            self.blink = ((byte & 1) != 0) as i32;
            self.last(LAST_DISPLAY, self.display, self.cursor, self.blink);
        } else if byte & 0x04 != 0 {
            self.up = ((byte & 2) != 0) as i32;
            self.entry_shift = ((byte & 1) != 0) as i32;
            self.last(LAST_ENTRY, self.up, self.entry_shift, 0);
        } else if byte & 0x02 != 0 {
            self.cg = 0;
            self.ac = 0;
            self.shift = 0;
            self.last(LAST_HOME, 0, 0, 0);
            long = true;
        } else if byte & 0x01 != 0 {
            self.ddram = [0x20; 128];
            self.cg = 0;
            self.ac = 0;
            self.shift = 0;
            self.up = 1;
            self.last(LAST_CLEAR, 0, 0, 0);
            long = true;
        } else {
            self.last(LAST_NOP, 0, 0, 0);
        }
        self.busy = if long { Self::long_time(time) } else { Self::short_time(time) };
    }

    fn write_bus(&mut self, rs: i32, d: i32, time: i32) {
        if self.dl8 != 0 {
            return self.exec(rs, d, time);
        }
        if self.nibble < 0 {
            self.nibble = (d >> 4) & 15;
        } else {
            let byte = (self.nibble << 4) | ((d >> 4) & 15);
            self.nibble = -1;
            self.exec(rs, byte, time);
        }
    }

    fn read_value(&self, rs: i32) -> i32 {
        if rs == 0 {
            return (if self.busy > 0 { 0x80 } else { 0 }) | (self.ac & 0x7f);
        }
        if self.cg != 0 { self.cgram[(self.ac & 0x3f) as usize] } else { self.ddram[(self.ac & 0x7f) as usize] }
    }

    /// (value, mask)
    fn read_bus(&mut self, rs: i32) -> (i32, i32) {
        if self.dl8 != 0 {
            return (self.read_value(rs), 0xff);
        }
        if self.read_half == 0 { self.read_byte = self.read_value(rs); }
        let half = if self.read_half == 0 { self.read_byte >> 4 } else { self.read_byte & 15 };
        (half << 4, 0xf0)
    }

    fn read_done(&mut self, rs: i32) {
        if self.dl8 == 0 {
            self.read_half ^= 1;
            if self.read_half == 1 { return; }
        }
        if rs != 0 {
            self.step();
            self.rev += 1;
        }
    }
}

const I_CLK: usize = 0;
const I_RS: usize = 1;
const I_RW: usize = 2;
const I_E: usize = 3;
const I_DIN: usize = 4;

#[inline(always)]
pub fn eval(kind: i32, c: &mut Cell, sh: &mut Shared) {
    if kind != LCD { return; }
    let ins = c.ins;
    let outs = &mut *c.outs;
    let st = &mut sh.lcds[c.mem_off];
    let time = c.p0;
    let clk = ins[I_CLK] as i32;
    if st.cp == 0 && clk == 1 && st.busy > 0 { st.busy -= 1; }
    if clk <= 1 { st.cp = clk; }
    let e = ins[I_E] as i32;
    let rs = ins[I_RS] as i32;
    let rw = ins[I_RW] as i32;
    let rising = st.ep == 0 && e == 1;
    let falling = st.ep == 1 && e == 0;
    if e <= 1 { st.ep = e; }
    if rising && rw == 1 && rs <= 1 {
        let (value, mask) = st.read_bus(rs);
        st.drive = value;
        st.mask = mask;
    }
    if falling {
        if rw == 0 && rs <= 1 {
            let mut d = 0;
            let mut known = true;
            for i in 0..8 {
                let v = ins[I_DIN + i] as i32;
                if v == 0 || v == 1 { d |= v << i; } else if i >= 4 { known = false; }
            }
            if known { st.write_bus(rs, d, time); }
        } else if rw == 1 && rs <= 1 && st.drive >= 0 {
            st.read_done(rs);
        }
        st.drive = -1;
    }
    let driving = e == 1 && rw == 1 && st.drive >= 0;
    for i in 0..8 {
        outs[i] = if driving && (st.mask >> i) & 1 != 0 { ((st.drive >> i) & 1) as u8 } else { Z };
    }
}

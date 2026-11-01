//! The 6522 versatile interface adapter (`src/engine/via6522.ts` and `components/via.ts`), step for step.

use super::kind::*;
use super::util::{to_num, write_num, X, Z};
use super::{Cell, Shared};

const T1: i32 = 0x40;
const T2: i32 = 0x20;
const CB1: i32 = 0x10;
const CB2: i32 = 0x08;
const CA1: i32 = 0x02;
const CA2: i32 = 0x01;

/// The chip's registers and the part's two extra numbers, in the order of the page's `ViaPartState`. All numbers, so that the page
/// reads the whole struct as an array of 30 (`#[repr(C)]`); a flag is 0 or 1.
#[repr(C)]
#[derive(Clone, Default)]
pub struct Via {
    orb: i32,
    ora: i32,
    ddrb: i32,
    ddra: i32,
    t1c: i32,
    t1l: i32,
    t1armed: i32,
    t1reload: i32,
    pb7: i32,
    t2c: i32,
    t2l: i32,
    t2armed: i32,
    sr: i32,
    acr: i32,
    pcr: i32,
    ifr: i32,
    ier: i32,
    ca1: i32,
    cb1: i32,
    ca2: i32,
    cb2: i32,
    pb6: i32,
    ca2out: i32,
    cb2out: i32,
    ca2pulse: i32,
    cb2pulse: i32,
    ira: i32,
    irb: i32,
    /// PHI2 as it was last time.
    pc: i32,
    /// What the data pins show.
    out: i32,
}

/// How many numbers a `Via` is (the page reads that many from `via_ptr`).
pub const VIA_FIELDS: usize = 30;

impl Via {
    pub fn from_numbers(v: &[i32]) -> Via {
        let mut s = Via::default();
        // SAFETY: `Via` is `repr(C)` and made of 30 i32.
        unsafe { std::ptr::copy_nonoverlapping(v.as_ptr(), &mut s as *mut Via as *mut i32, VIA_FIELDS) };
        s
    }

    fn irq(&self) -> bool {
        (self.ifr & self.ier & 0x7f) != 0
    }

    /// Which bits of port A and of port B the chip drives, and to what: (pa, pa_oe, pb, pb_oe).
    fn port_out(&self) -> (i32, i32, i32, i32) {
        let mut pb_oe = self.ddrb;
        let mut pb = self.orb;
        if self.acr & 0x80 != 0 {
            pb_oe |= 0x80;
            pb = (pb & 0x7f) | (self.pb7 << 7);
        }
        (self.ora, self.ddra, pb, pb_oe)
    }

    fn mode_a(&self) -> i32 { (self.pcr >> 1) & 7 }
    fn mode_b(&self) -> i32 { (self.pcr >> 5) & 7 }
    fn ca2_is_output(&self) -> bool { self.mode_a() >= 4 }
    fn cb2_is_output(&self) -> bool { self.mode_b() >= 4 }
    fn independent_a(&self) -> bool { self.mode_a() == 1 || self.mode_a() == 3 }
    fn independent_b(&self) -> bool { self.mode_b() == 1 || self.mode_b() == 3 }

    fn reset(&mut self) {
        self.orb = 0; self.ora = 0; self.ddrb = 0; self.ddra = 0;
        self.acr = 0; self.pcr = 0; self.ifr = 0; self.ier = 0;
        self.t1armed = 0; self.t2armed = 0; self.t1reload = 0;
        self.pb7 = 1;
        self.ca2out = 1; self.cb2out = 1;
        self.ca2pulse = 0; self.cb2pulse = 0;
    }

    fn touch_a(&mut self) {
        self.ifr &= !CA1;
        if !self.independent_a() { self.ifr &= !CA2; }
        let m = self.mode_a();
        if m == 4 {
            self.ca2out = 0;
        } else if m == 5 {
            self.ca2out = 0;
            self.ca2pulse = 1;
        }
    }

    fn touch_b(&mut self) {
        self.ifr &= !CB1;
        if !self.independent_b() { self.ifr &= !CB2; }
        let m = self.mode_b();
        if m == 4 {
            self.cb2out = 0;
        } else if m == 5 {
            self.cb2out = 0;
            self.cb2pulse = 1;
        }
    }

    fn read(&mut self, rs: i32, pa: i32, pb: i32) -> i32 {
        match rs & 15 {
            0 => {
                self.touch_b();
                let input = if self.acr & 2 != 0 { self.irb } else { pb };
                let mut v = (self.orb & self.ddrb) | (input & !self.ddrb & 0xff);
                if self.acr & 0x80 != 0 { v = (v & 0x7f) | (self.pb7 << 7); }
                v
            }
            r @ (1 | 15) => {
                if r == 1 { self.touch_a(); }
                if self.acr & 1 != 0 { self.ira } else { pa }
            }
            2 => self.ddrb,
            3 => self.ddra,
            4 => { self.ifr &= !T1; self.t1c & 0xff }
            5 => self.t1c >> 8,
            6 => self.t1l & 0xff,
            7 => self.t1l >> 8,
            8 => { self.ifr &= !T2; self.t2c & 0xff }
            9 => self.t2c >> 8,
            10 => self.sr,
            11 => self.acr,
            12 => self.pcr,
            13 => (self.ifr & 0x7f) | if self.irq() { 0x80 } else { 0 },
            _ => self.ier | 0x80,
        }
    }

    fn write(&mut self, rs: i32, value: i32) {
        let v = value & 0xff;
        match rs & 15 {
            0 => { self.orb = v; self.touch_b(); }
            1 => { self.ora = v; self.touch_a(); }
            15 => self.ora = v,
            2 => self.ddrb = v,
            3 => self.ddra = v,
            4 | 6 => self.t1l = (self.t1l & 0xff00) | v,
            5 => {
                self.t1l = (self.t1l & 0xff) | (v << 8);
                self.t1c = self.t1l;
                self.ifr &= !T1;
                self.t1armed = 1;
                self.t1reload = 0;
                if self.acr & 0x80 != 0 { self.pb7 = 0; }
            }
            7 => {
                self.t1l = (self.t1l & 0xff) | (v << 8);
                self.ifr &= !T1;
            }
            8 => self.t2l = v,
            9 => {
                self.t2c = (v << 8) | self.t2l;
                self.ifr &= !T2;
                self.t2armed = 1;
            }
            10 => self.sr = v,
            11 => self.acr = v,
            12 => {
                self.pcr = v;
                if self.mode_a() == 6 { self.ca2out = 0; } else if self.mode_a() == 7 { self.ca2out = 1; }
                if self.mode_b() == 6 { self.cb2out = 0; } else if self.mode_b() == 7 { self.cb2out = 1; }
            }
            13 => self.ifr &= !(v & 0x7f),
            _ => {
                if v & 0x80 != 0 { self.ier |= v & 0x7f; } else { self.ier &= !(v & 0x7f); }
            }
        }
    }

    fn edges(&mut self, ca1: i32, ca2: i32, cb1: i32, cb2: i32, pa: i32, pb: i32) {
        let pcr = self.pcr;
        if self.ca1 >= 0 && ca1 >= 0 && self.ca1 != ca1 && ca1 == (pcr & 1) {
            self.ifr |= CA1;
            if self.acr & 1 != 0 { self.ira = pa; }
            if self.mode_a() == 4 { self.ca2out = 1; }
        }
        if self.cb1 >= 0 && cb1 >= 0 && self.cb1 != cb1 && cb1 == ((pcr >> 4) & 1) {
            self.ifr |= CB1;
            if self.acr & 2 != 0 { self.irb = pb; }
            if self.mode_b() == 4 { self.cb2out = 1; }
        }
        if !self.ca2_is_output() && self.ca2 >= 0 && ca2 >= 0 && self.ca2 != ca2 && ca2 == (self.mode_a() >> 1) { self.ifr |= CA2; }
        if !self.cb2_is_output() && self.cb2 >= 0 && cb2 >= 0 && self.cb2 != cb2 && cb2 == (self.mode_b() >> 1) { self.ifr |= CB2; }
        self.ca1 = ca1;
        self.ca2 = ca2;
        self.cb1 = cb1;
        self.cb2 = cb2;
    }

    fn clock(&mut self, pb6: i32) {
        if self.t1reload != 0 {
            self.t1c = self.t1l;
            self.t1reload = 0;
        } else {
            self.t1c = (self.t1c - 1) & 0xffff;
            if self.t1c == 0xffff {
                let free = self.acr & 0x40 != 0;
                if self.t1armed != 0 {
                    self.ifr |= T1;
                    if self.acr & 0x80 != 0 { self.pb7 = if free { self.pb7 ^ 1 } else { 1 }; }
                    if !free { self.t1armed = 0; }
                }
                if free { self.t1reload = 1; }
            }
        }
        let counting = if self.acr & 0x20 != 0 { self.pb6 == 1 && pb6 == 0 } else { true };
        if counting {
            self.t2c = (self.t2c - 1) & 0xffff;
            if self.t2c == 0xffff && self.t2armed != 0 {
                self.ifr |= T2;
                self.t2armed = 0;
            }
        }
        self.pb6 = pb6;
        if self.ca2pulse != 0 {
            self.ca2pulse = 0;
            self.ca2out = 1;
        }
        if self.cb2pulse != 0 {
            self.cb2pulse = 0;
            self.cb2out = 1;
        }
    }
}

// The pins, in the order of `components/via.ts`.
const I_PHI2: usize = 0;
const I_RESB: usize = 1;
const I_CS1: usize = 2;
const I_CS2B: usize = 3;
const I_RS: usize = 4;
const I_RWB: usize = 8;
const I_DI: usize = 9;
const I_PAIN: usize = 17;
const I_PBIN: usize = 25;
const I_CA1: usize = 33;
const I_CA2IN: usize = 34;
const I_CB1: usize = 35;
const I_CB2IN: usize = 36;
const O_PA: usize = 8;
const O_PB: usize = 16;
const O_CA2: usize = 24;
const O_CB2: usize = 25;
const O_IRQB: usize = 26;

fn level(v: u8) -> i32 {
    if v == 0 || v == 1 { v as i32 } else { -1 }
}

/// The eight pins of a port as a number. A bit nothing drives reads 0, unless the chip drives it (then it reads what it drives).
fn port_in(ins: &[u8], first: usize, out: i32, oe: i32) -> i32 {
    let mut n = 0;
    for i in 0..8 {
        let v = ins[first + i];
        let b = if v == 0 || v == 1 { v as i32 } else if (oe >> i) & 1 != 0 { (out >> i) & 1 } else { 0 };
        n |= b << i;
    }
    n
}

#[inline(always)]
pub fn eval(kind: i32, c: &mut Cell, sh: &mut Shared) {
    if kind != VIA6522 { return; }
    let ins = c.ins;
    let outs = &mut *c.outs;
    let st = &mut sh.vias[c.mem_off];
    let phi2 = ins[I_PHI2];
    let rising = st.pc == 0 && phi2 == 1;
    if phi2 <= 1 { st.pc = phi2 as i32; }
    let (pa_out, pa_oe, pb_out, pb_oe) = st.port_out();
    let pa = port_in(ins, I_PAIN, pa_out, pa_oe);
    let pb = port_in(ins, I_PBIN, pb_out, pb_oe);
    if ins[I_RESB] == 0 {
        st.reset();
        st.out = 0;
    } else {
        st.edges(level(ins[I_CA1]), level(ins[I_CA2IN]), level(ins[I_CB1]), level(ins[I_CB2IN]), pa, pb);
        if rising {
            st.out = 0;
            if ins[I_CS1] == 1 && ins[I_CS2B] == 0 {
                let rs = to_num(ins, I_RS, 4);
                let rw = ins[I_RWB];
                if rs >= 0 && rw == 1 {
                    st.out = st.read(rs, pa, pb);
                } else if rs >= 0 && rw == 0 {
                    let data = to_num(ins, I_DI, 8);
                    if data >= 0 { st.write(rs, data); }
                }
            }
            st.clock((pb >> 6) & 1);
        }
    }
    write_num(outs, 0, 8, st.out);
    let (pa_out, pa_oe, pb_out, pb_oe) = st.port_out();
    for i in 0..8 {
        outs[O_PA + i] = if (pa_oe >> i) & 1 != 0 { ((pa_out >> i) & 1) as u8 } else { Z };
        outs[O_PB + i] = if (pb_oe >> i) & 1 != 0 { ((pb_out >> i) & 1) as u8 } else { Z };
    }
    outs[O_CA2] = if st.ca2_is_output() { st.ca2out as u8 } else { Z };
    outs[O_CB2] = if st.cb2_is_output() { st.cb2out as u8 } else { Z };
    outs[O_IRQB] = if st.irq() { 0 } else { 1 };
    let _ = X;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parts::{Console, Shared};

    #[test]
    fn evaluates_with_unknown_inputs() {
        let mut vias = vec![Via::from_numbers(&[0, 0, 0, 0, 0xffff, 0xffff, 0, 0, 1, 0xffff, 0xff, 0, 0, 0, 0, 0, 0, -1, -1, -1, -1, -1, 1, 1, 0, 0, 0, 0, 2, 0])];
        let mut sh = Shared { rom: vec![], ram: vec![], fb: vec![], acias: vec![], consoles: Vec::<Console>::new(), vias: std::mem::take(&mut vias) };
        let ins = [2u8; 37];
        let mut outs = [0u8; 64];
        let (mut n, mut pc, mut q) = (0, 0, 0);
        let mut cell = Cell { ins: &ins, outs: &mut outs, no: 27, n: &mut n, pc: &mut pc, q: &mut q, p0: 0, p1: 0, p2: 0, mem_off: 0 };
        eval(VIA6522, &mut cell, &mut sh);
    }
}

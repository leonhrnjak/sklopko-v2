//! The engine: the compiled circuit in tables, and the settle loop of the TypeScript fast engine (`settleFast`, `combPass`,
//! `registeredRound`, `commitOuts` and `flagFast` in src/engine/simulator.ts), step for step.

use crate::acia::Acia;

const X: u8 = 2;
const Z: u8 = 3;

// The kinds of part. The numbers are the page's (KIND in src/engine/wasmengine.ts).
#[allow(dead_code)]
const NOP: i32 = 0;
const AND: i32 = 1;
const OR: i32 = 2;
const XOR: i32 = 3;
const NAND: i32 = 4;
const NOR: i32 = 5;
const XNOR: i32 = 6;
const NOT: i32 = 7;
const BUF: i32 = 8;
const MUX: i32 = 9;
const BUSMUX: i32 = 10;
const BUSADD: i32 = 11;
const BUSREG: i32 = 12;
const BUSCTR: i32 = 13;
const BUSGATE: i32 = 14;
const BUSCMP: i32 = 15;
const DFF: i32 = 16;
const ROM: i32 = 17;
const RAM: i32 = 18;
const CLOCK: i32 = 19;
const ACIA: i32 = 20;

// busgate operations (p1)
const G_AND: i32 = 0;
const G_OR: i32 = 1;
const G_XOR: i32 = 2;
const G_NAND: i32 = 3;
const G_NOR: i32 = 4;
const G_XNOR: i32 = 5;

#[inline(always)]
fn and2(a: u8, b: u8) -> u8 {
    if a == 0 || b == 0 { 0 } else if a == X || b == X { X } else { 1 }
}
#[inline(always)]
fn or2(a: u8, b: u8) -> u8 {
    if a == 1 || b == 1 { 1 } else if a == X || b == X { X } else { 0 }
}
#[inline(always)]
fn xor2(a: u8, b: u8) -> u8 {
    if a == X || b == X { X } else { a ^ b }
}
#[inline(always)]
fn flip(v: u8) -> u8 {
    if v > 1 { X } else { 1 - v }
}

/// Little-endian bits of `ins[start..start+n)` as a number, or -1 if any bit is not 0 or 1.
#[inline(always)]
fn to_num(ins: &[u8], start: usize, n: usize) -> i32 {
    let mut r = 0i32;
    for i in 0..n {
        let v = ins[start + i];
        if v > 1 {
            return -1;
        }
        r |= (v as i32) << i;
    }
    r
}

#[inline(always)]
fn write_num(outs: &mut [u8], start: usize, n: usize, value: i32) {
    for i in 0..n {
        outs[start + i] = if value < 0 { X } else { ((value >> i) & 1) as u8 };
    }
}

pub struct Engine {
    values: Vec<u8>,
    pins: Vec<u8>,
    kind: Vec<i32>,
    pin_start: Vec<u32>,
    n_ins: Vec<u32>,
    out_start: Vec<u32>,
    n_outs: Vec<u32>,
    p0: Vec<i32>,
    p1: Vec<i32>,
    p2: Vec<i32>,
    /// Where the part's words start in `rom` or `ram`, or which terminal it is.
    mem_off: Vec<u32>,
    st_n: Vec<i32>,
    st_pc: Vec<u8>,
    st_q: Vec<u8>,
    out_nets: Vec<u32>,
    reader_start: Vec<u32>,
    reader_part: Vec<u32>,
    reader_slot: Vec<u32>,
    reader_wake: Vec<u8>,
    order: Vec<u32>,
    rank: Vec<i32>,
    rom: Vec<u16>,
    ram: Vec<u8>,
    acias: Vec<Acia>,
    rank_flag: Vec<u8>,
    lo: usize,
    hi: isize,
    reg_list: Vec<u32>,
    reg_count: usize,
    reg_queued: Vec<u8>,
    reg_run: Vec<u32>,
    clock: usize,
    ticks: u64,
    outs: [u8; 64],
    saved: Vec<[u8; 24]>,
}

impl Engine {
    /// Build the engine from the image the page makes (the exporter is `exportImage` in src/engine/wasmengine.ts; the order here is its order).
    pub fn from_image(img: &[i32]) -> Engine {
        let mut at = 0usize;
        let mut next = || {
            let v = img[at];
            at += 1;
            v
        };
        let n_parts = next() as usize;
        let n_nets = next() as usize;
        let n_pins = next() as usize;
        let n_out_nets = next() as usize;
        let n_readers = next() as usize;
        let n_order = next() as usize;
        let n_rom = next() as usize;
        let n_ram = next() as usize;
        let clock = next() as usize;
        let n_acia = next() as usize;
        let values: Vec<u8> = (0..n_nets).map(|_| next() as u8).collect();
        let pins: Vec<u8> = (0..n_pins).map(|_| next() as u8).collect();
        let mut kind = vec![0; n_parts];
        let mut pin_start = vec![0; n_parts];
        let mut n_ins = vec![0; n_parts];
        let mut out_start = vec![0; n_parts];
        let mut n_outs = vec![0; n_parts];
        let mut p0 = vec![0; n_parts];
        let mut p1 = vec![0; n_parts];
        let mut p2 = vec![0; n_parts];
        let mut mem_off = vec![0; n_parts];
        let mut st_n = vec![0; n_parts];
        let mut st_pc = vec![0u8; n_parts];
        let mut st_q = vec![0u8; n_parts];
        for i in 0..n_parts {
            kind[i] = next();
            pin_start[i] = next() as u32;
            n_ins[i] = next() as u32;
            out_start[i] = next() as u32;
            n_outs[i] = next() as u32;
            p0[i] = next();
            p1[i] = next();
            p2[i] = next();
            mem_off[i] = next() as u32;
            st_n[i] = next();
            st_pc[i] = next() as u8;
            st_q[i] = next() as u8;
        }
        let out_nets: Vec<u32> = (0..n_out_nets).map(|_| next() as u32).collect();
        let reader_start: Vec<u32> = (0..=n_nets).map(|_| next() as u32).collect();
        let reader_part: Vec<u32> = (0..n_readers).map(|_| next() as u32).collect();
        let reader_slot: Vec<u32> = (0..n_readers).map(|_| next() as u32).collect();
        let reader_wake: Vec<u8> = (0..n_readers).map(|_| next() as u8).collect();
        let order: Vec<u32> = (0..n_order).map(|_| next() as u32).collect();
        let rank: Vec<i32> = (0..n_parts).map(|_| next()).collect();
        let rom: Vec<u16> = (0..n_rom).map(|_| next() as u16).collect();
        let ram: Vec<u8> = (0..n_ram).map(|_| next() as u8).collect();
        let mut acias = Vec::with_capacity(n_acia);
        for _ in 0..n_acia {
            let reset_clears = next() != 0;
            let mut regs = [0u8; 8];
            for r in regs.iter_mut().take(7) {
                *r = next() as u8;
            }
            acias.push(Acia::new(regs, reset_clears));
        }
        Engine {
            values, pins, kind, pin_start, n_ins, out_start, n_outs, p0, p1, p2, mem_off, st_n, st_pc, st_q, out_nets, reader_start,
            reader_part, reader_slot, reader_wake, order, rank, rom, ram, acias,
            rank_flag: vec![0; n_order],
            lo: n_order,
            hi: -1,
            reg_list: vec![0; n_parts],
            reg_count: 0,
            reg_queued: vec![0; n_parts],
            reg_run: vec![0; n_parts],
            clock,
            ticks: 0,
            outs: [0; 64],
            saved: vec![[0u8; 24]; n_parts],
        }
    }

    pub fn clock_part(&self) -> usize {
        self.clock
    }
    pub fn ticks(&self) -> u64 {
        self.ticks
    }
    pub fn values_ptr(&mut self) -> *mut u8 {
        self.values.as_mut_ptr()
    }
    pub fn pins_ptr(&mut self) -> *mut u8 {
        self.pins.as_mut_ptr()
    }
    pub fn st_n_ptr(&mut self) -> *mut i32 {
        self.st_n.as_mut_ptr()
    }
    pub fn st_pc_ptr(&mut self) -> *mut u8 {
        self.st_pc.as_mut_ptr()
    }
    pub fn st_q_ptr(&mut self) -> *mut u8 {
        self.st_q.as_mut_ptr()
    }
    pub fn ram_ptr(&mut self) -> *mut u8 {
        self.ram.as_mut_ptr()
    }
    pub fn acia_regs_ptr(&mut self, k: usize) -> *mut u8 {
        self.acias[k].regs.as_mut_ptr()
    }
    pub fn acia_key(&mut self, k: usize, code: u8) {
        self.acias[k].key(code)
    }
    pub fn acia_clear_keys(&mut self, k: usize) {
        self.acias[k].clear_keys()
    }
    pub fn acia_pending(&self, k: usize) -> usize {
        self.acias[k].pending()
    }
    pub fn acia_take_events(&mut self, k: usize) -> usize {
        let a = &mut self.acias[k];
        let n = a.events.len();
        a.taken[..n].copy_from_slice(&a.events);
        a.events.clear();
        n
    }
    pub fn acia_events_ptr(&mut self, k: usize) -> *mut u16 {
        self.acias[k].taken.as_mut_ptr()
    }

    /// The clock part shows `phase`, and is flagged for the next settle.
    pub fn set_phase(&mut self, c: usize, phase: u8) {
        self.st_q[c] = phase;
        self.flag_fast(c);
    }

    pub fn acia_queue_ptr(&mut self, k: usize) -> *const u8 {
        self.acias[k].queue_ptr()
    }

    /// The clock part changes its output; the circuit settles.
    pub fn clock_edge(&mut self, c: usize) -> bool {
        self.st_q[c] = 1 - self.st_q[c];
        self.flag_fast(c);
        self.settle()
    }

    #[inline(always)]
    fn flag_fast(&mut self, i: usize) {
        let r = self.rank[i];
        if r < 0 {
            if self.reg_queued[i] == 0 {
                self.reg_queued[i] = 1;
                self.reg_list[self.reg_count] = i as u32;
                self.reg_count += 1;
            }
        } else {
            let r = r as usize;
            if self.rank_flag[r] == 0 {
                self.rank_flag[r] = 1;
                if r < self.lo {
                    self.lo = r;
                }
                if r as isize > self.hi {
                    self.hi = r as isize;
                }
            }
        }
    }

    /// Evaluate a part on its pins into `self.outs`.
    #[inline(always)]
    fn evaluate(&mut self, i: usize) {
        let ps = self.pin_start[i] as usize;
        let ni = self.n_ins[i] as usize;
        let no = self.n_outs[i] as usize;
        let ins = &self.pins[ps..ps + ni];
        let outs = &mut self.outs;
        match self.kind[i] {
            AND | NAND => {
                let mut r = 1u8;
                for &v in ins {
                    if v == 0 { r = 0; break; }
                    if v == X { r = X; }
                }
                outs[0] = if self.kind[i] == NAND { flip(r) } else { r };
            }
            OR | NOR => {
                let mut r = 0u8;
                for &v in ins {
                    if v == 1 { r = 1; break; }
                    if v == X { r = X; }
                }
                outs[0] = if self.kind[i] == NOR { flip(r) } else { r };
            }
            XOR | XNOR => {
                let mut r = 0u8;
                for &v in ins {
                    if v == X { r = X; break; }
                    r ^= v;
                }
                outs[0] = if self.kind[i] == XNOR { flip(r) } else { r };
            }
            NOT => outs[0] = flip(ins[0]),
            BUF => outs[0] = ins[0],
            MUX => {
                let n = self.p0[i] as usize;
                let k = self.p1[i] as usize;
                let mut s = 0usize;
                let mut bad = false;
                for b in 0..k {
                    let v = ins[n + k - 1 - b];
                    if v == X { bad = true; break; }
                    s |= (v as usize) << b;
                }
                outs[0] = if bad { X } else { ins[s] };
            }
            BUSMUX => {
                let w = self.p0[i] as usize;
                let k = self.p1[i] as usize;
                let sel = self.p2[i] as usize;
                let s = to_num(ins, w * k, sel);
                if s < 0 {
                    for b in 0..w { outs[b] = X; }
                } else {
                    let s = s as usize;
                    for b in 0..w { outs[b] = ins[s * w + b]; }
                }
            }
            BUSADD => {
                let n = self.p0[i] as usize;
                if ins.iter().any(|&v| v == X) {
                    for b in 0..=n { outs[b] = X; }
                } else {
                    let a = to_num(ins, 0, n);
                    let b = to_num(ins, n, n);
                    let sum = a + b + ins[2 * n] as i32;
                    for k in 0..=n { outs[k] = ((sum >> k) & 1) as u8; }
                }
            }
            BUSREG => {
                let n = self.p0[i] as usize;
                let pc = self.st_pc[i];
                let clk = ins[n + 1];
                let edge = pc == 0 && clk == 1;
                self.st_pc[i] = clk;
                if ins[n + 2] == 1 {
                    self.st_n[i] = 0;
                } else if edge && ins[n] == 1 {
                    self.st_n[i] = to_num(ins, 0, n);
                }
                write_num(outs, 0, n, self.st_n[i]);
            }
            BUSCTR => {
                let n = self.p0[i] as usize;
                let mask = (1i32 << n) - 1;
                let ld = ins[n];
                let en = ins[n + 1];
                let r = ins[n + 3];
                let clk = ins[n + 2];
                let edge = self.st_pc[i] == 0 && clk == 1;
                self.st_pc[i] = clk;
                if r == 1 {
                    self.st_n[i] = 0;
                } else if edge {
                    if ld == 1 {
                        let d = to_num(ins, 0, n);
                        if d >= 0 { self.st_n[i] = d; }
                    } else if ld == 0 && en == 1 {
                        self.st_n[i] = (self.st_n[i] + 1) & mask;
                    }
                }
                let st = self.st_n[i];
                write_num(outs, 0, n, st);
                outs[n] = if en == X { X } else if st == mask && en == 1 { 1 } else { 0 };
            }
            BUSGATE => {
                let n = self.p0[i] as usize;
                let op = self.p1[i];
                for b in 0..n {
                    let a = ins[b];
                    outs[b] = match op {
                        G_AND => and2(a, ins[n + b]),
                        G_OR => or2(a, ins[n + b]),
                        G_XOR => xor2(a, ins[n + b]),
                        G_NAND => flip(and2(a, ins[n + b])),
                        G_NOR => flip(or2(a, ins[n + b])),
                        G_XNOR => flip(xor2(a, ins[n + b])),
                        _ => flip(a),
                    };
                }
            }
            BUSCMP => {
                let n = self.p0[i] as usize;
                if ins.iter().any(|&v| v == X) {
                    outs[0] = X; outs[1] = X; outs[2] = X;
                } else {
                    let a = to_num(ins, 0, n);
                    let b = to_num(ins, n, n);
                    outs[0] = (a > b) as u8;
                    outs[1] = (a == b) as u8;
                    outs[2] = (a < b) as u8;
                }
            }
            DFF => {
                let d = ins[0];
                let clk = ins[1];
                let s = ins[2];
                let r = ins[3];
                let edge = self.st_pc[i] == 0 && clk == 1;
                self.st_pc[i] = clk;
                if r == 1 { self.st_q[i] = 0; }
                else if s == 1 { self.st_q[i] = 1; }
                else if edge { self.st_q[i] = d; }
                let q = self.st_q[i];
                outs[0] = q;
                outs[1] = flip(q);
            }
            ROM => {
                let abits = self.p0[i] as usize;
                let dbits = self.p1[i] as usize;
                let addr = to_num(ins, 0, abits);
                if addr < 0 {
                    for b in 0..dbits { outs[b] = X; }
                } else {
                    let w = self.rom[self.mem_off[i] as usize + addr as usize] as i32;
                    write_num(outs, 0, dbits, w);
                }
            }
            RAM => {
                let n = self.p0[i] as usize;
                let abits = self.p1[i] as usize;
                let addr = to_num(ins, n + 2, abits);
                let clk = ins[n + 1];
                let edge = self.st_pc[i] == 0 && clk == 1;
                self.st_pc[i] = clk;
                let base = self.mem_off[i] as usize;
                if edge && ins[n] == 1 {
                    let data = to_num(ins, 0, n);
                    if addr >= 0 && data >= 0 {
                        self.ram[base + addr as usize] = data as u8;
                    }
                }
                if addr < 0 {
                    for b in 0..no {
                        outs[b] = X;
                    }
                } else {
                    let w = self.ram[base + addr as usize] as i32;
                    write_num(outs, 0, n, w);
                }
            }
            CLOCK => outs[0] = self.st_q[i],
            ACIA => {
                let a = &mut self.acias[self.mem_off[i] as usize];
                a.evaluate(ins);
                let d = a.out();
                for b in 0..8 {
                    outs[b] = (d >> b) & 1;
                }
                outs[8] = if a.irq() { 0 } else { 1 };
            }
            _ => {}
        }
    }

    #[inline(always)]
    fn commit_outs(&mut self, i: usize) {
        let os = self.out_start[i] as usize;
        let no = self.n_outs[i] as usize;
        for o in 0..no {
            let net = self.out_nets[os + o] as usize;
            let v = self.outs[o];
            if self.values[net] == v { continue; }
            self.values[net] = v;
            let end = self.reader_start[net + 1] as usize;
            let mut r = self.reader_start[net] as usize;
            while r < end {
                let slot = self.reader_slot[r];
                self.pins[(slot >> 1) as usize] = if v == Z && (slot & 1) == 0 { X } else { v };
                let part = self.reader_part[r] as usize;
                match self.reader_wake[r] {
                    1 => self.flag_fast(part),
                    2 => {
                        if v == 0 { self.st_pc[part] = 0; } else { self.flag_fast(part); }
                    }
                    _ => {}
                }
                r += 1;
            }
        }
    }

    fn comb_pass(&mut self) {
        while self.lo as isize <= self.hi {
            let lo = self.lo;
            let hi = self.hi as usize;
            self.lo = self.rank_flag.len();
            self.hi = -1;
            for r in lo..=hi {
                if self.rank_flag[r] == 0 { continue; }
                self.rank_flag[r] = 0;
                let i = self.order[r] as usize;
                self.evaluate(i);
                self.commit_outs(i);
            }
        }
    }

    fn registered_round(&mut self) {
        let n = self.reg_count;
        for k in 0..n {
            let i = self.reg_list[k];
            self.reg_run[k] = i;
            self.reg_queued[i as usize] = 0;
        }
        self.reg_count = 0;
        // Evaluate all, then commit all: the outputs are kept per part in `reg_outs`.
        for k in 0..n {
            let i = self.reg_run[k] as usize;
            self.evaluate(i);
            let no = self.n_outs[i] as usize;
            let (outs, saved) = (&self.outs, &mut self.saved[k]);
            saved[..no].copy_from_slice(&outs[..no]);
        }
        for k in 0..n {
            let i = self.reg_run[k] as usize;
            let no = self.n_outs[i] as usize;
            let saved = self.saved[k];
            self.outs[..no].copy_from_slice(&saved[..no]);
            self.commit_outs(i);
        }
    }

    pub fn settle(&mut self) -> bool {
        for _ in 0..64 {
            self.comb_pass();
            if self.reg_count == 0 && self.hi < self.lo as isize {
                return true;
            }
            self.ticks += 1;
            self.registered_round();
        }
        false
    }
}

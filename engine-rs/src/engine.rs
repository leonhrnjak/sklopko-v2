//! The engine: the compiled circuit in tables, and the settle loop of the TypeScript fast engine (`settleFast`, `combPass`,
//! `registeredRound`, `commitOuts` and `flagFast` in src/engine/simulator.ts), step for step. What each part computes is in `parts`.

use crate::parts::acia::Acia;
use crate::parts::util::{X, Z};
use crate::parts::{self, Cell, Console, Shared, Via, Lcd, CONSOLE_EVENT_LIMIT, LCD_FIELDS, VIA_FIELDS};

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
    shared: Shared,
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
    saved: Vec<[u8; 64]>,
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
        let n_fb = next() as usize;
        let n_console = next() as usize;
        let n_via = next() as usize;
        let n_lcd = next() as usize;
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
        let fb: Vec<u8> = (0..n_fb).map(|_| next() as u8).collect();
        let consoles: Vec<Console> = (0..n_console).map(|_| Console { events: Vec::new(), taken: vec![0; CONSOLE_EVENT_LIMIT] }).collect();
        let vias: Vec<Via> = (0..n_via).map(|_| Via::from_numbers(&(0..VIA_FIELDS).map(|_| next()).collect::<Vec<i32>>())).collect();
        let lcds: Vec<Lcd> = (0..n_lcd).map(|_| Lcd::from_numbers(&(0..LCD_FIELDS).map(|_| next()).collect::<Vec<i32>>())).collect();
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
            reader_part, reader_slot, reader_wake, order, rank,
            shared: Shared { rom, ram, fb, acias, consoles, vias, lcds },
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
            saved: vec![[0u8; 64]; n_parts],
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
        self.shared.ram.as_mut_ptr()
    }
    pub fn fb_ptr(&mut self) -> *mut u8 {
        self.shared.fb.as_mut_ptr()
    }
    pub fn lcd_ptr(&mut self) -> *mut i32 {
        self.shared.lcds.as_mut_ptr() as *mut i32
    }
    pub fn via_ptr(&mut self) -> *mut i32 {
        self.shared.vias.as_mut_ptr() as *mut i32
    }
    pub fn console_take_events(&mut self, k: usize) -> usize {
        let c = &mut self.shared.consoles[k];
        let n = c.events.len();
        c.taken[..n].copy_from_slice(&c.events);
        c.events.clear();
        n
    }
    pub fn console_events_ptr(&mut self, k: usize) -> *mut u16 {
        self.shared.consoles[k].taken.as_mut_ptr()
    }
    pub fn acia_regs_ptr(&mut self, k: usize) -> *mut u8 {
        self.shared.acias[k].regs.as_mut_ptr()
    }
    pub fn acia_key(&mut self, k: usize, code: u8) {
        self.shared.acias[k].key(code)
    }
    pub fn acia_clear_keys(&mut self, k: usize) {
        self.shared.acias[k].clear_keys()
    }
    pub fn acia_pending(&self, k: usize) -> usize {
        self.shared.acias[k].pending()
    }
    pub fn acia_take_events(&mut self, k: usize) -> usize {
        let a = &mut self.shared.acias[k];
        let n = a.events.len();
        a.taken[..n].copy_from_slice(&a.events);
        a.events.clear();
        n
    }
    pub fn acia_events_ptr(&mut self, k: usize) -> *mut u16 {
        self.shared.acias[k].taken.as_mut_ptr()
    }

    /// The clock part shows `phase`, and is flagged for the next settle.
    pub fn set_phase(&mut self, c: usize, phase: u8) {
        self.st_q[c] = phase;
        self.flag_fast(c);
    }

    pub fn acia_queue_ptr(&mut self, k: usize) -> *const u8 {
        self.shared.acias[k].queue_ptr()
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
        let mut cell = Cell {
            ins: &self.pins[ps..ps + ni],
            outs: &mut self.outs,
            no: self.n_outs[i] as usize,
            n: &mut self.st_n[i],
            pc: &mut self.st_pc[i],
            q: &mut self.st_q[i],
            p0: self.p0[i],
            p1: self.p1[i],
            p2: self.p2[i],
            mem_off: self.mem_off[i] as usize,
        };
        parts::eval(self.kind[i], &mut cell, &mut self.shared);
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

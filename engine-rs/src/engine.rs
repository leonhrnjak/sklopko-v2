//! The engine: the compiled circuit in tables, and the settle loop of the TypeScript fast engine (`settleFast`, `combPass`,
//! `registeredRound`, `commitOuts` and `flagFast` in src/engine/simulator.ts), step for step. What each part computes is in `parts`.

use crate::parts::acia::Acia;
use crate::parts::util::{X, Z};
use crate::parts::{self, Cell, Console, Shared, Via, Lcd, Cpu, Programs, CONSOLE_EVENT_LIMIT, CPU_FIELDS, LCD_FIELDS, VIA_FIELDS};

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
    // The exact (unit-delay) engine: parts that changed a tick ago are in `queue` (stale = 1); a part with a delay keeps what it
    // computed in `pipe` and moves on every tick.
    stale: Vec<u8>,
    queue: Vec<u32>,
    running: Vec<u32>,
    queued: usize,
    changed: Vec<u32>,
    pipe: Vec<Vec<u8>>,
    slow: Vec<u32>,
    forced: Vec<i8>,
    any_forced: bool,
    /// Which engine the flags are for (`mark_all`).
    fast_mode: bool,
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
        let n_cpu = next() as usize;
        let n_pipes = next() as usize;
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
        let mut pipe: Vec<Vec<u8>> = vec![Vec::new(); n_parts];
        let mut slow = Vec::new();
        for _ in 0..n_pipes {
            let part = next() as usize;
            let len = next() as usize;
            pipe[part] = (0..len).map(|_| next() as u8).collect();
            slow.push(part as u32);
        }
        let rom: Vec<u16> = (0..n_rom).map(|_| next() as u16).collect();
        let ram: Vec<u8> = (0..n_ram).map(|_| next() as u8).collect();
        let fb: Vec<u8> = (0..n_fb).map(|_| next() as u8).collect();
        let consoles: Vec<Console> = (0..n_console).map(|_| Console { events: Vec::new(), taken: vec![0; CONSOLE_EVENT_LIMIT] }).collect();
        let vias: Vec<Via> = (0..n_via).map(|_| Via::from_numbers(&(0..VIA_FIELDS).map(|_| next()).collect::<Vec<i32>>())).collect();
        let lcds: Vec<Lcd> = (0..n_lcd).map(|_| Lcd::from_numbers(&(0..LCD_FIELDS).map(|_| next()).collect::<Vec<i32>>())).collect();
        let cpus: Vec<Cpu> = (0..n_cpu).map(|_| Cpu::from_numbers(&(0..CPU_FIELDS).map(|_| next()).collect::<Vec<i32>>())).collect();
        let programs = if n_cpu > 0 { Some(Programs::build(&(0..2 * 256 * 7).map(|_| next()).collect::<Vec<i32>>())) } else { None };
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
            shared: Shared { rom, ram, fb, acias, consoles, vias, lcds, cpus, programs },
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
            stale: vec![0; n_parts],
            queue: vec![0; n_parts],
            running: vec![0; n_parts],
            queued: 0,
            changed: Vec::with_capacity(n_nets),
            pipe,
            slow,
            forced: vec![-1; n_nets],
            any_forced: false,
            fast_mode: true,
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
    pub fn cpu_ptr(&mut self) -> *mut i32 {
        self.shared.cpus.as_mut_ptr() as *mut i32
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
        self.flag(c);
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

    /// Flag a part for the engine that runs now.
    fn flag(&mut self, i: usize) {
        if self.fast_mode {
            self.flag_fast(i);
        } else if self.stale[i] == 0 {
            self.stale[i] = 1;
            self.queue[self.queued] = i as u32;
            self.queued += 1;
        }
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
        // A receive label that nothing publishes sets its first output only: the others stay as they are.
        if self.kind[i] == parts::kind::NETRECV {
            let os = self.out_start[i] as usize;
            for o in 0..self.n_outs[i] as usize { self.outs[o] = self.values[self.out_nets[os + o] as usize]; }
        }
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

    /// Flag every part for whichever engine runs next (`fast` or the exact one): each is re-evaluated once, which changes nothing in a
    /// circuit that is up to date.
    pub fn mark_all(&mut self, fast: bool) {
        self.fast_mode = fast;
        let n = self.kind.len();
        if fast {
            // (not the parts the module does not run: they keep what the page put on their nets)
            for i in 0..n {
                if self.kind[i] != 0 { self.flag_fast(i); }
            }
        } else {
            self.queued = 0;
            for i in 0..n {
                self.stale[i] = 0;
                if self.kind[i] != 0 {
                    self.queue[self.queued] = i as u32;
                    self.stale[i] = 1;
                    self.queued += 1;
                }
            }
        }
    }

    /// Hold the net at 0 or 1 whatever its part says (`v` = 0 or 1), or let it go (-1).
    pub fn set_force(&mut self, net: usize, v: i8) {
        self.forced[net] = v;
        self.any_forced = self.forced.iter().any(|&f| f >= 0);
    }

    pub fn pipe_ptr(&mut self, part: usize) -> *mut u8 {
        self.pipe[part].as_mut_ptr()
    }
    pub fn pipe_len(&self, part: usize) -> usize {
        self.pipe[part].len()
    }

    /// Run one part for the exact engine and put its outputs (or, for a slow part, what it computed `delay - 1` ticks ago) on the nets.
    fn exact_eval(&mut self, i: usize) {
        // (a part the module does not run, a switch or a label, keeps what the page put on its nets)
        if self.kind[i] == 0 { return; }
        self.evaluate(i);
        let os = self.out_start[i] as usize;
        let n = self.n_outs[i] as usize;
        let slow = !self.pipe[i].is_empty();
        for o in 0..n {
            let net = self.out_nets[os + o] as usize;
            let mut v = if slow { self.pipe[i][o] } else { self.outs[o] };
            if self.any_forced && self.forced[net] >= 0 { v = self.forced[net] as u8; }
            if self.values[net] != v {
                self.values[net] = v;
                self.changed.push(net as u32);
            }
        }
        if slow {
            let pipe = &mut self.pipe[i];
            let len = pipe.len();
            pipe.copy_within(n.., 0);
            pipe[len - n..].copy_from_slice(&self.outs[..n]);
        }
    }

    /// One gate delay. Returns true if the circuit is still moving: a net changed, or a slow part has an output on its way.
    pub fn tick(&mut self) -> bool {
        let count = self.queued;
        std::mem::swap(&mut self.queue, &mut self.running);
        self.queued = 0;
        self.changed.clear();
        for k in 0..count {
            let i = self.running[k] as usize;
            self.stale[i] = 0;
            if self.pipe[i].is_empty() { self.exact_eval(i); }
        }
        for k in 0..self.slow.len() {
            let i = self.slow[k] as usize;
            self.stale[i] = 0;
            self.exact_eval(i);
        }
        let moved = !self.changed.is_empty();
        for k in 0..self.changed.len() {
            let net = self.changed[k] as usize;
            let v = self.values[net];
            let end = self.reader_start[net + 1] as usize;
            let mut r = self.reader_start[net] as usize;
            while r < end {
                let slot = self.reader_slot[r];
                self.pins[(slot >> 1) as usize] = if v == Z && (slot & 1) == 0 { X } else { v };
                let part = self.reader_part[r] as usize;
                if self.stale[part] == 0 {
                    self.stale[part] = 1;
                    self.queue[self.queued] = part as u32;
                    self.queued += 1;
                }
                r += 1;
            }
        }
        self.ticks += 1;
        let mut pending = false;
        'outer: for &i in &self.slow {
            let i = i as usize;
            let n = self.n_outs[i] as usize;
            let os = self.out_start[i] as usize;
            for k in 0..self.pipe[i].len() {
                let net = self.out_nets[os + k % n] as usize;
                if self.pipe[i][k] != self.values[net] && !(self.any_forced && self.forced[net] >= 0) {
                    pending = true;
                    break 'outer;
                }
            }
        }
        moved || pending
    }
}

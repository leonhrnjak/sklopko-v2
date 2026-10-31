//! The register side of the 6551-style terminal (src/engine/acia.ts and components/terminal.ts): the registers and the keyboard queue.
//! The screen stays on the page: what the program prints is logged as events, and the page prints them.

/// Event: the page wipes the screen (the terminal was reset).
pub const WIPE: u16 = 256;

/// Characters that can wait on the keyboard (the page decides what it accepts; this is only a limit on memory).
const KEY_LIMIT: usize = 1 << 16;
/// Screen events that can wait for the page (it takes them at every frame; a program that prints without end loses the oldest).
const EVENT_LIMIT: usize = 1 << 16;

pub struct Acia {
    /// command, control, rx, full, interrupt, pc, out: the page reads them from here as seven bytes.
    pub regs: [u8; 8],
    pub reset_clears: bool,
    keys: std::collections::VecDeque<u8>,
    pub events: Vec<u16>,
    pub taken: Vec<u16>,
}

const COMMAND: usize = 0;
const CONTROL: usize = 1;
const RX: usize = 2;
const FULL: usize = 3;
const INTERRUPT: usize = 4;
const PC: usize = 5;
const OUT: usize = 6;

impl Acia {
    pub fn new(regs: [u8; 8], reset_clears: bool) -> Acia {
        Acia { regs, reset_clears, keys: std::collections::VecDeque::new(), events: Vec::new(), taken: vec![0; EVENT_LIMIT] }
    }

    fn receiver_on(&self) -> bool {
        self.regs[COMMAND] & 1 == 1
    }
    fn interrupt_on(&self) -> bool {
        self.regs[COMMAND] & 2 == 0
    }
    pub fn irq(&self) -> bool {
        self.regs[INTERRUPT] != 0
    }
    pub fn out(&self) -> u8 {
        self.regs[OUT]
    }
    pub fn pending(&self) -> usize {
        self.keys.len()
    }
    pub fn key(&mut self, code: u8) {
        if self.keys.len() < KEY_LIMIT {
            self.keys.push_back(code);
        }
    }
    pub fn clear_keys(&mut self) {
        self.keys.clear();
    }

    fn put(&mut self, code: u16) {
        if self.events.len() >= EVENT_LIMIT {
            self.events.remove(0);
        }
        self.events.push(code);
    }

    /// `aciaReset`.
    fn reset(&mut self) {
        self.regs[COMMAND] = 0;
        self.regs[CONTROL] = 0;
        self.regs[RX] = 0;
        self.regs[FULL] = 0;
        self.regs[INTERRUPT] = 0;
    }

    /// `aciaWipe`: nothing waits on the keyboard; the page wipes the screen.
    fn wipe(&mut self) {
        self.keys.clear();
        self.put(WIPE);
    }

    /// `aciaClock`.
    fn clock(&mut self) {
        if self.regs[FULL] != 0 || !self.receiver_on() {
            return;
        }
        if let Some(k) = self.keys.pop_front() {
            self.regs[RX] = k;
            self.regs[FULL] = 1;
            if self.interrupt_on() {
                self.regs[INTERRUPT] = 1;
            }
        }
    }

    fn read(&mut self, rs: u8, dsr: bool) -> u8 {
        match rs & 3 {
            0 => {
                self.regs[FULL] = 0;
                self.regs[RX]
            }
            1 => {
                let v = (if self.regs[FULL] != 0 { 8 } else { 0 }) | 16 | (if dsr { 64 } else { 0 }) | (if self.regs[INTERRUPT] != 0 { 128 } else { 0 });
                self.regs[INTERRUPT] = 0;
                v
            }
            2 => self.regs[COMMAND],
            _ => self.regs[CONTROL],
        }
    }

    fn write(&mut self, rs: u8, value: u8) {
        match rs & 3 {
            0 => self.put((value & 0x7f) as u16),
            1 => {
                self.regs[COMMAND] &= 0xe0;
                self.regs[INTERRUPT] = 0;
            }
            2 => self.regs[COMMAND] = value,
            _ => self.regs[CONTROL] = value,
        }
    }

    /// The `evaluate` of the part: `ins` are its pins in the order PHI2, RESB, CS0, CS1B, RS0, RS1, RWB, DI0..7, DSRB. After it `out()` and
    /// `irq()` give the pins.
    pub fn evaluate(&mut self, ins: &[u8]) {
        let phi2 = ins[0];
        let rising = self.regs[PC] == 0 && phi2 == 1;
        if phi2 <= 1 {
            self.regs[PC] = phi2;
        }
        if ins[1] == 0 {
            self.reset();
            if self.reset_clears {
                self.wipe();
            }
            self.regs[OUT] = 0;
        } else if rising {
            self.regs[OUT] = 0;
            if ins[2] == 1 && ins[3] == 0 {
                let (a, b) = (ins[4], ins[5]);
                let rs_ok = a <= 1 && b <= 1;
                let rs = a | (b << 1);
                let rw = ins[6];
                if rs_ok && rw == 1 {
                    self.regs[OUT] = self.read(rs, ins[15] == 1);
                } else if rs_ok && rw == 0 {
                    let mut data = 0u8;
                    let mut ok = true;
                    for i in 0..8 {
                        let v = ins[7 + i];
                        if v > 1 {
                            ok = false;
                            break;
                        }
                        data |= v << i;
                    }
                    if ok {
                        self.write(rs, data);
                    }
                }
            }
            self.clock();
        }
    }
}

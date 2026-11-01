//! The MOS 6502 and the WDC 65C02 (`src/engine/cpu6502.ts` and `components/cpu.ts`), step for step: every instruction is a list of
//! bus cycles ("steps"), built from the opcode table the page sends, and the part runs one step per clock.

use super::kind::*;
use super::util::{to_num, write_num, X, Z};
use super::{Cell, Shared};

const FC: i32 = 1;
const FZ: i32 = 2;
const FI: i32 = 4;
const FD: i32 = 8;
const FB: i32 = 16;
const FU: i32 = 32;
const FV: i32 = 64;
const FN: i32 = 128;

const SKIP: i32 = 99;
const PROG_INTERRUPT: i32 = 256;
const PROG_RESET: i32 = 257;
const PROG_WAIT: i32 = -2;

/// The CPU and the part's own flags: all numbers, in the order of the page's `CPU_KEYS` (`src/engine/wasmengine.ts`), so that the page reads
/// the whole struct as an array of `CPU_FIELDS` numbers (`#[repr(C)]`); a flag is 0 or 1.
#[repr(C)]
#[derive(Clone, Default)]
pub struct Cpu {
    a: i32,
    x: i32,
    y: i32,
    sp: i32,
    pc: i32,
    p: i32,
    addr: i32,
    read: i32,
    out: i32,
    sync: i32,
    irq: i32,
    nmi_pending: i32,
    nmi_pin: i32,
    op: i32,
    prog: i32,
    t: i32,
    /// 0 none, 1 irq, 2 nmi.
    intr: i32,
    vec: i32,
    ea: i32,
    lo: i32,
    ptr: i32,
    val: i32,
    base: i32,
    cross: i32,
    off: i32,
    newpc: i32,
    cycles: i32,
    cmos: i32,
    wait: i32,
    bit: i32,
    vp: i32,
    ml: i32,
    // The part's.
    phi: i32,
    started: i32,
    held: i32,
    waiting: i32,
    stalled: i32,
}

pub const CPU_FIELDS: usize = 37;

impl Cpu {
    pub fn from_numbers(v: &[i32]) -> Cpu {
        assert!(v.len() == CPU_FIELDS);
        let mut s = Cpu::default();
        // SAFETY: `Cpu` is `repr(C)` and made of CPU_FIELDS i32.
        unsafe { std::ptr::copy_nonoverlapping(v.as_ptr(), &mut s as *mut Cpu as *mut i32, CPU_FIELDS) };
        s
    }
}

type Acc = Box<dyn Fn(&mut Cpu)>;
type End = Box<dyn Fn(&mut Cpu, i32)>;
type Skip = Box<dyn Fn(&Cpu) -> bool>;

pub struct Step {
    a: Acc,
    e: Option<End>,
    skip: Option<Skip>,
    vp: bool,
    ml: bool,
}

/// One row of the page's opcode table.
#[derive(Clone)]
pub struct Opcode {
    pub valid: bool,
    pub mnemonic: String,
    pub mode: String,
    /// 0 read, 1 write, 2 rmw, 3 other.
    pub kind: i32,
    pub cycles: i32,
    pub page_cross: bool,
    pub bit: Option<i32>,
}

/// The programs of every opcode and of the interrupt and reset sequences, for the NMOS chip and the 65C02.
pub struct Programs {
    nmos: Vec<Vec<Step>>,
    cmos: Vec<Vec<Step>>,
}

impl Programs {
    /// `table` holds, for the NMOS chip then the 65C02, 256 rows of 7 numbers (valid, mnemonic, mode, kind, cycles, page cross, bit or -1);
    /// a mnemonic or a mode is its characters packed in a number, the first one the lowest.
    pub fn build(table: &[i32]) -> Programs {
        let unpack = |mut n: i32| {
            let mut s = String::new();
            while n != 0 {
                s.push((n & 0xff) as u8 as char);
                n >>= 8;
            }
            s
        };
        let rows = |flavor: usize| -> Vec<Opcode> {
            (0..256)
                .map(|op| {
                    let r = &table[(flavor * 256 + op) * 7..(flavor * 256 + op) * 7 + 7];
                    Opcode { valid: r[0] != 0, mnemonic: unpack(r[1]), mode: unpack(r[2]), kind: r[3], cycles: r[4], page_cross: r[5] != 0, bit: if r[6] >= 0 { Some(r[6]) } else { None } }
                })
                .collect()
        };
        let build = |ops: Vec<Opcode>, cmos: bool| -> Vec<Vec<Step>> {
            let mut v: Vec<Vec<Step>> = ops.iter().map(|o| if o.valid { program(o, cmos) } else { vec![dummy_pc()] }).collect();
            v.push(interrupt());
            v.push(reset_steps());
            v
        };
        Programs { nmos: build(rows(0), false), cmos: build(rows(1), true) }
    }
}

// ---- Pins and helpers -----------------------------------------------------------------------------

fn rd(c: &mut Cpu, addr: i32) {
    c.addr = addr & 0xffff;
    c.read = 1;
}
fn wr(c: &mut Cpu, addr: i32, v: i32) {
    c.addr = addr & 0xffff;
    c.read = 0;
    c.out = v & 255;
}
fn step(a: impl Fn(&mut Cpu) + 'static, e: Option<End>) -> Step {
    Step { a: Box::new(a), e, skip: None, vp: false, ml: false }
}
fn end(e: impl Fn(&mut Cpu, i32) + 'static) -> Option<End> {
    Some(Box::new(e))
}
fn begin(c: &mut Cpu, s: &Step) {
    (s.a)(c);
    c.vp = s.vp as i32;
    c.ml = s.ml as i32;
}
fn set_nz(c: &mut Cpu, v: i32) {
    c.p = (c.p & !(FN | FZ)) | (v & FN) | if v & 255 != 0 { 0 } else { FZ };
}
fn flag(c: &mut Cpu, f: i32, on: bool) {
    c.p = if on { c.p | f } else { c.p & !f };
}
fn push_addr(c: &Cpu) -> i32 {
    0x100 | c.sp
}
fn rd_pc(c: &mut Cpu) {
    let pc = c.pc;
    rd(c, pc);
}
fn inc_pc(c: &mut Cpu) {
    c.pc = (c.pc + 1) & 0xffff;
}
fn dummy_pc() -> Step {
    step(rd_pc, None)
}
fn last_byte(c: &mut Cpu) {
    let pc = c.pc - 1;
    rd(c, pc);
}

// ---- Operations -----------------------------------------------------------------------------------

fn signed_hi(v: i32) -> i32 {
    ((v & 0xf0) ^ 0x80) - 0x80
}

fn adc(c: &mut Cpu, m: i32) {
    let a = c.a;
    let cin = c.p & FC;
    let sum = a + m + cin;
    if c.p & FD != 0 {
        let mut al = (a & 15) + (m & 15) + cin;
        if al >= 10 { al = ((al + 6) & 15) + 16; }
        let ss = signed_hi(a) + signed_hi(m) + al;
        let mut s = (a & 0xf0) + (m & 0xf0) + al;
        flag(c, FZ, (sum & 255) == 0);
        flag(c, FN, (ss & 0x80) != 0);
        flag(c, FV, !(-128..=127).contains(&ss));
        if s >= 0xa0 { s += 0x60; }
        flag(c, FC, s >= 0x100);
        c.a = s & 255;
        return;
    }
    flag(c, FV, ((a ^ sum) & (m ^ sum) & 0x80) != 0);
    flag(c, FC, sum > 255);
    c.a = sum & 255;
    let a = c.a;
    set_nz(c, a);
}

fn sbc(c: &mut Cpu, m: i32) {
    let a = c.a;
    let cin = c.p & FC;
    let diff = a - m - (1 - cin);
    flag(c, FV, ((a ^ m) & (a ^ diff) & 0x80) != 0);
    flag(c, FC, diff >= 0);
    set_nz(c, diff & 255);
    if c.p & FD != 0 {
        let mut al = (a & 15) - (m & 15) + cin - 1;
        if al < 0 { al = ((al - 6) & 15) - 16; }
        let mut r = (a & 0xf0) - (m & 0xf0) + al;
        if r < 0 { r -= 0x60; }
        c.a = r & 255;
        return;
    }
    c.a = diff & 255;
}

fn adc65c02(c: &mut Cpu, m: i32) {
    if c.p & FD == 0 { return adc(c, m); }
    let a = c.a;
    let cin = c.p & FC;
    let mut al = (a & 15) + (m & 15) + cin;
    if al >= 10 { al = ((al + 6) & 15) + 16; }
    let ss = signed_hi(a) + signed_hi(m) + al;
    let mut s = (a & 0xf0) + (m & 0xf0) + al;
    flag(c, FV, !(-128..=127).contains(&ss));
    if s >= 0xa0 { s += 0x60; }
    flag(c, FC, s >= 0x100);
    c.a = s & 255;
    let a = c.a;
    set_nz(c, a);
}

fn sbc65c02(c: &mut Cpu, m: i32) {
    if c.p & FD == 0 { return sbc(c, m); }
    let a = c.a;
    let borrow = 1 - (c.p & FC);
    let diff = a - m - borrow;
    flag(c, FV, ((a ^ m) & (a ^ diff) & 0x80) != 0);
    flag(c, FC, diff >= 0);
    let mut r = diff;
    if diff < 0 { r -= 0x60; }
    if (a & 15) - (m & 15) - borrow < 0 { r -= 6; }
    c.a = r & 255;
    let a = c.a;
    set_nz(c, a);
}

fn compare(c: &mut Cpu, r: i32, m: i32) {
    flag(c, FC, r >= m);
    set_nz(c, (r - m) & 255);
}

/// Instructions that read a value and do something with it.
fn read_op(m: &str) -> fn(&mut Cpu, i32) {
    match m {
        "LDA" => |c, d| { c.a = d; set_nz(c, d); },
        "LDX" => |c, d| { c.x = d; set_nz(c, d); },
        "LDY" => |c, d| { c.y = d; set_nz(c, d); },
        "ADC" => |c, d| if c.cmos != 0 { adc65c02(c, d) } else { adc(c, d) },
        "SBC" => |c, d| if c.cmos != 0 { sbc65c02(c, d) } else { sbc(c, d) },
        "AND" => |c, d| { c.a &= d; let a = c.a; set_nz(c, a); },
        "ORA" => |c, d| { c.a |= d; let a = c.a; set_nz(c, a); },
        "EOR" => |c, d| { c.a ^= d; let a = c.a; set_nz(c, a); },
        "CMP" => |c, d| { let a = c.a; compare(c, a, d); },
        "CPX" => |c, d| { let x = c.x; compare(c, x, d); },
        "CPY" => |c, d| { let y = c.y; compare(c, y, d); },
        "BIT" => |c, d| {
            flag(c, FZ, (c.a & d) == 0);
            flag(c, FN, (d & 0x80) != 0);
            flag(c, FV, (d & 0x40) != 0);
        },
        _ => |_, _| {}, // NOP
    }
}

/// Instructions that change a value in place (in memory, or in A): value in, value out.
fn rmw_op(m: &str) -> fn(&mut Cpu, i32) -> i32 {
    match m {
        "ASL" => |c, v| { flag(c, FC, (v & 0x80) != 0); set_nz(c, (v << 1) & 255); (v << 1) & 255 },
        "LSR" => |c, v| { flag(c, FC, (v & 1) != 0); set_nz(c, v >> 1); v >> 1 },
        "ROL" => |c, v| { let r = ((v << 1) | (c.p & FC)) & 255; flag(c, FC, (v & 0x80) != 0); set_nz(c, r); r },
        "ROR" => |c, v| { let r = (v >> 1) | ((c.p & FC) << 7); flag(c, FC, (v & 1) != 0); set_nz(c, r); r },
        "INC" => |c, v| { set_nz(c, (v + 1) & 255); (v + 1) & 255 },
        "DEC" => |c, v| { set_nz(c, (v - 1) & 255); (v - 1) & 255 },
        "TSB" => |c, v| { flag(c, FZ, (c.a & v) == 0); v | c.a },
        "TRB" => |c, v| { flag(c, FZ, (c.a & v) == 0); v & !c.a },
        _ => |_, v| v,
    }
}

fn store_op(m: &str) -> fn(&Cpu) -> i32 {
    match m {
        "STA" => |c| c.a,
        "STX" => |c| c.x,
        "STY" => |c| c.y,
        _ => |_| 0, // STZ
    }
}

fn implied_op(m: &str) -> fn(&mut Cpu, i32) {
    match m {
        "INX" => |c, _| { c.x = (c.x + 1) & 255; let x = c.x; set_nz(c, x); },
        "INY" => |c, _| { c.y = (c.y + 1) & 255; let y = c.y; set_nz(c, y); },
        "DEX" => |c, _| { c.x = (c.x - 1) & 255; let x = c.x; set_nz(c, x); },
        "DEY" => |c, _| { c.y = (c.y - 1) & 255; let y = c.y; set_nz(c, y); },
        "TAX" => |c, _| { c.x = c.a; let x = c.x; set_nz(c, x); },
        "TAY" => |c, _| { c.y = c.a; let y = c.y; set_nz(c, y); },
        "TXA" => |c, _| { c.a = c.x; let a = c.a; set_nz(c, a); },
        "TYA" => |c, _| { c.a = c.y; let a = c.a; set_nz(c, a); },
        "TSX" => |c, _| { c.x = c.sp; let x = c.x; set_nz(c, x); },
        "TXS" => |c, _| c.sp = c.x,
        "CLC" => |c, _| flag(c, FC, false),
        "SEC" => |c, _| flag(c, FC, true),
        "CLI" => |c, _| flag(c, FI, false),
        "SEI" => |c, _| flag(c, FI, true),
        "CLV" => |c, _| flag(c, FV, false),
        "CLD" => |c, _| flag(c, FD, false),
        "SED" => |c, _| flag(c, FD, true),
        _ => |_, _| {}, // NOP
    }
}

fn branch_taken(m: &str) -> Option<fn(&Cpu) -> bool> {
    Some(match m {
        "BCC" => |c| c.p & FC == 0,
        "BCS" => |c| c.p & FC != 0,
        "BNE" => |c| c.p & FZ == 0,
        "BEQ" => |c| c.p & FZ != 0,
        "BPL" => |c| c.p & FN == 0,
        "BMI" => |c| c.p & FN != 0,
        "BVC" => |c| c.p & FV == 0,
        "BVS" => |c| c.p & FV != 0,
        _ => return None,
    })
}

// ---- The cycles of each instruction ---------------------------------------------------------------

fn index_into(c: &mut Cpu, reg: i32, hi: i32) {
    let sum = c.lo + reg;
    c.cross = (sum > 255) as i32;
    c.base = (hi << 8) | (sum & 255);
    c.ea = ((hi << 8) + sum) & 0xffff;
}

/// Steps that find the operand's address (left in `ea`), for modes that have one.
fn address_steps(mode: &str) -> Vec<Step> {
    let zp = || step(rd_pc, end(|c, d| { inc_pc(c); c.ea = d; }));
    let lo = || step(rd_pc, end(|c, d| { inc_pc(c); c.lo = d; }));
    let abs = || step(rd_pc, end(|c, d| { inc_pc(c); c.ea = c.lo | (d << 8); }));
    match mode {
        "zp" => vec![zp()],
        "zpx" => vec![zp(), step(|c| { let e = c.ea; rd(c, e) }, end(|c, _| c.ea = (c.ea + c.x) & 255))],
        "zpy" => vec![zp(), step(|c| { let e = c.ea; rd(c, e) }, end(|c, _| c.ea = (c.ea + c.y) & 255))],
        "abs" => vec![lo(), abs()],
        "abx" => vec![lo(), step(rd_pc, end(|c, d| { inc_pc(c); let x = c.x; index_into(c, x, d); }))],
        "aby" => vec![lo(), step(rd_pc, end(|c, d| { inc_pc(c); let y = c.y; index_into(c, y, d); }))],
        "izx" => vec![
            step(rd_pc, end(|c, d| { inc_pc(c); c.ptr = d; })),
            step(|c| { let p = c.ptr; rd(c, p) }, end(|c, _| c.ptr = (c.ptr + c.x) & 255)),
            step(|c| { let p = c.ptr; rd(c, p) }, end(|c, d| c.lo = d)),
            step(|c| { let p = (c.ptr + 1) & 255; rd(c, p) }, end(|c, d| c.ea = c.lo | (d << 8))),
        ],
        "izy" => vec![
            step(rd_pc, end(|c, d| { inc_pc(c); c.ptr = d; })),
            step(|c| { let p = c.ptr; rd(c, p) }, end(|c, d| c.lo = d)),
            step(|c| { let p = (c.ptr + 1) & 255; rd(c, p) }, end(|c, d| { let y = c.y; index_into(c, y, d); })),
        ],
        "izp" => vec![
            step(rd_pc, end(|c, d| { inc_pc(c); c.ptr = d; })),
            step(|c| { let p = c.ptr; rd(c, p) }, end(|c, d| c.lo = d)),
            step(|c| { let p = (c.ptr + 1) & 255; rd(c, p) }, end(|c, d| c.ea = c.lo | (d << 8))),
        ],
        _ => vec![],
    }
}

fn decimal_cycle(immediate: bool, sbc: bool) -> Step {
    let mut s = step(
        move |c| {
            let a = if immediate { if sbc { 0 } else { 0x7f } } else { c.ea };
            rd(c, a)
        },
        None,
    );
    s.skip = Some(Box::new(|c| c.p & FD == 0));
    s
}

fn stack_push(value: fn(&Cpu) -> i32) -> Step {
    step(move |c| { let a = push_addr(c); let v = value(c); wr(c, a, v) }, end(|c, _| c.sp = (c.sp - 1) & 255))
}
fn stack_pull(e: End) -> Step {
    step(|c| { let a = push_addr(c); rd(c, a) }, Some(e))
}
fn pull_sp() -> Step {
    step(|c| { let a = push_addr(c); rd(c, a) }, end(|c, _| c.sp = (c.sp + 1) & 255))
}
fn vector(low: fn(&Cpu) -> i32) -> Vec<Step> {
    let mut a = step(move |c| { let l = low(c); rd(c, l) }, end(|c, d| c.lo = d));
    a.vp = true;
    let mut b = step(move |c| { let l = low(c) + 1; rd(c, l) }, end(|c, d| c.pc = c.lo | (d << 8)));
    b.vp = true;
    vec![a, b]
}

/// The steps of one instruction after its opcode fetch, for the NMOS 6502 or (`cmos`) the 65C02.
fn program(o: &Opcode, cmos: bool) -> Vec<Step> {
    let m = o.mnemonic.as_str();
    let mode = o.mode.as_str();
    match m {
        "PHA" => return vec![dummy_pc(), stack_push(|c| c.a)],
        "PHX" => return vec![dummy_pc(), stack_push(|c| c.x)],
        "PHY" => return vec![dummy_pc(), stack_push(|c| c.y)],
        "PHP" => return vec![dummy_pc(), stack_push(|c| c.p | FB | FU)],
        "PLA" => return vec![dummy_pc(), pull_sp(), stack_pull(Box::new(|c, d| { c.a = d; set_nz(c, d); }))],
        "PLX" => return vec![dummy_pc(), pull_sp(), stack_pull(Box::new(|c, d| { c.x = d; set_nz(c, d); }))],
        "PLY" => return vec![dummy_pc(), pull_sp(), stack_pull(Box::new(|c, d| { c.y = d; set_nz(c, d); }))],
        "PLP" => return vec![dummy_pc(), pull_sp(), stack_pull(Box::new(|c, d| c.p = (d | FU) & !FB))],
        "JMP" => {
            if mode == "abs" {
                return vec![step(rd_pc, end(|c, d| { inc_pc(c); c.lo = d; })), step(rd_pc, end(|c, d| c.pc = c.lo | (d << 8)))];
            }
            if mode == "iax" {
                return vec![
                    step(rd_pc, end(|c, d| { inc_pc(c); c.lo = d; })),
                    step(rd_pc, end(|c, d| { inc_pc(c); c.ea = (c.lo | (d << 8)) + c.x; })),
                    step(|c| { let a = c.pc - 2; rd(c, a) }, None),
                    step(|c| { let a = c.ea; rd(c, a) }, end(|c, d| c.lo = d)),
                    step(|c| { let a = c.ea + 1; rd(c, a) }, end(|c, d| c.pc = c.lo | (d << 8))),
                ];
            }
            return if cmos {
                vec![
                    step(rd_pc, end(|c, d| { inc_pc(c); c.lo = d; })),
                    step(rd_pc, end(|c, d| { inc_pc(c); c.ea = c.lo | (d << 8); })),
                    step(|c| { let a = c.ea; rd(c, a) }, end(|c, d| c.lo = d)),
                    step(|c| { let a = c.ea + 1; rd(c, a) }, end(|c, d| c.pc = c.lo | (d << 8))),
                    step(|c| { let a = c.ea + 1; rd(c, a) }, None),
                ]
            } else {
                vec![
                    step(rd_pc, end(|c, d| { inc_pc(c); c.lo = d; })),
                    step(rd_pc, end(|c, d| { inc_pc(c); c.ea = c.lo | (d << 8); })),
                    step(|c| { let a = c.ea; rd(c, a) }, end(|c, d| c.lo = d)),
                    step(|c| { let a = (c.ea & 0xff00) | ((c.ea + 1) & 255); rd(c, a) }, end(|c, d| c.pc = c.lo | (d << 8))),
                ]
            };
        }
        "JSR" => {
            return vec![
                step(rd_pc, end(|c, d| { inc_pc(c); c.lo = d; })),
                step(|c| { let a = push_addr(c); rd(c, a) }, None),
                stack_push(|c| c.pc >> 8),
                stack_push(|c| c.pc & 255),
                step(rd_pc, end(|c, d| c.pc = c.lo | (d << 8))),
            ];
        }
        "RTS" => {
            return vec![
                dummy_pc(),
                pull_sp(),
                step(|c| { let a = push_addr(c); rd(c, a) }, end(|c, d| { c.lo = d; c.sp = (c.sp + 1) & 255; })),
                step(|c| { let a = push_addr(c); rd(c, a) }, end(|c, d| c.pc = c.lo | (d << 8))),
                step(rd_pc, end(|c, _| inc_pc(c))),
            ];
        }
        "RTI" => {
            return vec![
                dummy_pc(),
                pull_sp(),
                step(|c| { let a = push_addr(c); rd(c, a) }, end(|c, d| { c.p = (d | FU) & !FB; c.sp = (c.sp + 1) & 255; })),
                step(|c| { let a = push_addr(c); rd(c, a) }, end(|c, d| { c.lo = d; c.sp = (c.sp + 1) & 255; })),
                step(|c| { let a = push_addr(c); rd(c, a) }, end(|c, d| c.pc = c.lo | (d << 8))),
            ];
        }
        "BRK" => {
            let mut v = vec![
                step(rd_pc, end(|c, _| inc_pc(c))),
                stack_push(|c| c.pc >> 8),
                stack_push(|c| c.pc & 255),
                step(
                    |c| { let a = push_addr(c); let p = c.p | FB | FU; wr(c, a, p) },
                    end(move |c, _| { c.sp = (c.sp - 1) & 255; c.p |= FI; if cmos { c.p &= !FD; } }),
                ),
            ];
            v.extend(vector(|_| 0xfffe));
            return v;
        }
        "WAI" | "STP" => {
            let forever = if m == "STP" { 2 } else { 1 };
            return vec![dummy_pc(), step(rd_pc, end(move |c, _| c.wait = forever))];
        }
        _ => {}
    }
    let taken: Option<fn(&Cpu) -> bool> = if m == "BRA" { Some(|_| true) } else { branch_taken(m) };
    if let Some(taken) = taken {
        return vec![
            step(rd_pc, end(move |c, d| {
                inc_pc(c);
                if taken(c) { c.off = d; } else { c.t = SKIP; }
            })),
            step(rd_pc, end(|c, _| {
                c.newpc = (c.pc + if c.off < 128 { c.off } else { c.off - 256 }) & 0xffff;
                c.cross = ((c.newpc & 0xff00) != (c.pc & 0xff00)) as i32;
                c.pc = (c.pc & 0xff00) | (c.newpc & 255);
                if c.cross == 0 { c.t = SKIP; }
            })),
            step(rd_pc, end(|c, _| c.pc = c.newpc)),
        ];
    }
    if mode == "zpr" {
        let want = if m.starts_with("BBS") { 1 } else { 0 };
        let bit = o.bit.unwrap_or(0);
        return vec![
            step(rd_pc, end(|c, d| { inc_pc(c); c.ea = d; })),
            step(|c| { let a = c.ea; rd(c, a) }, end(|c, d| c.val = d)),
            step(|c| { let a = c.ea; rd(c, a) }, None),
            step(rd_pc, end(move |c, d| {
                inc_pc(c);
                if ((c.val >> bit) & 1) == want { c.off = d; } else { c.t = SKIP; }
            })),
            step(rd_pc, end(|c, _| {
                c.newpc = (c.pc + if c.off < 128 { c.off } else { c.off - 256 }) & 0xffff;
                c.cross = ((c.newpc & 0xff00) != (c.pc & 0xff00)) as i32;
                if c.cross == 0 {
                    c.pc = c.newpc;
                    c.t = SKIP;
                }
            })),
            step(rd_pc, end(|c, _| c.pc = c.newpc)),
        ];
    }
    if m == "NOP" && mode == "abs" {
        let mut v = address_steps("abs");
        v.push(step(last_byte, None));
        return v;
    }
    if mode == "imp" {
        return if o.cycles == 1 && m == "NOP" { vec![] } else { vec![step(rd_pc, Some(Box::new(implied_op(m))))] };
    }
    if mode == "acc" {
        let f = rmw_op(m);
        return vec![step(rd_pc, end(move |c, _| { let a = c.a; c.a = f(c, a); }))];
    }
    if mode == "imm" {
        if m == "BIT" {
            return vec![step(rd_pc, end(|c, d| { inc_pc(c); flag(c, FZ, (c.a & d) == 0); }))];
        }
        let f = read_op(m);
        let mut v = vec![step(rd_pc, end(move |c, d| { inc_pc(c); f(c, d); }))];
        if cmos && (m == "ADC" || m == "SBC") { v.push(decimal_cycle(true, m == "SBC")); }
        return v;
    }
    let mut v = address_steps(mode);
    let indexed = mode == "abx" || mode == "aby" || mode == "izy";
    let dummy: fn(&mut Cpu) = if cmos {
        |c| if c.cross != 0 { last_byte(c) } else { let a = c.ea; rd(c, a) }
    } else {
        |c| { let a = c.base; rd(c, a) }
    };
    if o.kind == 0 {
        let op = read_op(m);
        let extra = cmos && (m == "ADC" || m == "SBC");
        let done = if extra { v.len() as i32 + 1 } else { SKIP };
        if indexed {
            v.push(step(dummy, end(move |c, d| { if c.cross == 0 { op(c, d); c.t = done; } })));
            v.push(step(|c| { let a = c.ea; rd(c, a) }, end(move |c, d| op(c, d))));
        } else {
            v.push(step(|c| { let a = c.ea; rd(c, a) }, end(move |c, d| op(c, d))));
        }
        if extra { v.push(decimal_cycle(false, false)); }
        return v;
    }
    if o.kind == 1 {
        let value = store_op(m);
        if indexed {
            let f: fn(&mut Cpu) = if cmos { last_byte } else { |c| { let a = c.base; rd(c, a) } };
            v.push(step(f, None));
        }
        v.push(step(move |c| { let a = c.ea; let x = value(c); wr(c, a, x) }, None));
        return v;
    }
    // Read-modify-write: read, write the old value back (the 6502 does) or read it again (the 65C02 does), write the new one.
    let bit = o.bit;
    let fn_: Box<dyn Fn(&mut Cpu, i32) -> i32> = match bit {
        None => {
            let f = rmw_op(m);
            Box::new(move |c, v| f(c, v))
        }
        Some(b) if m.starts_with("RMB") => Box::new(move |_, v| v & !(1 << b)),
        Some(b) => Box::new(move |_, v| v | (1 << b)),
    };
    let fn_ = std::rc::Rc::new(fn_);
    let locked = |mut s: Step| {
        s.ml = true;
        s
    };
    if mode == "abx" {
        if cmos {
            let page_cross = o.page_cross;
            let mut s = step(last_byte, None);
            s.skip = Some(Box::new(move |c| c.cross == 0 && page_cross));
            s.ml = true;
            v.push(s);
        } else {
            v.push(step(|c| { let a = c.base; rd(c, a) }, None));
        }
    }
    v.push(locked(step(|c| { let a = c.ea; rd(c, a) }, end(|c, d| c.val = d))));
    if cmos {
        let f = fn_.clone();
        v.push(locked(step(|c| { let a = c.ea; rd(c, a) }, end(move |c, _| { let val = c.val; c.val = f(c, val); }))));
    } else {
        let f = fn_.clone();
        v.push(locked(step(|c| { let a = c.ea; let val = c.val; wr(c, a, val) }, end(move |c, _| { let val = c.val; c.val = f(c, val); }))));
    }
    v.push(locked(step(|c| { let a = c.ea; let val = c.val; wr(c, a, val) }, None)));
    v
}

/// Seven cycles that push the return address and the flags, then jump through a vector.
fn interrupt() -> Vec<Step> {
    let mut v = vec![
        dummy_pc(),
        step(|c| { let a = push_addr(c); let x = c.pc >> 8; wr(c, a, x) }, end(|c, _| c.sp = (c.sp - 1) & 255)),
        step(|c| { let a = push_addr(c); let x = c.pc & 255; wr(c, a, x) }, end(|c, _| c.sp = (c.sp - 1) & 255)),
        step(
            |c| { let a = push_addr(c); let p = (c.p | FU) & !FB; wr(c, a, p) },
            end(|c, _| { c.sp = (c.sp - 1) & 255; c.p |= FI; if c.cmos != 0 { c.p &= !FD; } }),
        ),
    ];
    let mut a = step(|c| { let a = c.vec; rd(c, a) }, end(|c, d| c.lo = d));
    a.vp = true;
    let mut b = step(|c| { let a = c.vec + 1; rd(c, a) }, end(|c, d| c.pc = c.lo | (d << 8)));
    b.vp = true;
    v.push(a);
    v.push(b);
    v
}

/// The reset sequence: like an interrupt, but nothing is written (the stack pointer still goes down three times).
fn reset_steps() -> Vec<Step> {
    let down = || end(|c, _| c.sp = (c.sp - 1) & 255);
    let mut v = vec![
        dummy_pc(),
        dummy_pc(),
        step(|c| { let a = push_addr(c); rd(c, a) }, down()),
        step(|c| { let a = push_addr(c); rd(c, a) }, down()),
        step(|c| { let a = push_addr(c); rd(c, a) }, end(|c, _| { c.sp = (c.sp - 1) & 255; c.p |= FI; if c.cmos != 0 { c.p &= !FD; } })),
    ];
    let mut a = step(|c| rd(c, 0xfffc), end(|c, d| c.lo = d));
    a.vp = true;
    let mut b = step(|c| rd(c, 0xfffd), end(|c, d| c.pc = c.lo | (d << 8)));
    b.vp = true;
    v.push(a);
    v.push(b);
    v
}

// ---- Running --------------------------------------------------------------------------------------

/// Set up an opcode fetch at `pc`, or, if an interrupt is waiting, one that turns into the interrupt sequence.
fn start_fetch(c: &mut Cpu) {
    c.prog = -1;
    c.vp = 0;
    c.ml = 0;
    if c.wait != 0 {
        if c.wait == 1 && (c.nmi_pending != 0 || c.irq != 0) {
            c.wait = 0;
        } else {
            c.prog = PROG_WAIT;
            c.sync = 0;
            let pc = c.pc;
            rd(c, pc);
            return;
        }
    }
    if c.nmi_pending != 0 {
        c.intr = 2;
        c.nmi_pending = 0;
        c.vec = 0xfffa;
    } else if c.irq != 0 && (c.p & FI) == 0 {
        c.intr = 1;
        c.vec = 0xfffe;
    } else {
        c.intr = 0;
    }
    c.sync = 1;
    let pc = c.pc;
    rd(c, pc);
}

/// Start the reset sequence.
fn reset(c: &mut Cpu, progs: &Programs) {
    c.prog = PROG_RESET;
    c.t = 0;
    c.wait = 0;
    c.intr = 0;
    c.nmi_pending = 0;
    c.sync = 0;
    let steps = if c.cmos != 0 { &progs.cmos } else { &progs.nmos };
    begin(c, &steps[PROG_RESET as usize][0]);
}

/// Finish the cycle on the pins (`d` is the byte read, ignored for a write) and set up the next one.
fn cycle(c: &mut Cpu, progs: &Programs, d: i32) {
    c.cycles += 1;
    if c.prog == PROG_WAIT {
        return start_fetch(c);
    }
    let programs = if c.cmos != 0 { &progs.cmos } else { &progs.nmos };
    if c.prog < 0 {
        c.sync = 0;
        if c.intr != 0 {
            c.intr = 0;
            c.prog = PROG_INTERRUPT;
        } else {
            c.op = d & 255;
            inc_pc(c);
            c.prog = c.op;
        }
        c.t = 0;
        let first = &programs[c.prog as usize];
        if !first.is_empty() {
            begin(c, &first[0]);
        } else {
            start_fetch(c);
        }
        return;
    }
    let steps = &programs[c.prog as usize];
    if let Some(e) = &steps[c.t as usize].e {
        e(c, d & 255);
    }
    c.t += 1;
    while (c.t as usize) < steps.len() && steps[c.t as usize].skip.as_ref().is_some_and(|s| s(c)) {
        c.t += 1;
    }
    if (c.t as usize) < steps.len() {
        begin(c, &steps[c.t as usize]);
    } else {
        start_fetch(c);
    }
}

fn set_nmi(c: &mut Cpu, asserted: bool) {
    if asserted && c.nmi_pin == 0 {
        c.nmi_pending = 1;
    }
    c.nmi_pin = asserted as i32;
}

const I_PHI2: usize = 0;
const I_RESB: usize = 1;
const I_IRQB: usize = 2;
const I_NMIB: usize = 3;
const I_RDY: usize = 4;
const I_DI: usize = 5;
const I_BE: usize = 13;
const O_D: usize = 16;
const O_RWB: usize = 24;
const O_SYNC: usize = 25;
const O_VPB: usize = 26;
const O_MLB: usize = 27;

#[inline(always)]
pub fn eval(kind: i32, c: &mut Cell, sh: &mut Shared) {
    if kind != CPU6502 { return; }
    let ins = c.ins;
    let outs = &mut *c.outs;
    let progs = sh.programs.as_ref().expect("the opcode table is sent with a CPU");
    let st = &mut sh.cpus[c.mem_off];
    // p0: 1 for the 65C02; p1: the data bus is tri-state (the CPU lets go of it while it reads).
    let cmos = c.p0 == 1;
    let tristate = c.p1 == 1;
    st.cmos = cmos as i32;
    let phi2 = ins[I_PHI2] as i32;
    st.irq = (ins[I_IRQB] == 0) as i32;
    set_nmi(st, ins[I_NMIB] == 0);
    let falling = st.phi == 1 && phi2 == 0;
    if phi2 <= 1 { st.phi = phi2; }
    if falling {
        if ins[I_RESB] == 0 {
            st.held = 1;
            st.started = 1;
            st.waiting = 0;
            st.stalled = 0;
            st.prog = -1;
            st.read = 1;
            st.sync = 0;
        } else if st.held != 0 {
            st.held = 0;
            st.started = 1;
            reset(st, progs);
            cycle(st, progs, 0);
        } else if st.started != 0 {
            st.stalled = (st.read != 0 && ins[I_RDY] == 0) as i32;
            let data = if st.read != 0 { to_num(ins, I_DI, 8) } else { 0 };
            st.waiting = (st.read != 0 && data < 0) as i32;
            if st.stalled == 0 && st.waiting == 0 { cycle(st, progs, data); }
        }
    }
    if st.started == 0 {
        for o in outs.iter_mut().take(c.no) { *o = X; }
        return;
    }
    if cmos && ins[I_BE] == 0 {
        for i in 0..25 { outs[i] = Z; }
    } else {
        write_num(outs, 0, 16, st.addr);
        for i in 0..8 {
            outs[O_D + i] = if tristate && st.read != 0 { Z } else { ((st.out >> i) & 1) as u8 };
        }
        outs[O_RWB] = (st.read != 0) as u8;
    }
    outs[O_SYNC] = (st.sync != 0) as u8;
    if cmos {
        outs[O_VPB] = if st.vp != 0 { 0 } else { 1 };
        outs[O_MLB] = if st.ml != 0 { 0 } else { 1 };
    }
}

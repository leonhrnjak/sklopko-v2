//! The parts. Each family of parts is a file here with one function, `eval`, that computes the outputs of a part of that family from its
//! inputs and its state. To add a part: give it a number in `kind` (and in `KIND` in src/engine/wasmengine.ts), write its arm in the
//! family it belongs to (or start a new family: a file here, a range of numbers, one line in `eval`), and add it to the tests.

pub mod acia;
mod arith;
mod bus;
mod coding;
mod cpu6502;
mod gates;
mod io;
mod lcd;
mod memory;
mod seq;
mod terminal;
mod tristate;
mod via;
pub mod util;
#[cfg(test)]
pub mod testkit;

use acia::Acia;
pub use cpu6502::{Cpu, Programs, CPU_FIELDS};
pub use lcd::{Lcd, LCD_FIELDS};
pub use via::{Via, VIA_FIELDS};

/// The kinds of part. The numbers are the page's (`KIND` in src/engine/wasmengine.ts). A number never changes once it is given, so a family can have a range and a few more numbers, added later.
pub mod kind {
    pub const AND: i32 = 1;
    pub const OR: i32 = 2;
    pub const XOR: i32 = 3;
    pub const NAND: i32 = 4;
    pub const NOR: i32 = 5;
    pub const XNOR: i32 = 6;
    pub const NOT: i32 = 7;
    pub const BUF: i32 = 8;
    pub const MUX: i32 = 9;
    pub const BUSMUX: i32 = 10;
    pub const BUSADD: i32 = 11;
    pub const BUSREG: i32 = 12;
    pub const BUSCTR: i32 = 13;
    pub const BUSGATE: i32 = 14;
    pub const BUSCMP: i32 = 15;
    pub const DFF: i32 = 16;
    pub const TFF: i32 = 17;
    pub const JKFF: i32 = 18;
    pub const SRLATCH: i32 = 19;
    pub const DLATCH: i32 = 20;
    pub const COUNTER: i32 = 21;
    pub const COUNTERLD: i32 = 22;
    pub const REGISTER: i32 = 23;
    pub const SHIFTREG: i32 = 24;
    pub const ADD4: i32 = 25;
    pub const SUB4: i32 = 26;
    pub const ADDSUB4: i32 = 27;
    pub const CMP4: i32 = 28;
    pub const ALU: i32 = 29;
    pub const MUL: i32 = 30;
    pub const HALFADD: i32 = 31;
    pub const FULLADD: i32 = 32;
    pub const HALFSUB: i32 = 33;
    pub const FULLSUB: i32 = 34;
    pub const BCDADD: i32 = 35;
    pub const DECODER: i32 = 36;
    pub const ENCODER: i32 = 37;
    pub const BCD7: i32 = 38;
    pub const BCDDEC: i32 = 39;
    pub const BIN2BCD: i32 = 40;
    pub const ROM: i32 = 41;
    pub const RAM: i32 = 42;
    pub const CLOCK: i32 = 43;
    pub const KEYPAD: i32 = 44;
    pub const FRAMEBUFFER: i32 = 45;
    pub const CONSOLE: i32 = 46;
    pub const ACIA: i32 = 47;
    pub const TRIBUF: i32 = 48;
    pub const BUSJOIN: i32 = 49;
    pub const VIA6522: i32 = 50;
    pub const LCD: i32 = 51;
    pub const CPU6502: i32 = 52;
    pub const DEMUX: i32 = 53;
    pub const RINGCOUNTER: i32 = 54;
    pub const BUSSUB: i32 = 55;
    pub const BUSADDSUB: i32 = 56;
    pub const GRAY: i32 = 57;
    pub const PARITY: i32 = 58;
    pub const LUT: i32 = 59;
    pub const NETRECV: i32 = 60;
    pub const VIDEO: i32 = 61;
}

/// The 7-segment patterns of 0 to F.
pub const SEG_HEX: [i32; 16] = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];

/// Pixels on a side of the pixel screen part.
pub const FB_SIZE: usize = 16;
/// Bytes in the video chip's picture: 160 columns of 50 bytes (two pixels of 4 bits each), column by column.
pub const VIDEO_BYTES: usize = 8000;
/// The bytes after them: the column-fill registers (x, top, bottom, colour, width, sky, floor, and one spare).
pub const VIDEO_REGS: usize = 8;
/// Characters a text console can have waiting for the page.
pub const CONSOLE_EVENT_LIMIT: usize = 1 << 16;

/// A text console: what it prints is logged as character codes for the page to print (the text itself stays on the page).
pub struct Console {
    pub events: Vec<u16>,
    pub taken: Vec<u16>,
}

/// What a part sees of the engine while it is evaluated: its inputs, where its outputs go, its own state and its parameters.
pub struct Cell<'a> {
    pub ins: &'a [u8],
    pub outs: &'a mut [u8],
    /// How many outputs the part has.
    pub no: usize,
    /// The part's state: a number, the previous clock level, and a bit.
    pub n: &'a mut i32,
    pub pc: &'a mut u8,
    pub q: &'a mut u8,
    pub p0: i32,
    pub p1: i32,
    pub p2: i32,
    /// Where the part's words start in the ROM or the RAM, the pixels in the screens, or which terminal or console it is.
    pub mem_off: usize,
}

/// What several parts share: the memories, the pixel screens, the consoles and the terminals.
pub struct Shared {
    pub rom: Vec<u16>,
    pub ram: Vec<u8>,
    /// The pixels of all pixel screens, 256 bytes each, in part order.
    pub fb: Vec<u8>,
    pub acias: Vec<Acia>,
    pub consoles: Vec<Console>,
    pub vias: Vec<Via>,
    pub lcds: Vec<Lcd>,
    pub cpus: Vec<Cpu>,
    /// The programs of the 6502's instructions, built from the opcode table the page sends (only when there is a CPU).
    pub programs: Option<Programs>,
}

/// Compute the outputs of a part of this kind.
#[inline(always)]
pub fn eval(kind: i32, c: &mut Cell, sh: &mut Shared) {
    match kind {
        1..=9 | 53 => gates::eval(kind, c),
        10..=15 | 55..=56 => bus::eval(kind, c),
        16..=24 | 54 => seq::eval(kind, c),
        25..=35 => arith::eval(kind, c),
        36..=40 | 57..=58 => coding::eval(kind, c),
        41..=42 | 59 => memory::eval(kind, c, sh),
        43..=46 | 60..=61 => io::eval(kind, c, sh),
        47 => terminal::eval(kind, c, sh),
        48..=49 => tristate::eval(kind, c),
        50 => via::eval(kind, c, sh),
        51 => lcd::eval(kind, c, sh),
        52 => cpu6502::eval(kind, c, sh),
        _ => {}
    }
}

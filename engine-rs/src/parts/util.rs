//! Small helpers the parts share: three-valued logic and numbers made of bits.

pub const X: u8 = 2;
pub const Z: u8 = 3;

/// Writes the low `n` bits of `v` (a plain number, as the page's `bitsOf` does).
#[inline(always)]
pub fn put_bits(outs: &mut [u8], n: usize, v: i32) {
    for b in 0..n { outs[b] = ((v >> b) & 1) as u8; }
}

#[inline(always)]
pub fn and2(a: u8, b: u8) -> u8 {
    if a == 0 || b == 0 { 0 } else if a == X || b == X { X } else { 1 }
}
#[inline(always)]
pub fn or2(a: u8, b: u8) -> u8 {
    if a == 1 || b == 1 { 1 } else if a == X || b == X { X } else { 0 }
}
#[inline(always)]
pub fn xor2(a: u8, b: u8) -> u8 {
    if a == X || b == X { X } else { a ^ b }
}
#[inline(always)]
pub fn flip(v: u8) -> u8 {
    if v > 1 { X } else { 1 - v }
}

/// Little-endian bits of `ins[start..start+n)` as a number, or -1 if any bit is not 0 or 1.
#[inline(always)]
pub fn to_num(ins: &[u8], start: usize, n: usize) -> i32 {
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
pub fn write_num(outs: &mut [u8], start: usize, n: usize, value: i32) {
    for i in 0..n {
        outs[start + i] = if value < 0 { X } else { ((value >> i) & 1) as u8 };
    }
}


//! The simulator's fast engine in Rust, compiled to WebAssembly (docs/spec-sim-wasm.md).
//!
//! E1: the crate and its build only. The engine itself arrives in E2; for now the module says which version of the interface between it and
//! the page it speaks, and can hand out memory, which is all the page needs to check that the module loads and runs.

/// Bumped whenever the way the page and the module talk to each other changes (the page refuses a module with another number).
pub const ABI_VERSION: u32 = 1;

#[unsafe(no_mangle)]
pub extern "C" fn abi_version() -> u32 {
    ABI_VERSION
}

/// Memory the page can write into (a circuit's tables, later), kept for the life of the module.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// The sum of `len` bytes at `ptr`: a check that what the page wrote is what the module reads.
#[unsafe(no_mangle)]
pub extern "C" fn checksum(ptr: *const u8, len: usize) -> u32 {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    bytes.iter().fold(0u32, |a, &b| a.wrapping_mul(31).wrapping_add(b as u32))
}

//! The simulator's fast engine in Rust, compiled to WebAssembly (docs/spec-sim-wasm.md).
//!
//! The page (src/engine/wasmengine.ts) loads a compiled circuit into this module as one array of integers (`init`), runs clock edges
//! (`edge`), and reads the nets, the pins and the parts' states straight out of this module's memory. The engine follows the TypeScript
//! fast engine (`settleFast` in src/engine/simulator.ts) step for step, so the two give the same nets after every clock edge.

mod engine;
mod parts;

use engine::Engine;

/// Bumped whenever the way the page and the module talk to each other changes (the page refuses a module with another number).
pub const ABI_VERSION: u32 = 12;

static mut ENGINE: Option<Engine> = None;

#[allow(static_mut_refs)]
fn eng() -> &'static mut Engine {
    unsafe { ENGINE.as_mut().expect("init was not called") }
}

#[unsafe(no_mangle)]
pub extern "C" fn abi_version() -> u32 {
    ABI_VERSION
}

/// Memory the page can write into, kept for the life of the module.
// Not exported by name in the host test binary: a symbol called `free` there would replace the C library's own.
#[cfg_attr(not(test), unsafe(no_mangle))]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// Give back memory from `alloc` (the same `len`).
// Not exported by name in the host test binary: a symbol called `free` there would replace the C library's own.
#[cfg_attr(not(test), unsafe(no_mangle))]
pub extern "C" fn free(ptr: *mut u8, len: usize) {
    drop(unsafe { Vec::<u8>::from_raw_parts(ptr, 0, len) });
}

/// The checksum of `len` bytes at `ptr`: a check that what the page wrote is what the module reads.
#[unsafe(no_mangle)]
pub extern "C" fn checksum(ptr: *const u8, len: usize) -> u32 {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    bytes.iter().fold(0u32, |a, &b| a.wrapping_mul(31).wrapping_add(b as u32))
}

/// Build the engine from the image of a compiled circuit (see `Engine::from_image` and the exporter in wasmengine.ts).
#[unsafe(no_mangle)]
pub extern "C" fn init(ptr: *const i32, len: usize) {
    let img = unsafe { std::slice::from_raw_parts(ptr, len) };
    unsafe { ENGINE = Some(Engine::from_image(img)) }
}

/// Flip the clock part `part` and settle the circuit. Returns 1 if it settled, 0 if it did not within 64 rounds.
#[unsafe(no_mangle)]
pub extern "C" fn edge(part: u32) -> u32 {
    eng().clock_edge(part as usize) as u32
}

/// Set the clock part's output to `phase` (0 or 1) and flag it for the next `settle`.
#[unsafe(no_mangle)]
pub extern "C" fn set_phase(part: u32, phase: u32) {
    eng().set_phase(part as usize, phase as u8)
}

/// Settle the circuit. Returns 1 if it settled, 0 if it did not within 64 rounds.
#[unsafe(no_mangle)]
pub extern "C" fn settle() -> u32 {
    eng().settle() as u32
}

/// Run `n` clock edges of the (only) clock part. Returns how many did not settle.
#[unsafe(no_mangle)]
pub extern "C" fn edges(n: u32) -> u32 {
    let e = eng();
    let c = e.clock_part();
    let mut bad = 0;
    for _ in 0..n {
        if !e.clock_edge(c) {
            bad += 1;
        }
    }
    bad
}

#[unsafe(no_mangle)]
pub extern "C" fn ticks() -> f64 {
    eng().ticks() as f64
}
#[unsafe(no_mangle)]
pub extern "C" fn values_ptr() -> *mut u8 {
    eng().values_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn pins_ptr() -> *mut u8 {
    eng().pins_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn st_n_ptr() -> *mut i32 {
    eng().st_n_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn st_pc_ptr() -> *mut u8 {
    eng().st_pc_ptr()
}
#[unsafe(no_mangle)]
pub extern "C" fn st_q_ptr() -> *mut u8 {
    eng().st_q_ptr()
}
/// The RAM words (one byte each, the parts' memories one after the other, in part order).
#[unsafe(no_mangle)]
pub extern "C" fn ram_ptr() -> *mut u8 {
    eng().ram_ptr()
}

// The terminals (the 6551 part): registers and keyboard in here, the screen on the page, which takes the `tx` events.

/// The registers of terminal `k`: command, control, rx, full, interrupt, pc, out (7 bytes) at the returned address.
#[unsafe(no_mangle)]
pub extern "C" fn acia_regs_ptr(k: u32) -> *mut u8 {
    eng().acia_regs_ptr(k as usize)
}
/// Put a typed character in the keyboard queue of terminal `k`.
#[unsafe(no_mangle)]
pub extern "C" fn acia_key(k: u32, code: u32) {
    eng().acia_key(k as usize, code as u8)
}
/// Throw away what waits on the keyboard of terminal `k` (a break does this, and then queues its own character).
#[unsafe(no_mangle)]
pub extern "C" fn acia_clear_keys(k: u32) {
    eng().acia_clear_keys(k as usize)
}
/// How many characters wait on the keyboard of terminal `k`.
#[unsafe(no_mangle)]
pub extern "C" fn acia_pending(k: u32) -> u32 {
    eng().acia_pending(k as usize) as u32
}
/// What waits on the keyboard of terminal `k`, as bytes at the returned address (`acia_pending` of them).
#[unsafe(no_mangle)]
pub extern "C" fn acia_queue_ptr(k: u32) -> *const u8 {
    eng().acia_queue_ptr(k as usize)
}
/// The screen events of terminal `k` since the last call: 0 to 127 print this character, 256 wipe the screen. Written to the address
/// returned by `acia_events_ptr`; the count is returned, and the list is emptied.
#[unsafe(no_mangle)]
pub extern "C" fn acia_take_events(k: u32) -> u32 {
    eng().acia_take_events(k as usize) as u32
}
#[unsafe(no_mangle)]
pub extern "C" fn acia_events_ptr(k: u32) -> *mut u16 {
    eng().acia_events_ptr(k as usize)
}

/// The pixels of all pixel screens (256 bytes each, one byte per pixel), in part order.
/// The 6502 parts' registers, 37 numbers each.
#[unsafe(no_mangle)]
pub extern "C" fn cpu_ptr() -> *mut i32 {
    eng().cpu_ptr()
}

/// The LCD parts' memories and registers, 216 numbers each.
#[unsafe(no_mangle)]
pub extern "C" fn lcd_ptr() -> *mut i32 {
    eng().lcd_ptr()
}

/// The 6522 parts' registers, 30 numbers each.
#[unsafe(no_mangle)]
pub extern "C" fn via_ptr() -> *mut i32 {
    eng().via_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn fb_ptr() -> *mut u8 {
    eng().fb_ptr()
}
/// The characters console `k` printed since the last call: written to the address `console_events_ptr` returns; the count is returned.
#[unsafe(no_mangle)]
pub extern "C" fn console_take_events(k: u32) -> u32 {
    eng().console_take_events(k as usize) as u32
}
#[unsafe(no_mangle)]
pub extern "C" fn console_events_ptr(k: u32) -> *mut u16 {
    eng().console_events_ptr(k as usize)
}

/// Flag every part for the fast engine (`fast` = 1) or the exact one (0), which is the engine that runs from now on.
#[unsafe(no_mangle)]
pub extern "C" fn mark_all(fast: u32) {
    eng().mark_all(fast != 0)
}

/// One gate delay of the exact engine. Returns 1 while the circuit is still moving.
#[unsafe(no_mangle)]
pub extern "C" fn tick() -> u32 {
    eng().tick() as u32
}

/// Hold net `net` at `v` (0 or 1), or let it go (-1).
#[unsafe(no_mangle)]
pub extern "C" fn set_force(net: u32, v: i32) {
    eng().set_force(net as usize, v as i8)
}

#[unsafe(no_mangle)]
pub extern "C" fn pipe_ptr(part: u32) -> *mut u8 {
    eng().pipe_ptr(part as usize)
}

#[unsafe(no_mangle)]
pub extern "C" fn pipe_len(part: u32) -> u32 {
    eng().pipe_len(part as usize) as u32
}

/// Put `v` on net `net` from outside, flagging the parts that read it.
#[unsafe(no_mangle)]
pub extern "C" fn set_net(net: u32, v: u32) {
    eng().set_net(net as usize, v as u8)
}

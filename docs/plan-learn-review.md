# Plan: review of the Learn path

A read-through of all 14 chapters (78 steps) as a student meets them, checked against the engine, the examples and the BASIC source.
One PR per item, stacked in order (`learn-fix-01-…` to `learn-fix-25-…`); tick the box when the PR merges. The new steps (11, 13, 25)
each add a step: 78 → 81 (done). The step count is generated at build time (`scripts/pathStepCount.ts`), so adding a step needs no number changed anywhere.

## A. Errors and false claims
- [x] 1. ch05 `binary-add`: the carry row of the table shows carries *out of* each column (`0 1 1 0`); it must be the carries *into* them (`1 1 0 0`).
- [x] 2. ch09 `cpu-add`: "third input of each multiplexer" → the adder is input 1, the second.
- [x] 3. ch14 `basic-boot`: the 6502 BASIC is by Weiland and Gates (`scripts/basic/m6502.asm`), not Gates and Allen.
- [x] 4. ch14 `basic-boot`: 1 MHz is a million clock cycles a second, not a million instructions.
- [x] 5. ch12 `6502-map`: ADD/SUB are `CLC`+`ADC` / `SEC`+`SBC`; after SBC the carry means "no borrow", the opposite of the learner's flag, so JNC ≠ BCC after a subtract.
- [x] 6. ch09 `cpu-same`: the ACC becomes 3, then 4, then 7.
- [x] 7. ch14 `journey`: a gate feeding itself oscillated; two gates feeding each other remembered.
- [x] 8. ch14 `basic-boot`: it is a bigger version of the chapter 12 board (different memory map), not that board.
- [x] 9. ch09 `cpu-fetch`, `cpu-same`: one tick is two presses of Clock step (the chapter 12 hint already says so).

## B. Gaps: used before taught
- [x] 10. Boolean notation (`·`, `+`, `¬`, `⊕`) is never defined.
- [x] 11. **New step** in ch11: bytes, multi-digit hex, `$`, KB, 64 KB.
- [x] 12. ch09 `cpu-fetch`: built-in parts start at 0 and some inputs default when unwired (LD off, EN on), unlike chapter 7–8's "unknown".
- [x] 13. **New step** in ch13: arithmetic on the 6502 (`CLC`/`ADC`, `CMP`, branches).
- [x] 14. ch13 `asm-string`: say that `.byte` goes after `done: JMP done`, where the CPU never runs it.
- [x] 15. Point to the SKASM reference (ch11) and the 6502 reference (ch13).
- [x] 16. ch09 `cpu-add`: the Carry flag needs CLK; say the CPU uses the adder/subtractor half of the ALU only.

## C. Inconsistencies
- [x] 17. ch12 `address-decoder`: the RAM and ROM are smaller than their blocks, so they repeat (mirror).
- [x] 18. `chapters.ts`: `memory` unlocks `jkff` (never taught) and `tff` (taught a chapter later).
- [x] 19. ch11: "bus" means two things (thick bundled wires; one shared line with tri-state drivers); say why `shared-bus` is here.
- [x] 20. ch11 `meet-8bit` quiz 2: "how is it different" has "the same three steps" as its answer.
- [x] 21. ch09 `cpu-plan`: fetch, decode and execute all happen within one tick.
- [x] 22. ch09 `cpu-decode`: the signal list leaves out ACC_SRC and SAVE_CARRY.
- [x] 23. ch03 `sop-nand`: "fourteen chips" → "about fourteen".
- [x] 24. ch11 `prog-console`: check whether SKASM accepts `LDI 'H'`; say so or drop the remark.

## D. A missing lesson
- [x] 25. **New step** in ch14: a BASIC program that decides (`IF … THEN`, `GOTO`). Also update "78 steps" in `CLAUDE.md` and `docs/plan-learn-path.md`.

## Checks for every PR
`npm test -- --reporter=dot`, `npx oxlint` on the changed files, `npx tsc -b`, `e2e/learn.spec.ts`, and `npm run build` (the startup
chunk must not grow). CI has no credits, so the results go in the PR.

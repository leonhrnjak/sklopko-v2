# Microsoft BASIC for the BASIC computer

The ROM of the BASIC computer (`src/model/basic-rom.ts`) is **Microsoft BASIC for the 6502, version 1.1**, built from Microsoft's own
source with a short, visible list of edits, plus the terminal code of this project. Nothing is downloaded or run at build time of the
app: the image is committed, and a unit test checks that it is exactly what this directory builds.

## Where it comes from

| File | What it is |
|---|---|
| `m6502.asm` | Microsoft's source, **verbatim**: [microsoft/BASIC-M6502](https://github.com/microsoft/BASIC-M6502) at commit `7460af2c03ae19c0e60ff327489229d2005b9357` (the repository is archived), SHA-256 `8f9e48dcae34eefce0462f1e7c4379dfe2c8aa98c0b772041d9989b40bcbff3b`. "BASIC M6502 8K VER 1.1 BY MICRO-SOFT", 1976–1978. A unit test pins the hash. |
| `LICENSE` | Microsoft's MIT licence for it, as in that repository. Copied to `src/model/LICENSE-BASIC` next to the image. |
| `macro10.ts` | **Ours.** A translator from the MACRO-10 dialect the file is written in (the PDP-10 assembler Microsoft cross-assembled on) to the syntax of the app's 6502 assembler. |
| `target.ts` | **Ours.** The edits that make the KIM-1 build of the file into this computer's: each names the line it replaces, as it is in the file, and why. The build fails if a line is not the one named. And `buildBasic`, which translates, adds `io.s`, and assembles. |
| `io.s` | **Ours.** Written for this project: the reset code, the terminal driver (character in with echo, character out, GET, the Control-C check), the start-up switch, the vectors. |

Nothing from other reconstructions of Microsoft BASIC (mist64/msbasic and the forks of it) is in this repository. They are used on a
developer's machine as an oracle, see below.

## What the translator has to know

The source needs `M6502`, a macro file that was never published. What it did is rebuilt from how the source uses it (the 6502's own
instruction set fixes most of it). Written down in `macro10.ts`:

- an instruction carries its addressing mode in its name: `LDAI` is `LDA #`, `LDADY` is `LDA (zp),Y`, `JMPD` is `JMP (ind)`; a bare number
  is a byte, `ADR(x)` a word, `XWD ^O1000,n` the byte n; `DC"text"` is text with the last character's top bit set, `DT` without;
- names are significant to six characters (`RESTORE` is the routine `RESTOR`), numbers are octal in the maths package (`RADIX 8`) with
  `^O`, `^D` and `"A"`, and a number with an 8 or a 9 in it is decimal even there; `* / & !` bind tighter than `+ -`;
- `IFE`, `IFN`, `IFNDEF`, `IF1`/`IF2` (two passes of the old assembler: the first only printed), `REPEAT`, `DEFINE` with a made-up label
  for each use (`%Q`), `COMMENT` blocks;
- a few conditions depend on where a label is (is the input buffer within one page?), so the translator counts addresses and the
  tests check that it agrees with the assembler about every label.

## Rebuild

```sh
npm run build:basic        # translates, assembles, writes src/model/basic-rom.ts
npm test                   # checks that the committed image is what the source builds
```

## The second opinion (developer machine only)

`src/model/basic-oracle.test.ts` runs the same programs, and 400 seeded random expressions, on the KIM-1 build of Michael Steil's
reconstruction ([mist64/msbasic](https://github.com/mist64/msbasic), which cc65 builds byte for byte into the original KIM-1 binary) and on
ours, and demands the same output, digit for digit. It is skipped unless the build is there:

```sh
git clone https://github.com/mist64/msbasic && cd msbasic
ca65 -D kb9 msbasic.s -o kb9.o && ld65 -C kb9.cfg kb9.o -o kb9.bin -Ln kb9.lbl
VITE_KB9_BIN=$PWD/kb9.bin VITE_KB9_ENTRY=$((16#4065)) npx vitest run src/model/basic-oracle     # (COLD_START in kb9.lbl)
```

That build is the 1977 KIM-1 BASIC and Microsoft's file is the July 1978 source: they are not byte for byte the same (the later source has
a `GO TO` special case, the earlier build the long error messages), so the comparison is of what the programs print, not of the bytes.

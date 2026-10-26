import type { Chapter } from './types'

/** All thirteen chapters of the path, in order. A chapter with no steps yet shows on the map as coming. */
export const CHAPTERS: Chapter[] = [
  { id: 'signals', title: 'Signals and wires', blurb: 'A bit is a 0 or a 1. Switches, LEDs, wires, and counting in binary.' },
  { id: 'nand', title: 'NAND is all you need', blurb: 'One kind of gate, and every other gate built from it. Each one goes into your kit.' },
  { id: 'choosing', title: 'Choosing', blurb: 'Multiplexers, demultiplexers and decoders: send a signal where you want it.' },
  { id: 'adding', title: 'Adding numbers', blurb: 'From a half adder to a 4-bit adder/subtractor.' },
  { id: 'alu', title: 'The ALU', blurb: 'One block that adds, subtracts, ANDs and ORs, and tells you if the answer was zero.' },
  { id: 'memory', title: 'Memory', blurb: 'A gate that feeds itself remembers. Latches, flip-flops and registers.' },
  { id: 'counting', title: 'Counting, ROM and RAM', blurb: 'A counter, a program counter, and memories that hold words.' },
  { id: 'computer', title: 'Build a computer', blurb: 'Fetch, decode, execute: a 4-bit CPU in one circuit that grows step by step.' },
  { id: 'programming', title: 'Programming your computer', blurb: 'Write programs for the computer you built.' },
  { id: 'bigger', title: 'A bigger computer', blurb: 'The 8-bit computer: a shared bus, an index register and subroutines.' },
  { id: 'meet6502', title: 'Meet the 6502', blurb: 'The same machine on one real chip.' },
  { id: 'asm6502', title: 'Programming the 6502', blurb: 'Assembly on a real CPU: LEDs, a console, an LCD and an interrupt.' },
  { id: 'basic', title: 'A computer that runs BASIC', blurb: 'Type PRINT "HELLO" into Microsoft BASIC, running on your 6502.' },
]

export const getChapter = (id: string): Chapter | undefined => CHAPTERS.find((c) => c.id === id)

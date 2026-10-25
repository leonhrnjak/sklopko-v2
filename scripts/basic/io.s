; Sklopko BASIC: what Microsoft BASIC needs from the computer around it, and the vectors.
; Written for this project (not Microsoft's); it is added to the translation of m6502.asm by scripts/basic/target.ts.
;
; The terminal is a 6551-style chip, as on Ben Eater's computer: four registers at $5000.
;   $5000 data     read: the character that arrived     write: a character for the screen
;   $5001 status   bit 3 a character has arrived, bit 4 ready to send, bit 6 the DSR pin (the start-up questions switch)
;   $5002 command  bit 0 receiver on, bit 1 receive interrupt off
;   $5003 control
; None of Microsoft's names are used here except the ones its source expects from the machine it runs on:
; OUTCH (print a character), CZGETL (GET: a character, or 0), INIT (cold start), and those of the edits in target.ts.

ACIA_DATA = $5000
ACIA_STATUS = $5001
ACIA_COMMAND = $5002
ACIA_CONTROL = $5003

TQN = $0200        ; how many typed-ahead keys wait in TQ (0 to 16)
TSAVX = $0201      ; X, while the queue is worked on
TQ = $0210         ; the keys TRMBRK read while a program ran, oldest first, for INCHR and GET

.org $F000

; Cold start (the reset vector): set up the stack and the terminal, then BASIC's own start-up.
TRMRST:   CLD
          LDX #$FF
          TXS
          LDA #0
          STA TQN
          STA ACIA_STATUS      ; programmed reset
          LDA #$0B             ; receiver on, receive interrupt off
          STA ACIA_COMMAND
          LDA #$1F
          STA ACIA_CONTROL
          JMP INIT

; Print the character in A. Keeps X and Y; waits until the terminal is ready (it always is here).
OUTCH:    PHA
OUTWAIT:  LDA ACIA_STATUS
          AND #$10
          BEQ OUTWAIT
          PLA
          STA ACIA_DATA
          RTS

; Read a character into A, waiting for one (BASIC's INCHR), and echo it, as a terminal does. Keeps X and Y.
; Backspace and Delete erase on the screen and are given to BASIC as "_", its delete-a-character.
TERMIN:   LDA TQN
          BEQ INWAIT
          JSR TQGET
          JMP INGOT
INWAIT:   LDA ACIA_STATUS
          AND #$08
          BEQ INWAIT
          LDA ACIA_DATA
INGOT:    AND #$7F
          BEQ INWAIT           ; a NUL is nothing
          CMP #$7F
          BEQ INDEL
          CMP #$08
          BNE INECHO
INDEL:    LDA #$08
          JSR OUTCH
          LDA #$5F
          RTS
INECHO:   PHA
          JSR OUTCH
          PLA
          RTS

; GET: the character that is waiting, or 0 if none is. No echo.
CZGETL:   LDA TQN
          BEQ GETRX
          JMP TQGET
GETRX:    LDA ACIA_STATUS
          AND #$08
          BEQ GETNONE
          LDA ACIA_DATA
          AND #$7F
          RTS
GETNONE:  LDA #0
          RTS

; Break check (BASIC's ISCNTC, called between statements): C = 1 if Control-C was typed. A character that has arrived is always read,
; so that a Control-C cannot wait behind another key; any other key is kept in the queue (16 at most, then it is dropped) for
; INCHR and GET, so typing ahead while a program runs is not lost. A break throws the queue away: what was typed before it is
; not meant for what runs next.
TRMBRK:   LDA ACIA_STATUS
          AND #$08
          BEQ BRKNO
          LDA ACIA_DATA
          AND #$7F
          CMP #$03
          BEQ BRKYES
          JSR TQPUT
BRKNO:    CLC
          RTS
BRKYES:   LDA #0
          STA TQN
          SEC
          RTS

; Put A in the type-ahead queue unless it is full. Keeps A, X and Y.
TQPUT:    STX TSAVX
          LDX TQN
          CPX #16
          BCS TQFULL
          STA TQ,X
          INC TQN
TQFULL:   LDX TSAVX
          RTS

; Take the oldest key out of the type-ahead queue into A (the queue is not empty). Keeps X and Y.
TQGET:    STX TSAVX
          LDA TQ
          PHA
          LDX #0
TQSHIFT:  LDA TQ+1,X
          STA TQ,X
          INX
          CPX #15
          BCC TQSHIFT
          DEC TQN
          PLA
          LDX TSAVX
          RTS

; Does the start-up ask its questions (memory size, terminal width)? Z = 1: no.
ASKQS:    LDA ACIA_STATUS
          AND #$40
          RTS

TRMINT:   RTI

.org $FFFA
.word TRMINT           ; NMI
.word TRMRST           ; reset
.word TRMINT           ; IRQ

/**
 * The programs of the 6502 examples with devices, in 6502 assembly, the way they are written in the ROM's inspector. Each is
 * checked by `board6502.test.ts`: it assembles, and it does what its title says on the board.
 *
 * The devices sit in the block `$4000–$7FFF`, one register each (the low three address bits pick it; the rest are ignored, so
 * the block repeats):
 *
 *     $4000  LEDS    write: the eight LEDs            $4003  KEY     read: key in bits 0–3, bit 4 while a press waits
 *     $4001  CHAR    write: a character code                          write: say it has been read
 *     $4002  SPEAKER write: bit 0 is the speaker      $4004  PAD     read: up 1, down 2, left 4, right 8, A 16, B 32
 *     $4005  PIXEL   write: x in bits 0–3, y in 4–7   $4006  PLOT    write: bit 0 sets or clears that pixel
 */

/** The LEDs count up, with a pause between steps made by a subroutine (so the stack in RAM is used too). */
export const COUNTER_SOURCE = `.org $F000
LEDS = $4000

reset:  LDX #$FF        ; the stack lives at the top of page 1
        TXS
        LDA #0
count:  STA LEDS        ; show the count
        JSR pause
        CLC
        ADC #1          ; one more; after 255 it wraps to 0
        JMP count

pause:  LDX #$30        ; waste time: 48 turns of a two-instruction loop
wait:   DEX
        BNE wait
        RTS

.org $FFFC
.word reset`

/** The console prints a greeting, one character at a time, from a string in the ROM. */
export const HELLO_SOURCE = `.org $F000
CHAR = $4001

reset:  LDX #0
next:   LDA text,X      ; the next character of the string
        BEQ done        ; a 0 ends it
        STA CHAR        ; print it
        INX
        BNE next
done:   JMP done        ; nothing more to do

text:   .byte "Hello from a 6502!", 10, 0

.org $FFFC
.word reset`

/** Every key pressed on the keypad is printed on the console, as a hex digit. */
export const KEYPAD_SOURCE = `.org $F000
LEDS = $4000
CHAR = $4001
KEY  = $4003

reset:  LDX #$FF
        TXS
wait:   LDA KEY         ; bit 4 says a press is waiting
        AND #$10
        BEQ wait
        LDA KEY
        AND #$0F        ; the key's code, 0 to 15
        STA LEDS        ; show it on the LEDs, too
        TAX
        STA KEY         ; writing to KEY says it has been read
        LDA digits,X    ; the code as a character
        STA CHAR
        JMP wait

digits: .byte "0123456789ABCDEF"

.org $FFFC
.word reset`

/** A ball bounces around the 16 × 16 screen; the arrow keys (or the gamepad's buttons) turn it. */
export const BALL_SOURCE = `.org $F000
PAD  = $4004
XY   = $4005
PLOT = $4006
bx   = $00              ; the ball's place, 0 to 15, and its speed in each direction: 1 or $FF (-1)
by   = $01
vx   = $02
vy   = $03

reset:  LDX #$FF
        TXS
        LDA #3
        STA bx
        LDA #5
        STA by
        LDA #1
        STA vx
        STA vy

frame:  JSR place       ; take the old ball off the screen
        LDA #0
        STA PLOT

        LDA PAD         ; steer: a pressed direction becomes the speed
        LSR A
        BCC notup
        LDX #$FF
        STX vy
notup:  LSR A
        BCC notdn
        LDX #1
        STX vy
notdn:  LSR A
        BCC notlt
        LDX #$FF
        STX vx
notlt:  LSR A
        BCC notrt
        LDX #1
        STX vx
notrt:

        LDA bx           ; move across; at a wall, turn round instead
        CLC
        ADC vx
        CMP #16         ; 0 to 15 is on the screen (-1 is 255)
        BCC xok
        LDA #0
        SEC
        SBC vx
        STA vx
        JMP xdone
xok:    STA bx
xdone:  LDA by           ; and the same up and down
        CLC
        ADC vy
        CMP #16
        BCC yok
        LDA #0
        SEC
        SBC vy
        STA vy
        JMP ydone
yok:    STA by
ydone:  JSR place       ; put the ball down in its new place
        LDA #1
        STA PLOT

        LDX #$28        ; wait a little
slow:   DEX
        BNE slow
        JMP frame

place:  LDA by           ; XY = y * 16 + x
        ASL A
        ASL A
        ASL A
        ASL A
        ORA bx
        STA XY
        RTS

.org $FFFC
.word reset`

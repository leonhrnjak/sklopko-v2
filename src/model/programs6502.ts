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

/** A 65C02 program: one LED sweeps along the eight, made with the instructions that set and clear one bit (SMB, RMB), STZ, BRA, PHX and PLX. */
export const SWEEP_65C02_SOURCE = `.org $F000
LEDS = $4000
bits = $00      ; the LED pattern is a byte in the zero page

reset:  LDX #$FF
        TXS
        STZ bits        ; store zero: all the LEDs off
sweep:
        SMB0 bits
        JSR show
        RMB0 bits
        SMB1 bits
        JSR show
        RMB1 bits
        SMB2 bits
        JSR show
        RMB2 bits
        SMB3 bits
        JSR show
        RMB3 bits
        SMB4 bits
        JSR show
        RMB4 bits
        SMB5 bits
        JSR show
        RMB5 bits
        SMB6 bits
        JSR show
        RMB6 bits
        SMB7 bits
        JSR show
        RMB7 bits
        BRA sweep       ; branch always: and round again

show:   LDA bits
        STA LEDS        ; show the pattern
        PHX             ; keep X, and wait
        LDX #$30
wait:   DEX
        BNE wait
        PLX
        RTS

.org $FFFC
.word reset`

/** A 65C02 program that sleeps (WAI) until a timer interrupts it (NMI); the interrupt routine counts, and says so on the LEDs and the console. */
export const TIMER_NMI_SOURCE = `.org $F000
LEDS  = $4000
CHAR  = $4001
ticks = $00

reset:  LDX #$FF
        TXS
        STZ ticks       ; no tick yet
idle:   WAI             ; sleep until an interrupt
        BRA idle        ; (an interrupt returns here: sleep again)

nmi:    INC ticks       ; the timer ticked
        LDA ticks
        STA LEDS        ; show how many
        LDA #'*'
        STA CHAR        ; and print one more star
        RTI             ; back to the instruction after WAI

.org $FFFA
.word nmi               ; NMI vector
.word reset             ; reset vector`



/**
 * The programs of the terminal boards (`memory: 'big'`, the ROM's image begins at $C000), with Ben Eater's register names. The
 * terminal's four registers are at $5000–$5003 (and repeat through $4000–$7FFF):
 *
 *     $5000  ACIA_DATA    read: the key that arrived (clears "receiver full")     write: print the character
 *     $5001  ACIA_STATUS  read: bit 3 receiver full, bit 4 ready to send,         write: programmed reset
 *                         bit 7 interrupt (reading it clears the interrupt)
 *     $5002  ACIA_CMD     bit 0 receiver on, bit 1 set = no receive interrupt
 *     $5003  ACIA_CTRL    baud rate and word length (this terminal takes any)
 */

/** Print HELLO, then send every key typed back to the screen; Enter is sent as CR and LF. The loop polls the status register. */
export const ECHO_SOURCE = `.org $C000
ACIA_DATA   = $5000
ACIA_STATUS = $5001
ACIA_CMD    = $5002
ACIA_CTRL   = $5003

reset:  LDX #$FF
        TXS
        STA ACIA_STATUS ; any write to the status register resets the chip
        LDA #$1F        ; 19200 baud, 8 bits, 1 stop bit (this terminal ignores them)
        STA ACIA_CTRL
        LDA #$0B        ; receiver on (bit 0), no interrupt (bit 1)
        STA ACIA_CMD

        LDX #0
hello:  LDA text,X      ; print the greeting
        BEQ listen      ; a 0 ends it
        JSR send
        INX
        BNE hello

listen: LDA ACIA_STATUS ; wait for a key: bit 3 says one has arrived
        AND #$08
        BEQ listen
        LDA ACIA_DATA   ; take it (that clears bit 3) ...
        JSR send        ; ... and send it back
        CMP #13         ; Enter is a CR: start a new line as well
        BNE listen
        LDA #10
        JSR send
        JMP listen

send:   PHA             ; print A, keeping it: wait until the chip is ready to send (bit 4)
ready:  LDA ACIA_STATUS
        AND #$10
        BEQ ready
        PLA
        STA ACIA_DATA
        RTS

text:   .byte "HELLO", 13, 10, 0

.org $FFFC
.word reset`

/**
 * The same, with the receive interrupt: the main program only counts, in the RAM, and the chip pulls IRQ low for every key; the
 * interrupt routine reads the status (which lets IRQ go) and then the key, and prints it.
 */
export const ECHO_IRQ_SOURCE = `.org $C000
ACIA_DATA   = $5000
ACIA_STATUS = $5001
ACIA_CMD    = $5002
ACIA_CTRL   = $5003
count       = $00       ; a two-byte counter: the main program is busy, and this shows it

reset:  LDX #$FF
        TXS
        STA ACIA_STATUS ; reset the chip
        LDA #$1F
        STA ACIA_CTRL
        LDA #$09        ; receiver on (bit 0), receive interrupt on (bit 1 clear)
        STA ACIA_CMD
        LDA #0
        STA count
        STA count+1

        LDX #0
hello:  LDA text,X
        BEQ go
        STA ACIA_DATA   ; the chip is always ready to send, so there is nothing to wait for
        INX
        BNE hello

go:     CLI             ; from here on a key interrupts
busy:   INC count       ; do something else, over and over
        BNE busy
        INC count+1
        JMP busy

irq:    PHA
        LDA ACIA_STATUS ; reading the status clears the interrupt: IRQ goes high again
        LDA ACIA_DATA   ; the key that arrived
        STA ACIA_DATA   ; send it back
        CMP #13
        BNE done
        LDA #10         ; Enter: a new line as well
        STA ACIA_DATA
done:   PLA
        RTI

text:   .byte "HELLO", 13, 10, 0

.org $FFFA
.word $0000             ; NMI vector (not used)
.word reset
.word irq`


/**
 * The VIA (a 6522, at `$6000`) and its timer, with Ben Eater's register names. The sixteen registers are at `$6000–$600F`:
 *
 *     $6000 PORTB   $6001 PORTA   $6002 DDRB   $6003 DDRA   $6004 T1CL  $6005 T1CH  $6006 T1LL  $6007 T1LH
 *     $6008 T2CL    $6009 T2CH    $600A SR      $600B ACR    $600C PCR   $600D IFR   $600E IER   $600F PORTA, no handshake
 */

/** Timer 1 runs free and interrupts every 1,024 cycles; the interrupt routine counts on the LEDs of port B, and PB7 is the timer's own square wave. */
export const VIA_TIMER_SOURCE = `.org $C000
PORTB = $6000
DDRB  = $6002
T1CL  = $6004
T1CH  = $6005
ACR   = $600B
IFR   = $600D
IER   = $600E
count = $00

reset:  LDX #$FF
        TXS
        LDA #$FF
        STA DDRB        ; every pin of port B is an output
        LDA #0
        STA count
        STA PORTB
        LDA #$C0        ; ACR: bit 6 = timer 1 free-running, bit 7 = its square wave on PB7
        STA ACR
        LDA #$FE        ; the timer counts 1,022 cycles, interrupts, and starts again 2 cycles later: every 1,024
        STA T1CL
        LDA #$03
        STA T1CH        ; writing the high byte loads the counter and starts the timer
        LDA #$C0        ; IER: bit 7 = set the bits that are 1, bit 6 = timer 1
        STA IER
        CLI             ; interrupts on
idle:   JMP idle        ; the CPU has nothing else to do: the work is in the interrupt routine

irq:    PHA
        LDA T1CL        ; reading the low byte of the timer clears its interrupt flag
        INC count
        LDA count
        STA PORTB       ; the count on PB0–PB6 (PB7 belongs to the timer while ACR bit 7 is set)
        PLA
        RTI

.org $FFFA
.word $0000             ; NMI vector (not used)
.word reset
.word irq`


/**
 * Ben Eater's "hello, world" on the LCD, in 8-bit mode. The LCD's data pins are port B ($6000); its RS, R/W and E are PA5, PA6 and PA7 of port A ($6001),
 * so a byte is written by putting it on port B, then RS (or not) on port A, then E up and down. Before every byte the program waits until the LCD says it
 * is not busy: with E and R/W up it reads port B and looks at bit 7.
 */
export const LCD_HELLO_SOURCE = `.org $C000
PORTB = $6000
PORTA = $6001
DDRB  = $6002
DDRA  = $6003

E  = $80            ; PA7: enable
RW = $40            ; PA6: read (1) or write (0)
RS = $20            ; PA5: register select (1 = a character, 0 = an instruction)

reset:  LDX #$FF
        TXS
        LDA #$FF        ; port B: all eight pins are outputs
        STA DDRB
        LDA #$E0        ; port A: the top three pins are outputs
        STA DDRA

        LDA #$38        ; function set: 8 bits, two lines, 5x8 dots
        JSR lcd_instruction
        LDA #$0E        ; display on, cursor on, blink off
        JSR lcd_instruction
        LDA #$06        ; entry mode: the cursor moves right, the display stays
        JSR lcd_instruction
        LDA #$01        ; clear the display
        JSR lcd_instruction

        LDX #0
print:  LDA message,X
        BEQ done
        JSR print_char
        INX
        JMP print
done:   JMP done

message: .byte "Hello, world!", 0

lcd_wait:               ; wait until the LCD is not busy
        PHA
        LDA #$00        ; port B: input, so that the LCD can drive it
        STA DDRB
busy:   LDA #RW
        STA PORTA       ; R/W up: a read
        LDA #RW+E
        STA PORTA       ; E up: the LCD puts the busy flag and the address on port B
        LDA PORTB
        AND #$80        ; bit 7 is the busy flag
        BNE busy
        LDA #RW
        STA PORTA       ; E down
        LDA #$FF        ; port B: outputs again
        STA DDRB
        PLA
        RTS

lcd_instruction:        ; send the byte in A as an instruction
        JSR lcd_wait
        STA PORTB
        LDA #0          ; RS, R/W and E down
        STA PORTA
        LDA #E          ; E up: the LCD reads port B when E comes down again
        STA PORTA
        LDA #0
        STA PORTA
        RTS

print_char:             ; send the byte in A as a character
        JSR lcd_wait
        STA PORTB
        LDA #RS
        STA PORTA
        LDA #RS+E
        STA PORTA
        LDA #RS
        STA PORTA
        RTS

.org $FFFC
.word reset`


/**
 * A test card on the video chip, which is at $4000–$4003 on its board: VADDR_L, VADDR_H, VDATA (reads and writes the picture byte at the
 * address, then counts the address up) and VCTRL. The picture is stored column by column, 50 bytes a column, two pixels a byte (the upper
 * pixel in the high nibble), so a column is one run of writes to VDATA. Each column is bars of one colour for its first 40 bytes (80 rows),
 * the colour changing every ten columns, and a diagonal pattern in the last 10.
 */
export const VIDEO_CARD_SOURCE = `.org $C000
VADDR_L = $4000
VADDR_H = $4001
VDATA   = $4002
VCTRL   = $4003
COL     = $00           ; the column being drawn, 0 to 159
RUN     = $01           ; how many columns the colour has had, 0 to 9
CLR     = $02           ; the bar colour, 0 to 15

reset:  LDX #$FF
        TXS
        LDA #0
        STA VCTRL       ; the port counts up after every byte
        STA VADDR_L     ; start at the first byte of the picture
        STA VADDR_H
        STA COL
        STA RUN
        STA CLR

column: LDX CLR
        LDA pair,X      ; the colour in both nibbles of a byte
        LDY #40
bars:   STA VDATA       ; 40 bytes, 80 rows, of one colour
        DEY
        BNE bars

        LDY #0          ; then 10 bytes of a diagonal pattern: the colour is (column + row) mod 16
low:    TYA
        CLC
        ADC COL
        AND #$0F
        TAX
        LDA pair,X
        STA VDATA
        INY
        CPY #10
        BNE low

        INC RUN         ; ten columns to a colour
        LDA RUN
        CMP #10
        BNE same
        LDA #0
        STA RUN
        INC CLR
same:   INC COL
        LDA COL
        CMP #160
        BNE column

done:   JMP done        ; the picture stays

pair:   .byte $00, $11, $22, $33, $44, $55, $66, $77, $88, $99, $AA, $BB, $CC, $DD, $EE, $FF

.org $FFFC
.word reset`

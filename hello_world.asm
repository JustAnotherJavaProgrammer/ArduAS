LDI r2, rgb(255, 0, 0)
LDI r3, rgb(255, 255, 0)
loop:
    ; CALLI clr_scrn
    JMPI clr_scrn
    ; CALLI drw_txt
    ; CALLI set_colors
    JMPI loop


clr_scrn: ; clears the screen
    SCLR r2
    ; RET

set_colors:
    ADDI r2, 1
    SUBI r3, 1
    ; RET

drw_txt: ; draws text
    TCOL r3 // set text color
    TSIZI 4
    TWRAPI 1
    LDI r1 10
    TCPOS r1 r1
    TOUTI 'H'
    TOUTI 'e'
    TOUTI 'l'
    TOUTI 'l'
    TOUTI 'o'
    TOUTI ' '
    TOUTI 'w'
    TOUTI 'o'
    TOUTI 'r'
    TOUTI 'l'
    TOUTI 'd'
    TOUTI '!'
    ; RET
    JMPI loop
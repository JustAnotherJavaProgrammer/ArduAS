clr_scrn: ; clears the screen
    SCLRI rgb(0, 255, 0)

drw_txt: ; draws text
    TCOLI rgb(0, 0, 255) // set text color
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
    JMPI clr_scrn
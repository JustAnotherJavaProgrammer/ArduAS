; This is an example shows how to read touch data and use it to draw

init:
    LDI r3, rgb(0, 0, 0)
    SCLRI rgb(255, 255, 255)

main:
    CALLI update_colors
    TFT
    BLD r2 0
    CMPI r2 1
    SNE
        CALLI set_pxls
    JMPI main

update_colors:
    ADDI r3, 1
    RET

set_pxls:
    PXL r0 r0 r3
    RET
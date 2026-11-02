# view_frame.py - ask the camera ESP32 for one picture over USB and save it as a PNG
# Usage:  python view_frame.py COM5          take one picture -> frame.png (opens it)
#         python view_frame.py COM5 bars     switch the test bars on/off, then take one picture
#         python view_frame.py COM5 5        take 5 pictures in a row -> frame_1.png ... frame_5.png
# Needs:  pip install pyserial pillow
# Close the Arduino Serial Monitor first: only one program can use the COM port at a time.

import sys  # command-line arguments
import time  # timing and pauses
import struct  # unpack the little-endian numbers in the header
import serial  # pyserial: talks to the COM port
import os  # open the saved picture in the normal image viewer
from PIL import ImageOps  # auto-contrast for the stretched copy
from PIL import Image  # Pillow: turns the pixel bytes into a PNG

BAUD = 921600  # must match LINK_BAUD in camera_esp.ino
MAGICS = (b"FRM1", b"ERR!")  # the two possible replies to 'C'


def open_port(name):  # open the port without resetting the ESP32 if possible
    ser = serial.Serial()  # create it closed so the control lines can be set first
    ser.port = name  # e.g. COM5 or /dev/ttyUSB0
    ser.baudrate = BAUD  # link speed
    ser.timeout = 0.2  # each read waits at most 0.2 s
    ser.dtr = False  # don't hold the board in reset or boot mode
    ser.rts = False  # same for the other control line
    ser.open()  # now open it
    return ser  # ready to use


def show_text(data):  # print anything that isn't picture data (log lines from the ESP32)
    text = data.decode("ascii", errors="replace").strip()  # bytes -> readable text
    if text:  # skip empty reads
        for line in text.splitlines():  # one ESP32 line per printed line
            print("  ESP32 |", line)  # mark it so it stands out from our own messages


def drain(ser, seconds):  # print whatever the ESP32 says for a while
    end = time.time() + seconds  # stop time
    while time.time() < end:  # until then
        show_text(ser.read(4096))  # read and print


def wait_for_reply(ser, timeout):  # read until "FRM1" or "ERR!" appears, printing any text before it
    buf = b""  # bytes seen so far
    end = time.time() + timeout  # give up after this
    while time.time() < end:  # keep reading
        buf += ser.read(ser.in_waiting or 1)  # take what has arrived (at least one byte)
        for magic in MAGICS:  # look for either marker
            i = buf.find(magic)  # where it starts, or -1
            if i >= 0:  # found it
                show_text(buf[:i])  # print the text that came before it
                return magic, buf[i + 4:]  # which reply, plus bytes already read after the marker
    show_text(buf)  # nothing found: print what we did get
    return None, b""  # no reply


def read_exact(ser, n, have, timeout=5):  # collect exactly n bytes (some may already be in `have`)
    data = have  # start with what we already have
    end = time.time() + timeout  # give up after this
    while len(data) < n and time.time() < end:  # until complete or out of time
        data += ser.read(n - len(data))  # read the rest
    return data[:n], data[n:]  # the n bytes, and anything extra


def capture(ser, filename):  # request one picture and save it
    start = time.time()  # to measure how long it takes
    ser.write(b"C")  # ask for a picture
    magic, rest = wait_for_reply(ser, 6)  # the driver waits up to 4 s for a frame, so allow 6
    if magic is None:  # silence
        print("No reply. Is camera_esp.ino flashed with LINK_TO_USB 1, and is the Serial Monitor closed?")  # usual causes
        return None  # failed
    if magic == b"ERR!":  # the ESP32 said it couldn't
        drain(ser, 0.5)  # print its explanation
        print("The ESP32 couldn't take a picture (reason above).")  # our summary
        return None  # failed

    header, rest = read_exact(ser, 8, rest)  # width u16, height u16, length u32
    if len(header) < 8:  # header cut short
        print("Header cut short.")  # report
        return None  # failed
    width, height, length = struct.unpack("<HHI", header)  # decode the three numbers
    pixels, rest = read_exact(ser, length, rest)  # the picture itself
    tail, rest = read_exact(ser, 2, rest)  # the checksum
    seconds = time.time() - start  # total time for this picture

    if len(pixels) < length or len(tail) < 2:  # transfer stopped early
        print(f"Picture cut short: got {len(pixels)} of {length} bytes.")  # report
        return None  # failed
    (checksum,) = struct.unpack("<H", tail)  # decode the checksum
    if sum(pixels) & 0xFFFF != checksum:  # bytes changed on the way
        print("WARNING: checksum mismatch, some bytes were corrupted on the way. Saving it anyway.")  # still useful to look at
    if width * height != length:  # header numbers don't agree
        print(f"WARNING: {width}x{height} should be {width * height} bytes but {length} came.")  # report it

    img = Image.frombytes("L", (width, height), pixels[: width * height])  # "L" = 8-bit greyscale
    img.save(filename)  # write the PNG
    print(f"Saved {filename}: {width}x{height}, {seconds:.2f} s, "
          f"brightness min {min(pixels)} / max {max(pixels)} / average {sum(pixels) // length}")  # quick health check
    stretched = filename.replace(".png", "_stretched.png")  # second file name
    ImageOps.autocontrast(img).save(stretched)  # same picture with brightness stretched, so faint detail shows
    print(f"Saved {stretched}: brightness stretched to full range")  # tell the user
    print("Data lines seen (share of pixels with that bit = 1):")  # which camera data wires ever went high
    for bit in range(7, -1, -1):  # D7 down to D0
        count = sum(1 for p in pixels if (p >> bit) & 1)  # pixels with this bit set
        note = "  <- never high: check this wire, or the scene is too dark" if count == 0 else ""  # flag dead lines
        print(f"  D{bit}: {100 * count / length:5.1f} %{note}")  # one line per data wire
    show_text(rest)  # any log text that came after the picture
    drain(ser, 0.2)  # and the ESP32's "Sent ..." line
    return filename  # success


def main():
    if len(sys.argv) < 2:  # no port given
        print("Usage: python view_frame.py COM5 [bars | number of pictures]")  # how to call it
        sys.exit(1)  # stop
    port = sys.argv[1]  # which COM port
    extra = sys.argv[2] if len(sys.argv) > 2 else ""  # optional second word

    ser = open_port(port)  # connect
    print(f"Opened {port} at {BAUD}. Waiting for the ESP32...")  # progress
    drain(ser, 2.5)  # start-up messages, if the board reset when the port opened
    ser.write(b"I")  # ask for its info
    drain(ser, 0.5)  # print it
    if extra == "bars":  # test pattern wanted
        ser.write(b"B")  # toggle the bars
        drain(ser, 0.5)  # confirmation
    count = int(extra) if extra.isdigit() else 1  # how many pictures

    saved = None  # last file written
    for n in range(1, count + 1):  # take them one by one
        stamp = time.strftime("%H%M%S")  # time of day, so each run gets a new file
        name = f"frame_{stamp}.png" if count == 1 else f"frame_{stamp}_{n}.png"  # file name (never overwrites one that is open)
        saved = capture(ser, name) or saved  # remember the last good one
    ser.close()  # free the port
    if saved and count == 1:  # a single picture worked
        if hasattr(os, "startfile"):  # Windows
            os.startfile(os.path.abspath(saved))  # open the real file, so the viewer doesn't lose it
        else:  # other systems
            Image.open(saved).resize((640, 480), Image.NEAREST).show()  # open it twice the size so it's easy to see


if __name__ == "__main__":
    main()  # run

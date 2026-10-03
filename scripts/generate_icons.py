"""Generate dependency-free PNG app icons."""
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
PURPLE = (103, 80, 216, 255)
WHITE = (255, 255, 255, 255)
YELLOW = (255, 211, 126, 255)


def inside_rounded_square(x, y, size, radius):
    if radius <= x < size - radius or radius <= y < size - radius:
        return True
    cx = radius if x < radius else size - radius - 1
    cy = radius if y < radius else size - radius - 1
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def make_icon(size):
    radius = size * 23 // 100
    pixels = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]
    for y in range(size):
        for x in range(size):
            if inside_rounded_square(x, y, size, radius):
                pixels[y][x] = PURPLE

    stroke = max(8, size * 7 // 100)
    center = size // 2
    reach = size * 19 // 100
    for y in range(size):
        for x in range(size):
            if pixels[y][x][3] == 0:
                continue
            if abs((x - center) - (y - center)) <= stroke and abs(x - center) <= reach:
                pixels[y][x] = WHITE
            if abs((x - center) + (y - center)) <= stroke and abs(x - center) <= reach:
                pixels[y][x] = WHITE

    smile_y = size * 75 // 100
    smile_half = size * 25 // 100
    smile_stroke = max(5, size * 4 // 100)
    for x in range(center - smile_half, center + smile_half + 1):
        curve = smile_y + int(((x - center) / smile_half) ** 2 * size * 7 / 100)
        for y in range(curve - smile_stroke, curve + smile_stroke + 1):
            if 0 <= y < size:
                pixels[y][x] = YELLOW

    raw = b''.join(b'\x00' + b''.join(bytes(pixel) for pixel in row) for row in pixels)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


for icon_size in (192, 512):
    (ROOT / 'assets' / f'icon-{icon_size}.png').write_bytes(make_icon(icon_size))

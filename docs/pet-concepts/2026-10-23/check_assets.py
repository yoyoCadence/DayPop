"""Offline acceptance checks for DP-183 concept deliverables (stdlib only)."""
import hashlib
import json
from pathlib import Path
import struct
import sys
import zlib

ROOT = Path(__file__).resolve().parent
KINDS = {"moon_cat", "orbit_ufo", "cloud_teapot", "sprout_rover"}


def rgba_png(path):
    raw = path.read_bytes()
    assert raw[:8] == b"\x89PNG\r\n\x1a\n", f"not PNG: {path}"
    offset, packed = 8, bytearray()
    while offset < len(raw):
        size = struct.unpack(">I", raw[offset:offset + 4])[0]
        tag, data = raw[offset + 4:offset + 8], raw[offset + 8:offset + 8 + size]
        if tag == b"IHDR":
            width, height, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", data)
            assert (depth, color, interlace) == (8, 6, 0), "expected 8-bit non-interlaced RGBA"
        elif tag == b"IDAT":
            packed.extend(data)
        offset += size + 12
    stream, rows, previous = zlib.decompress(packed), [], bytearray(width * 4)
    offset = 0
    for _ in range(height):
        mode = stream[offset]
        row = bytearray(stream[offset + 1:offset + 1 + width * 4])
        for x in range(len(row)):
            a, b, c = (row[x - 4] if x >= 4 else 0), previous[x], (previous[x - 4] if x >= 4 else 0)
            if mode == 1:
                prediction = a
            elif mode == 2:
                prediction = b
            elif mode == 3:
                prediction = (a + b) // 2
            elif mode == 4:
                p = a + b - c
                distances = (abs(p - a), abs(p - b), abs(p - c))
                prediction = (a, b, c)[distances.index(min(distances))]
            else:
                assert mode == 0, "unknown PNG filter"
                prediction = 0
            row[x] = (row[x] + prediction) % 256
        rows.append(row)
        previous, offset = row, offset + 1 + width * 4
    return width, height, rows


def validate_sprite(path, size):
    width, height, rows = rgba_png(path)
    assert (width, height) == (size, size), f"wrong dimensions: {path}"
    margin = round(size * 8 / 120)
    visible, colors = [], set()
    for y, row in enumerate(rows):
        for x in range(width):
            r, g, b, alpha = row[x * 4:x * 4 + 4]
            if alpha:
                assert margin <= x < width - margin and margin <= y < height - margin, f"unsafe alpha at {x},{y}: {path}"
            if alpha > 32:
                visible.append((x, y))
                colors.add((r // 16, g // 16, b // 16))
    assert len(visible) > size * size * 0.12, f"empty/tiny character: {path}"
    assert len(colors) > 20, f"lost material detail: {path}"
    return {"bytes": path.stat().st_size, "visiblePixels": len(visible), "bounds": [min(x for x, _ in visible), min(y for _, y in visible), max(x for x, _ in visible), max(y for _, y in visible)]}


def check():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf8"))
    assert {item["id"] for item in manifest["concepts"]} == KINDS
    assert manifest["productionReady"] is False
    for item in manifest["concepts"]:
        source = ROOT / item["source"]
        header = source.read_bytes()[:8]
        assert header.startswith(b"BLENDER") or header.startswith(b"\x28\xb5\x2f\xfd"), f"missing Blender source: {source}"
        for size in (120, 60):
            path = ROOT / item["renders"][str(size)]
            result = validate_sprite(path, size)
            assert result == item["measurements"][str(size)], f"stale measurement: {path}"
        for relative, expected in item["sha256"].items():
            assert hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() == expected, f"checksum mismatch: {relative}"
        print(item["id"], json.dumps(item["measurements"]))
    print("PASS: four editable concepts, eight safe RGBA sprites, sizes and SHA-256")


if __name__ == "__main__":
    try:
        check()
    except (AssertionError, FileNotFoundError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)

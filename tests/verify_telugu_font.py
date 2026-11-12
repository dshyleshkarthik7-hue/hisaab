"""Check that bundled Hind Guntur font files map core Telugu code points."""
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1] / "web" / "fonts"
REQUIRED = (0x0C15, 0x0C3E, 0x0C4D)  # Telugu KA, AA vowel sign, virama

def has_glyph(data: bytes, codepoint: int) -> bool:
    if len(data) < 12:
        return False
    table_count = struct.unpack_from(">H", data, 4)[0]
    cmap_offset = None
    for i in range(table_count):
        pos = 12 + i * 16
        tag = data[pos:pos + 4]
        offset, length = struct.unpack_from(">II", data, pos + 8)
        if tag == b"cmap":
            cmap_offset = offset
            break
    if cmap_offset is None:
        return False
    count = struct.unpack_from(">H", data, cmap_offset + 2)[0]
    subtables = []
    for i in range(count):
        pos = cmap_offset + 4 + i * 8
        platform, encoding, offset = struct.unpack_from(">HHI", data, pos)
        sub = cmap_offset + offset
        fmt = struct.unpack_from(">H", data, sub)[0]
        if platform in (0, 3) and fmt in (4, 12):
            subtables.append((fmt, sub))
    for fmt, sub in sorted(subtables, reverse=True):
        if fmt == 12:
            groups = struct.unpack_from(">I", data, sub + 12)[0]
            lo, hi = 0, groups
            while lo < hi:
                mid = (lo + hi) // 2
                start, end, glyph = struct.unpack_from(">III", data, sub + 16 + mid * 12)
                if codepoint < start: hi = mid
                elif codepoint > end: lo = mid + 1
                else: return glyph + codepoint - start != 0
        else:
            seg_count = struct.unpack_from(">H", data, sub + 6)[0] // 2
            end_pos = sub + 14
            start_pos = end_pos + seg_count * 2 + 2
            delta_pos = start_pos + seg_count * 2
            range_pos = delta_pos + seg_count * 2
            for i in range(seg_count):
                end = struct.unpack_from(">H", data, end_pos + 2 * i)[0]
                start = struct.unpack_from(">H", data, start_pos + 2 * i)[0]
                if start <= codepoint <= end:
                    delta = struct.unpack_from(">h", data, delta_pos + 2 * i)[0]
                    ro = struct.unpack_from(">H", data, range_pos + 2 * i)[0]
                    if ro == 0:
                        glyph = (codepoint + delta) & 0xFFFF
                    else:
                        glyph_pos = range_pos + 2 * i + ro + 2 * (codepoint - start)
                        glyph = struct.unpack_from(">H", data, glyph_pos)[0]
                        if glyph: glyph = (glyph + delta) & 0xFFFF
                    return glyph != 0
    return False

for filename in ("HindGuntur-Regular.ttf", "HindGuntur-Bold.ttf"):
    data = (ROOT / filename).read_bytes()
    missing = [f"U+{cp:04X}" for cp in REQUIRED if not has_glyph(data, cp)]
    if missing:
        raise SystemExit(f"{filename} missing Telugu glyphs: {', '.join(missing)}")
    print(f"{filename}: Telugu glyph coverage OK ({len(data):,} bytes)")

"""Wire formats for buffers (plan §6.4, §8.4.2). Mirrored in Rust gen/draw.

Points  `asemic/gen/<stream>`:  header `<4sIIHH` = b"ASP1", frame, n, dims, flags; then n*dims f32 LE.
        Multiarray lines x points x attrs (schema multi.rs): attrs 0, 1 = x, y (0..1, y down);
        flags & 1 = attr names follow (u16 len + comma-joined, padded to 4). NaN point splits lines.
Frame   `asemic/preview/<out>`:  header `<4sIHH` = b"ASF1", frame, w, h; then w*h RGBA8.

P_HEAD/F_HEAD/magics live in `asemic_py/_wire.py`, generated from asemic-schema
(`crates/schema/src/{multi,wire}.rs`) — the single source of truth; see that file's header.
"""

from __future__ import annotations

import math
import struct
from array import array
from dataclasses import dataclass

from asemic_py._wire import F_HEAD, P_HEAD

NAMES = 1


@dataclass
class Points:
    frame: int
    dims: int
    data: array  # flat f32
    attrs: tuple[str, ...] = ("x", "y")

    def lines(self) -> list[list[tuple[float, ...]]]:
        """Lines x points x attrs."""
        lines, cur = [], []
        d = self.dims
        for i in range(0, len(self.data) - d + 1, d):
            p = tuple(self.data[i:i + d])
            if all(math.isnan(v) for v in p):  # all-NaN point = line separator
                if cur:
                    lines.append(cur)
                cur = []
            else:
                cur.append(p)
        if cur:
            lines.append(cur)
        return lines

    def polylines(self) -> list[list[tuple[float, float]]]:
        x, y = self.attrs.index("x"), self.attrs.index("y")
        return [[(p[x], p[y]) for p in line] for line in self.lines()]

    def column(self, name: str) -> list[list[float]]:
        a = self.attrs.index(name)
        return [[p[a] for p in line] for line in self.lines()]


def encode_points(lines: list[list[tuple[float, ...]]], frame: int = 0, attrs: tuple[str, ...] = ("x", "y")) -> bytes:
    d = len(attrs)
    flat = array("f")
    for i, line in enumerate(lines):
        if i:
            flat.extend([math.nan] * d)
        for p in line:
            flat.extend(p)
    named = tuple(attrs) != ("x", "y")
    head = P_HEAD.pack(b"ASP1", frame, len(flat) // d, d, NAMES if named else 0)
    if named:
        names = ",".join(attrs).encode()
        head += struct.pack("<H", len(names)) + names
        head += b"\0" * (-len(head) % 4)
    return head + flat.tobytes()


def decode_points(b: bytes) -> Points:
    if not b:  # dropped gen: empty payload = no points
        return Points(0, 2, array("f"))
    magic, frame, n, dims, flags = P_HEAD.unpack_from(b)
    if magic != b"ASP1":
        raise ValueError(f"bad magic {magic!r}")
    at = P_HEAD.size
    attrs = ("x", "y", *(f"a{i}" for i in range(2, dims)))
    if flags & NAMES:
        (ln,) = struct.unpack_from("<H", b, at)
        attrs = tuple(b[at + 2:at + 2 + ln].decode().split(","))
        at = (at + 2 + ln + 3) // 4 * 4
    data = array("f")
    data.frombytes(b[at:at + n * dims * 4])
    return Points(frame, dims, data, attrs)


@dataclass
class Frame:
    frame: int
    w: int
    h: int
    rgba: bytes

    def pixel(self, x: int, y: int) -> tuple[int, int, int]:
        i = (y * self.w + x) * 4
        return self.rgba[i], self.rgba[i + 1], self.rgba[i + 2]


def encode_frame(w: int, h: int, rgba: bytes, frame: int = 0) -> bytes:
    assert len(rgba) == w * h * 4
    return F_HEAD.pack(b"ASF1", frame, w, h) + rgba


def decode_frame(b: bytes) -> Frame:
    magic, frame, w, h = F_HEAD.unpack_from(b)
    if magic != b"ASF1":
        raise ValueError(f"bad magic {magic!r}")
    return Frame(frame, w, h, b[F_HEAD.size:F_HEAD.size + w * h * 4])

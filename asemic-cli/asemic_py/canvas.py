"""Terminal renderers for buffers (plan §8.4.2): braille vector lines, half-block raster, ascii chars;
plus `lines_image` so a points stream can use the raster renderers (image / ascii previews)."""

from __future__ import annotations

from ascii_magic import AsciiArt
from PIL import Image, ImageDraw
from rich.style import Style
from rich.text import Text

from .points import Frame, Points

# braille dot bit per (dx, dy) in a 2x4 cell
_DOTS = ((0x01, 0x08), (0x02, 0x10), (0x04, 0x20), (0x40, 0x80))


def braille(points: Points | None, w: int, h: int) -> list[str]:
    """Rasterise polylines (coords 0..1, y down) into w x h braille cells."""
    cells = [[0] * w for _ in range(h)]
    if points is not None and w > 0 and h > 0:
        pw, ph = w * 2, h * 4

        def dot(px: int, py: int) -> None:
            if 0 <= px < pw and 0 <= py < ph:
                cells[py // 4][px // 2] |= _DOTS[py % 4][px % 2]

        for line in points.polylines():
            pts = [(int(x * (pw - 1) + 0.5), int(y * (ph - 1) + 0.5)) for x, y in line]
            if len(pts) == 1:
                dot(*pts[0])
            for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                # Bresenham
                dx, dy = abs(x1 - x0), -abs(y1 - y0)
                sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
                err = dx + dy
                for _ in range(4 * (pw + ph)):
                    dot(x0, y0)
                    if x0 == x1 and y0 == y1:
                        break
                    e2 = 2 * err
                    if e2 >= dy:
                        err += dy
                        x0 += sx
                    if e2 <= dx:
                        err += dx
                        y0 += sy
    return ["".join(chr(0x2800 + b) for b in row) for row in cells]


def halfblocks(frame: Frame | None, w: int, h: int) -> Text:
    """Nearest-neighbour scale frame into w x h cells, 2 pixels per cell (▀ fg=top, bg=bottom)."""
    t = Text()
    if frame is None or frame.w == 0 or frame.h == 0:
        return t
    for row in range(h):
        for col in range(w):
            x = min(frame.w - 1, col * frame.w // w)
            yt = min(frame.h - 1, (row * 2) * frame.h // (h * 2))
            yb = min(frame.h - 1, (row * 2 + 1) * frame.h // (h * 2))
            top, bot = frame.pixel(x, yt), frame.pixel(x, yb)
            t.append("▀", Style(color=f"rgb{top}", bgcolor=f"rgb{bot}"))
        if row < h - 1:
            t.append("\n")
    return t


def lines_image(points: Points | None, w: int, h: int) -> Image.Image:
    """Polylines (coords 0..1, y down) -> white-on-black RGB image of w x h px."""
    img = Image.new("RGB", (max(1, w), max(1, h)))
    if points is not None:
        d = ImageDraw.Draw(img)
        for line in points.polylines():
            xy = [(x * (w - 1), y * (h - 1)) for x, y in line]
            if len(xy) == 1:
                d.point(xy, fill="white")
            else:
                d.line(xy, fill="white", width=max(1, w // 400))
    return img


def ascii_image(img: Image.Image, w: int, h: int) -> str:
    """Image -> w columns of ascii chars (ascii_magic); terminal cells ~2:1, fits both w and h."""
    if w <= 0 or h <= 0:
        return ""
    cols = max(1, min(w, int(h * 2.2 * img.width / max(img.height, 1))))
    rows = AsciiArt.from_pillow_image(img.convert("RGB")).to_ascii(columns=cols, monochrome=True).splitlines()
    return "\n".join(rows[:h])


def ascii(frame: Frame | None, w: int, h: int) -> str:
    """Preview frame -> w columns of ascii chars (`ascii_image` over the raw RGBA)."""
    if frame is None:
        return ""
    return ascii_image(Image.frombytes("RGBA", (frame.w, frame.h), frame.rgba), w, h)

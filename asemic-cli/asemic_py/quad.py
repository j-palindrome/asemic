"""Quarter-block (2x2 px/cell) image renderable + widget via libchafa (`chafa.py`), mirroring
`textual_image.renderable.halfcell`: the text fallback when the terminal has no TGP/sixel."""

from __future__ import annotations

from chafa.canvas import Canvas
from chafa.canvas_config import CanvasConfig
from chafa.enums import CanvasMode, PixelType, SymbolTags
from chafa.symbol_map import SymbolMap
from rich.console import Console, ConsoleOptions, RenderResult
from rich.measure import Measurement
from rich.text import Text
from textual_image._geometry import ImageSize
from textual_image._pixeldata import PixelData
from textual_image._terminal import get_cell_size
from textual_image.widget._base import Image as BaseImage


class QuadRenderable:
    def __init__(self, image, width=None, height=None) -> None:
        self._data = PixelData(image, mode="rgb")
        self._size = ImageSize(self._data.width, self._data.height, width, height)

    def cleanup(self) -> None:
        pass

    def __rich_console__(self, console: Console, options: ConsoleOptions) -> RenderResult:
        w, h = self._size.get_cell_size(options.max_width, options.max_height, get_cell_size())
        cfg = CanvasConfig()
        cfg.width, cfg.height = w, h
        cfg.canvas_mode = CanvasMode.CHAFA_CANVAS_MODE_TRUECOLOR
        sm = SymbolMap()
        sm.add_by_tags(SymbolTags.CHAFA_SYMBOL_TAG_QUAD)
        cfg.set_symbol_map(sm)
        img = self._data.pil_image.resize((max(1, w * 2), max(1, h * 2)))
        canvas = Canvas(cfg)
        canvas.draw_all_pixels(PixelType.CHAFA_PIXEL_RGB8, img.tobytes(), img.width, img.height, img.width * 3)
        yield Text.from_ansi(canvas.print().decode(), no_wrap=True, end="")

    def __rich_measure__(self, console: Console, options: ConsoleOptions) -> Measurement:
        w, _ = self._size.get_cell_size(options.max_width, options.max_height, get_cell_size())
        return Measurement(w, w)


class QuadImage(BaseImage, Renderable=QuadRenderable):
    pass

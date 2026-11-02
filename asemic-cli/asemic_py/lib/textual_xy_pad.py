"""
Scripts/lib/textual_xy_pad.py - Shared Textual 2D XY-Pad Canvas Component.

Provides a reusable Textual 2D matrix canvas widget with node hit-testing (including label hitboxes),
coordinate conversion without warping, toroidal physics support, and SELECTION_COLOR styling.
"""

from coloraide import Color
import math
import time
from typing import Any, Callable, Dict, Optional, Tuple, Union
from rich.text import Text
from rich.style import Style
from rich.color import Color as RichColor
from textual import events
from textual.widget import Widget

from .textual_nav_keys import NavKeysMixin

SELECTION_COLOR = "bold reverse yellow"
FOCUS_COLOR = "bold underline yellow"
BORDER_FOCUS = "heavy yellow"
BORDER_DEFAULT = "heavy red"
COLOR_PALETTES = {
    "inferno": {
        "name": "Inferno (Hellfire)",
        "tl_br": "#8b0000",
        "bl_tr": "#ff8c00",
        "center": "#ffd700",
    }
}


def wrap_coord(val: float) -> float:
    """Wrap coordinate into [-1.0, 1.0] bounds."""
    return ((val + 1.0) % 2.0) - 1.0


def toroidal_delta(x1: float, y1: float, x2: float, y2: float) -> Tuple[float, float]:
    """Calculate shortest toroidal displacement vector across [-1.0, 1.0] bounds."""
    dx = x1 - x2
    dy = y1 - y2
    dx -= 2.0 * round(dx / 2.0)
    dy -= 2.0 * round(dy / 2.0)
    return dx, dy


def toroidal_dist_sq(x1: float, y1: float, x2: float, y2: float) -> float:
    """Calculate squared toroidal distance across [-1.0, 1.0] wrapping bounds."""
    dx, dy = toroidal_delta(x1, y1, x2, y2)
    return dx * dx + dy * dy


def palette_coord_to_coloraide(
    nx: float,
    ny: float,
    palette_name: str = "inferno",
    val: float = 1.0,
    power: float = 2.0
) -> Color:
    """
    Map [-1.0, 1.0] toroidal space to the selected color palette via Oklab Inverse Distance Weighting.
    Top-Left (-0.5, -0.5) and Bottom-Right (0.5, 0.5) link to palette['tl_br'].
    Bottom-Left (-0.5, 0.5) and Top-Right (0.5, -0.5) link to palette['bl_tr'].
    Center (0.0, 0.0) links to palette['center'].
    Toroidal periodicity ensures seamless continuous color wraps across edges.
    """
    pal = COLOR_PALETTES.get(palette_name, COLOR_PALETTES.get("inferno", {}))
    tl_br_hex = pal.get("tl_br", "#8b0000")
    bl_tr_hex = pal.get("bl_tr", "#ff8c00")
    center_hex = pal.get("center", "#ffd700")

    nodes = [
        ((-0.5, -0.5), Color(tl_br_hex)),
        ((0.5, 0.5),   Color(tl_br_hex)),
        ((-0.5, 0.5),  Color(bl_tr_hex)),
        ((0.5, -0.5),  Color(bl_tr_hex)),
        ((0.0, 0.0),   Color(center_hex)),
    ]

    weights = []
    colors = []
    for (px, py), col in nodes:
        d2 = toroidal_dist_sq(nx, ny, px, py)
        if d2 < 1e-6:
            base_col = col
            break
        w = 1.0 / (d2 ** (power / 2.0))
        weights.append(w)
        colors.append(col)
    else:
        tot = sum(weights)
        oklab_coords = [c.convert("oklab").coords() for c in colors]
        L = sum(w * coords[0]
                for w, coords in zip(weights, oklab_coords)) / tot
        a = sum(w * coords[1]
                for w, coords in zip(weights, oklab_coords)) / tot
        b = sum(w * coords[2]
                for w, coords in zip(weights, oklab_coords)) / tot
        base_col = Color("oklab", [L, a, b])

    if val != 1.0:
        val_clamped = max(0.0, min(1.0, val))
        ok = base_col.convert("oklab")
        base_col = Color(
            "oklab", [ok["l"] * val_clamped, ok["a"] * val_clamped, ok["b"] * val_clamped])

    return base_col


def coord_to_hsv(nx: float, ny: float) -> Tuple[float, float]:
    """Convert [-1.0, 1.0] XY coordinates to polar Hue degrees [0.0, 360.0) and Saturation [0.0, 1.0]."""
    dist = math.hypot(nx, ny)
    sat = max(0.0, min(1.0, dist))
    hue = (math.degrees(math.atan2(ny, nx))) % 360.0 if dist > 1e-5 else 0.0
    return hue, sat


def coord_to_coloraide(
    nx: float,
    ny: float,
    val: float = 1.0,
    palette_name: Optional[str] = None
) -> Color:
    """
    Convert [-1.0, 1.0] XY coordinates to ColorAide Color object.
    If palette_name is provided, conforms to toroidal linked palette nodes (TL-BR, BL-TR, Center);
    otherwise defaults to polar HSV wheel.
    """
    if palette_name:
        return palette_coord_to_coloraide(nx, ny, palette_name=palette_name, val=val)
    hue, sat = coord_to_hsv(nx, ny)
    return Color("hsv", [hue, sat, max(0.0, min(1.0, val))])


def coord_to_rgb(
    nx: float,
    ny: float,
    val: float = 1.0,
    palette_name: Optional[str] = None
) -> Tuple[int, int, int]:
    """Convert [-1.0, 1.0] XY coordinates to (R, G, B) [0..255] using coloraide library."""
    c = coord_to_coloraide(nx, ny, val, palette_name=palette_name)
    srgb = c.convert("srgb")
    coords = tuple(srgb.coords())
    return (
        int(round(max(0.0, min(1.0, coords[0])) * 255)),
        int(round(max(0.0, min(1.0, coords[1])) * 255)),
        int(round(max(0.0, min(1.0, coords[2])) * 255)),
    )


def coord_to_hex(
    nx: float,
    ny: float,
    val: float = 1.0,
    palette_name: Optional[str] = None
) -> str:
    """Convert [-1.0, 1.0] XY coordinates to '#rrggbb' hex string using coloraide library."""
    return coord_to_coloraide(nx, ny, val, palette_name=palette_name).convert("srgb").to_string(hex=True)


class TextualXYPad(NavKeysMixin, Widget):
    """
    Shared 2D XY-Pad canvas widget for Textual with node overlays and generous hitboxes.
    """
    DEFAULT_CSS = """
    TextualXYPad {
        border: heavy red;
    }
    TextualXYPad:focus {
        border: heavy yellow;
    }
    TextualXYPad.-grown {
        width: 1fr;
        height: 1fr;
    }
    """
    can_focus = True

    # Terminal cells are ~2x taller than wide; use this to keep the grown pad visually square.
    CELL_ASPECT = 2.0

    def __init__(
        self,
        nodes: Optional[Dict[str, Dict[str, Any]]] = None,
        val_x: float = 0.0,
        val_y: float = 0.0,
        palette: Optional[str] = "inferno",
        cell_renderer: Optional[Callable[[
            float, float, int, int], Optional[Tuple[str, Union[str, Style]]]]] = None,
        on_change: Optional[Callable[[Tuple[float, float]], None]] = None,
        on_node_select: Optional[Callable[[Optional[str]], None]] = None,
        on_drag: Optional[Callable[[Tuple[float, float]], None]] = None,
        name: Optional[str] = None,
        id: Optional[str] = None,
        classes: Optional[str] = None,
        disabled: bool = False
    ):
        super().__init__(name=name, id=id, classes=classes, disabled=disabled)
        self.nodes = nodes if nodes is not None else {}
        self.val_x = val_x
        self.val_y = val_y
        self.palette = palette
        self.selected_node_id: Optional[str] = None
        self.cell_renderer = cell_renderer
        self.on_change = on_change
        self.on_node_select = on_node_select
        self.on_drag = on_drag
        self.is_dragging = False
        # Monotonic timestamp of the last user-driven val_x/val_y set (click/drag/nav); callers
        # echoing a value back from storage check this to avoid stomping a just-made edit before
        # its own round trip lands.
        self.last_user_set = 0.0

    def screen_to_coord(self, sx: int, sy: int) -> Tuple[float, float]:
        """Convert screen cell coordinates to normalized [-1.0, 1.0] continuous coordinates."""
        w = max(1, self.size.width - 2)
        h = max(1, self.size.height - 2)
        norm_x = (float(sx) / float(max(1, w - 1))) * 2.0 - 1.0
        norm_y = (float(sy) / float(max(1, h - 1))) * 2.0 - 1.0
        return max(-1.0, min(1.0, norm_x)), max(-1.0, min(1.0, norm_y))

    def coord_to_screen(self, nx: float, ny: float) -> Tuple[int, int]:
        """Convert continuous [-1.0, 1.0] coordinate to screen matrix cell (sx, sy)."""
        w = max(1, self.size.width - 2)
        h = max(1, self.size.height - 2)
        sx = int(round(((nx + 1.0) / 2.0) * (w - 1)))
        sy = int(round(((ny + 1.0) / 2.0) * (h - 1)))
        return max(0, min(w - 1, sx)), max(0, min(h - 1, sy))

    def render(self) -> Text:
        w = max(10, self.size.width - 2)
        h = max(4, self.size.height - 2)
        max_row_width = max(1, w - 1)

        # Precompute node screen positions
        node_positions = {}
        for nid, node in self.nodes.items():
            lx, ly = self.coord_to_screen(
                node.get("x", 0.0), node.get("y", 0.0))
            node_positions[nid] = (lx, ly, node)

        hx, hy = self.coord_to_screen(self.val_x, self.val_y)

        # Build grid buffer: rows of (char, style)
        grid = []
        for row in range(h):
            grid_row = []
            for col in range(w):
                cx, cy = self.screen_to_coord(col, row)
                # Truecolor chromaticity background for grid point conforming to toroidal palette
                gr, gg, gb = coord_to_rgb(
                    cx, cy, val=0.38, palette_name=self.palette)
                grid_row.append(
                    ("·", Style(color=RichColor.from_rgb(gr, gg, gb))))
            grid.append(grid_row)

        # 1. Background / custom cell rendering
        for row in range(h):
            for col in range(w):
                if self.cell_renderer:
                    cx, cy = self.screen_to_coord(col, row)
                    res = self.cell_renderer(cx, cy, col, row)
                    if res:
                        grid[row][col] = res
                else:
                    cx, cy = self.screen_to_coord(col, row)
                    if col == hx and row == hy:
                        # Core vortex reflects its coordinates' color (ascii '@')
                        vr, vg, vb = coord_to_rgb(
                            self.val_x, self.val_y, val=1.0, palette_name=self.palette)
                        grid[row][col] = (
                            "@", Style(color=RichColor.from_rgb(vr, vg, vb), bold=True))
                    elif row == hy:
                        vr, vg, vb = coord_to_rgb(
                            self.val_x, self.val_y, val=0.6, palette_name=self.palette)
                        grid[row][col] = (
                            "-", Style(color=RichColor.from_rgb(vr, vg, vb)))
                    elif col == hx:
                        vr, vg, vb = coord_to_rgb(
                            self.val_x, self.val_y, val=0.6, palette_name=self.palette)
                        grid[row][col] = ("|", Style(
                            color=RichColor.from_rgb(vr, vg, vb)))

        # 2. Overlay Nodes with bounded labels (reflecting their location hue/sat)
        for nid, (lx, ly, node) in node_positions.items():
            if 0 <= ly < h and 0 <= lx < w:
                is_sel = (self.selected_node_id == nid)
                name = node.get("name", str(nid))
                icon = node.get("icon", "*")
                tag = f"[* {nid}:{name} *]" if is_sel else f"[{nid}:{name}]"

                # Lamp reflects color of its current location
                node_x = node.get("x", 0.0)
                node_y = node.get("y", 0.0)
                nr, ng, nb = coord_to_rgb(
                    node_x, node_y, val=1.0, palette_name=self.palette)
                node_color = RichColor.from_rgb(nr, ng, nb)

                if is_sel:
                    icon_style = Style(
                        color=node_color, bold=True, reverse=True)
                    tag_style = Style(color=node_color,
                                      bold=True, reverse=True)
                else:
                    icon_style = Style(color=node_color, bold=True)
                    tag_style = Style(color=node_color, bold=True)

                grid[ly][lx] = (icon, icon_style)
                if len(icon) > 1 and lx + 1 < w:
                    grid[ly][lx + 1] = ("", "")

                # If label exceeds right edge, render it to the left of the icon
                if lx + 2 + len(tag) >= max_row_width:
                    tag_start = max(0, lx - len(tag) - 1)
                else:
                    tag_start = lx + 2

                for i, ch in enumerate(tag):
                    tx = tag_start + i
                    if 0 <= tx < max_row_width:
                        grid[ly][tx] = (ch, tag_style)

        # 3. Assemble Rich Text with strict visual width clipping (w - 1 for safe margin)
        t = Text()
        for row_idx, row in enumerate(grid):
            line_len = 0
            for _col_idx, (ch, st) in enumerate(row):
                if not ch:
                    continue
                ch_width = len(ch)
                if line_len + ch_width > max_row_width:
                    break
                t.append(ch, style=st)
                line_len += ch_width
            if row_idx < h - 1:
                t.append("\n")

        return t

    def on_click(self, event: events.Click) -> None:
        self.focus()
        # Hit-test in content coords (excludes border/padding); clicks on the border are ignored
        content = event.get_content_offset(self)
        if content is None:
            return
        ex, ey = content
        nx, ny = self.screen_to_coord(ex, ey)
        w = max(10, self.size.width - 2)
        max_row_width = max(1, w - 1)

        # Hit test nodes across screen box + label span + proximity
        clicked_nid = None
        for nid, node in self.nodes.items():
            lx_screen, ly_screen = self.coord_to_screen(
                node.get("x", 0.0), node.get("y", 0.0))
            is_sel = (self.selected_node_id == nid)
            name = node.get("name", str(nid))
            tag = f"[* {nid}:{name} *]" if is_sel else f"[{nid}:{name}]"
            tag_len = len(tag)

            if lx_screen + 2 + tag_len >= max_row_width:
                box_left = max(0, lx_screen - tag_len - 2)
                box_right = lx_screen + 3
            else:
                box_left = lx_screen - 2
                box_right = lx_screen + tag_len + 3

            in_screen_box = (
                (box_left <= ex <= box_right)
                and (ly_screen - 1 <= ey <= ly_screen + 1)
            )

            dx, dy = toroidal_delta(
                nx, ny, node.get("x", 0.0), node.get("y", 0.0))
            in_proximity = (math.hypot(dx, dy) < 0.15)

            if in_screen_box or in_proximity:
                clicked_nid = nid
                break

        if clicked_nid:
            self.selected_node_id = clicked_nid
            if self.on_node_select:
                self.on_node_select(clicked_nid)
        else:
            self.selected_node_id = None
            self.val_x = wrap_coord(nx)
            self.val_y = wrap_coord(ny)
            self.last_user_set = time.monotonic()
            if self.on_node_select:
                self.on_node_select(None)
            if self.on_change:
                self.on_change((self.val_x, self.val_y))
        self.refresh()

    # Keyboard nudge: shared nav keys (`textual_nav_keys`, same as NumberBox) move the
    # crosshair 1 cell per step; consumed while focused, Escape bubbles to the host.
    def on_key(self, event: events.Key) -> None:
        self.handle_nav(event)

    def on_focus(self, event: events.Focus) -> None:
        self._grow()

    def on_blur(self, event: events.Blur) -> None:
        self.remove_class("-grown")
        self.styles.width = None
        self.styles.height = None

    def _grow(self) -> None:
        # Enough to read the crosshair clearly, but capped well under full screen height so
        # the panel's own readout rows plus neighboring block content stay visible below it.
        screen_h = self.screen.size.height if self.screen else 24
        target_h = max(10, min(20, int(screen_h * 0.5)))
        target_w = max(10, int(round(target_h * self.CELL_ASPECT)))
        self.add_class("-grown")
        self.styles.height = target_h
        self.styles.width = target_w

    def on_nav(self, dx: int, dy: int, steps: int) -> bool:
        cx = 2.0 / max(1, self.size.width - 3)  # 1 cell in [-1, 1] coords
        cy = 2.0 / max(1, self.size.height - 3)
        self.val_x = max(-1.0, min(1.0, self.val_x + dx * steps * cx))
        self.val_y = max(-1.0, min(1.0, self.val_y + dy * steps * cy))
        self.last_user_set = time.monotonic()
        if self.on_change:
            self.on_change((self.val_x, self.val_y))
        self.refresh()
        return True

    def on_mouse_down(self, event: events.MouseDown) -> None:
        # Press = set: jump the crosshair under the cursor now (!wait for release/Click) and
        # capture the mouse so a drag leaving the pad keeps tracking & the release still lands here
        self.focus()
        self.is_dragging = True
        self.capture_mouse()
        content = event.get_content_offset(self)
        if content is not None and not self.nodes:
            self.val_x, self.val_y = self.screen_to_coord(*content)
            self.last_user_set = time.monotonic()
            if self.on_change:
                self.on_change((self.val_x, self.val_y))
            self.refresh()

    def on_mouse_up(self, event: events.MouseUp) -> None:
        self.is_dragging = False
        self.release_mouse()

    def on_mouse_move(self, event: events.MouseMove) -> None:
        # Only track when mousedown drag is active
        if not self.is_dragging:
            return
        content = event.get_content_offset(self)
        if content is not None:
            nx, ny = self.screen_to_coord(*content)
            if self.selected_node_id and self.selected_node_id in self.nodes:
                node = self.nodes[self.selected_node_id]
                node["x"] = wrap_coord(nx)
                node["y"] = wrap_coord(ny)
            else:
                self.val_x = wrap_coord(nx)
                self.val_y = wrap_coord(ny)
                self.last_user_set = time.monotonic()
                if self.on_change:
                    self.on_change((self.val_x, self.val_y))
            if self.on_drag:
                self.on_drag((nx, ny))
            self.refresh()

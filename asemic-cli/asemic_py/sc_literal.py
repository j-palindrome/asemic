"""SuperCollider translator: converts Python multiarrays, dictionaries, and primitives
into sclang literals and flat buffer payloads."""

import math
from typing import Any, Tuple, List


def to_sc(obj: Any) -> str:
    """Translates a Python object into a SuperCollider (sclang) literal expression.

    Supports:
      - None -> nil
      - bool -> true / false
      - int, float -> standard numeric literal
      - str -> string literal or symbol if prefixed with \\
      - list, tuple, multiarray -> [ ... ]
      - dict -> ( \\key: val, ... ) (sclang Event literal)
    """
    if obj is None:
        return "nil"
    if isinstance(obj, bool):
        return "true" if obj else "false"
    if isinstance(obj, (int, float)):
        if math.isnan(obj):
            return "0.0"
        if math.isinf(obj):
            return "inf" if obj > 0 else "-inf"
        return str(obj)
    if isinstance(obj, str):
        if obj.startswith("\\"):
            return obj
        escaped = obj.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    if isinstance(obj, (list, tuple)):
        items = ", ".join(to_sc(x) for x in obj)
        return f"[ {items} ]"
    if isinstance(obj, dict):
        pairs = []
        for k, v in obj.items():
            key_str = f"\\{k}" if not str(k).startswith("\\") else str(k)
            pairs.append(f"{key_str}: {to_sc(v)}")
        return f"( {', '.join(pairs)} )"
    # Fallback for numpy array or array-like
    if hasattr(obj, "tolist"):
        return to_sc(obj.tolist())
    return str(obj)


def flatten_multiarray(arr: Any) -> Tuple[List[float], List[int]]:
    """Flattens a multi-dimensional array/list into a 1D float list along with its shape.

    Returns:
      (flat_floats, shape)
    """
    if hasattr(arr, "shape") and hasattr(arr, "tolist"):
        shape = list(arr.shape)
        # flatten using numpy or recursion
        flat: List[float] = [float(x) for x in arr.flatten()]
        return flat, shape

    shape = []
    curr = arr
    while isinstance(curr, (list, tuple)) and len(curr) > 0:
        shape.append(len(curr))
        curr = curr[0]

    flat = []
    def _rec(item):
        if isinstance(item, (list, tuple)):
            for x in item:
                _rec(x)
        else:
            try:
                flat.append(float(item))
            except (ValueError, TypeError):
                flat.append(0.0)

    _rec(arr)
    return flat, shape

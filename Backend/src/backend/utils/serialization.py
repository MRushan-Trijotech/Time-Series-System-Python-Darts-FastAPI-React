"""Utility: safe JSON serialization for NumPy/pandas/float types."""
import math
from datetime import date, datetime
from typing import Any

import numpy as np
import pandas as pd


def json_safe(obj: Any) -> Any:
    """Recursively convert obj to JSON-serializable Python types."""
    if obj is None:
        return None
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return float(obj)
    if isinstance(obj, (np.ndarray,)):
        return [json_safe(v) for v in obj.tolist()]
    if isinstance(obj, (pd.Timestamp, datetime, date)):
        return obj.isoformat() if hasattr(obj, "isoformat") else str(obj)
    if isinstance(obj, dict):
        return {k: json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    return obj


def safe_float(val: Any) -> float | None:
    """Return float or None for NaN/inf."""
    try:
        f = float(val)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


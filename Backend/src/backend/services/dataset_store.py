"""In-memory dataset storage and lifecycle management."""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from backend.services.data_transformer import TransformResult
from backend.services.header_detection import HeaderDetectionResult


@dataclass
class DatasetRecord:
    dataset_id: str
    filename: str
    file_path: Path
    created_at: float = field(default_factory=time.time)
    sheet_names: list[str] = field(default_factory=list)
    active_sheet: str | None = None
    raw_df: pd.DataFrame | None = None
    header_detection: HeaderDetectionResult | None = None
    transform_result: TransformResult | None = None


_store: dict[str, DatasetRecord] = {}
_store_lock = threading.Lock()


def save_dataset(filename: str, file_path: Path, sheet_names: list[str]) -> DatasetRecord:
    dataset_id = str(uuid.uuid4())
    record = DatasetRecord(
        dataset_id=dataset_id,
        filename=filename,
        file_path=file_path,
        sheet_names=sheet_names,
    )
    with _store_lock:
        _store[dataset_id] = record
    return record


def get_dataset(dataset_id: str) -> DatasetRecord | None:
    with _store_lock:
        return _store.get(dataset_id)


def remove_dataset(dataset_id: str) -> None:
    with _store_lock:
        record = _store.pop(dataset_id, None)
        if record and record.file_path.exists():
            try:
                record.file_path.unlink()
            except OSError:
                pass


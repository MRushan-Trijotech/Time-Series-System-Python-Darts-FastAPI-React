from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

@pytest.fixture
def file_2023():
    path = DATA_DIR / "2023.xlsx"
    if not path.exists():
        pytest.skip(f"Missing test file: {path}")
    return path

@pytest.fixture
def file_2024():
    path = DATA_DIR / "2024 Data.xlsx"
    if not path.exists():
        pytest.skip(f"Missing test file: {path}")
    return path

@pytest.fixture
def file_2026_incompatible():
    path = DATA_DIR / "2026quantityotherhalf.xlsx"
    if not path.exists():
        pytest.skip(f"Missing test file: {path}")
    return path

def test_compatible_multi_upload(file_2023, file_2024):
    with open(file_2023, "rb") as f1, open(file_2024, "rb") as f2:
        resp = client.post(
            "/api/upload-multiple",
            files=[
                ("files", ("2023.xlsx", f1, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
                ("files", ("2024 Data.xlsx", f2, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
            ]
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_compatible"] is True
    assert len(data["files"]) == 2
    assert data["total_months"] == 24
    assert "SAC_PRODUCT" in data["common_dimensions"]

def test_incompatible_multi_upload(file_2023, file_2026_incompatible):
    with open(file_2023, "rb") as f1, open(file_2026_incompatible, "rb") as f2:
        resp = client.post(
            "/api/upload-multiple",
            files=[
                ("files", ("2023.xlsx", f1, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
                ("files", ("2026quantityotherhalf.xlsx", f2, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
            ]
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_compatible"] is False
    assert "Structural Mismatch" in data["incompatibility_reason"] or "Header Depth Mismatch" in data["incompatibility_reason"]

def test_merge_transform_compatible_and_incompatible(file_2023, file_2024, file_2026_incompatible):
    # Upload compatible
    with open(file_2023, "rb") as f1, open(file_2024, "rb") as f2:
        resp = client.post(
            "/api/upload-multiple",
            files=[
                ("files", ("2023.xlsx", f1, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
                ("files", ("2024 Data.xlsx", f2, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
            ]
        )
    compat_ids = [f["dataset_id"] for f in resp.json()["files"]]

    # Upload incompatible
    with open(file_2026_incompatible, "rb") as f3:
        resp_single = client.post(
            "/api/upload",
            files={"file": ("2026quantityotherhalf.xlsx", f3, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        )
    incompat_id = resp_single.json()["dataset_id"]

    # Merge compatible
    merge_resp = client.post(
        "/api/datasets/merge-transform",
        json={"dataset_ids": compat_ids}
    )
    assert merge_resp.status_code == 200
    merged_data = merge_resp.json()
    assert merged_data["row_count"] > 0
    assert "date_range_start" in merged_data
    assert "2023" in merged_data["date_range_start"]

    # Attempt merge with incompatible dataset -> 400
    bad_merge_resp = client.post(
        "/api/datasets/merge-transform",
        json={"dataset_ids": [compat_ids[0], incompat_id]}
    )
    assert bad_merge_resp.status_code == 400


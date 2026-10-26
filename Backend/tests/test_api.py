"""Integration tests for FastAPI endpoints."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"


def test_available_models():
    response = client.get("/api/training/models/available")
    assert response.status_code == 200
    data = response.json()
    assert "models" in data
    model_names = [m["name"] for m in data["models"]]
    assert "NaiveSeasonal" in model_names
    assert "ARIMA" in model_names
    assert "LinearRegressionModel" in model_names
    # Verify Theta / AutoTheta are NOT present per user request
    assert "Theta" not in model_names
    assert "AutoTheta" not in model_names


def test_full_pipeline_with_story_xlsx():
    story_path = Path("data/Story.xlsx")
    if not story_path.exists():
        pytest.skip("Story.xlsx not present in data/")

    # 1. Upload
    with open(story_path, "rb") as f:
        upload_resp = client.post(
            "/api/upload",
            files={"file": ("Story.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
    assert upload_resp.status_code == 200
    upload_data = upload_resp.json()
    dataset_id = upload_data["dataset_id"]
    assert "Table_3" in upload_data["sheet_names"]

    # 2. Inspect
    inspect_resp = client.post(
        f"/api/datasets/{dataset_id}/inspect",
        json={"sheet_name": "Table_3"},
    )
    assert inspect_resp.status_code == 200
    inspect_data = inspect_resp.json()
    assert inspect_data["header_depth"] == 2
    dim_names = [c["name"] for c in inspect_data["dimension_columns"]]
    assert "Business unit" in dim_names
    assert "ACCOUNT" in dim_names

    # 3. Transform
    transform_resp = client.post(
        f"/api/datasets/{dataset_id}/transform",
        json={"sheet_name": "Table_3"},
    )
    assert transform_resp.status_code == 200
    transform_data = transform_resp.json()
    assert transform_data["row_count"] > 1000

    # 4. Dimensions & Hierarchy
    dims_resp = client.get(f"/api/datasets/{dataset_id}/dimensions")
    assert dims_resp.status_code == 200
    dims_data = dims_resp.json()
    assert len(dims_data["dimensions"]) >= 4
    assert "7A01" in dims_data["bu_entity_hierarchy"]
    assert len(dims_data["accounts"]) > 0
    # Check that accounts have label and description
    sample_acc = dims_data["accounts"][0]
    assert "account" in sample_acc
    assert "label" in sample_acc

    # 5. Fast Training with hierarchical bu_entities and accounts
    train_resp = client.post(
        "/api/training",
        json={
            "dataset_id": dataset_id,
            "bu_entities": {"7A01": ["1200", "1400"]},
            "accounts": ["PL01"],
            "forecast_horizon": 6,
            "validation_split": 0.75,
            "candidate_models": ["NaiveSeasonal", "LinearRegressionModel"],
        },
    )
    assert train_resp.status_code == 200
    job_id = train_resp.json()["job_id"]

    # Poll until completed (timeout 30s)
    import time
    completed = False
    for _ in range(60):
        status_resp = client.get(f"/api/training/{job_id}")
        assert status_resp.status_code == 200
        st = status_resp.json()["status"]
        if st == "completed":
            completed = True
            break
        elif st == "failed":
            pytest.fail(f"Training job failed: {status_resp.json().get('error')}")
        time.sleep(0.5)

    assert completed, "Training job timed out"

    # 6. Check Reports
    forecast_resp = client.get(f"/api/reports/{job_id}/forecast")
    assert forecast_resp.status_code == 200
    f_data = forecast_resp.json()
    assert f_data["best_model"] in ["NaiveSeasonal", "LinearRegressionModel"]
    assert len(f_data["forecast"]) == 6
    assert f_data["validation"]["mape"] is not None

    explanation_resp = client.get(f"/api/reports/{job_id}/explanation")
    assert explanation_resp.status_code == 200
    e_data = explanation_resp.json()
    assert e_data["why_selected"] != ""

    # CSV Export
    csv_resp = client.get(f"/api/reports/{job_id}/export/forecast.csv")
    assert csv_resp.status_code == 200
    assert "Forecast Value" in csv_resp.text

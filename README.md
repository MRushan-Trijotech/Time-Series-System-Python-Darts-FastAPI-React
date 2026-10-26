# Enterprise Time-Series Forecasting Backend

A modular FastAPI backend inspired by **SAP Analytics Cloud Smart Predict**, built on **Darts**, **pandas**, and **scikit-learn**.

## Architecture & Features

- **Split-Row Header Detection**: Automatically identifies multi-row and partially populated Excel headers (such as SAP Analytics Cloud Story exports), separating dimension columns from time-period observation columns.
- **Pure Chronological Validation**: Splits data chronologically (e.g. 75% Train / 25% Validation) without data leakage or observation shuffling.
- **Tournament-Style Model Comparison**: Evaluates baseline models (`NaiveSeasonal`), statistical models (`ARIMA`, `AutoARIMA`, `ExponentialSmoothing`, `AutoETS`, `AutoCES`, `Prophet`), and machine learning models (`LinearRegressionModel`, `RandomForestModel`, `CatBoostModel`, `LightGBMModel`, `XGBModel`).
- **Best Model Selection**: Ranks valid models strictly by lowest finite validation MAPE.
- **Full History Retraining**: Fresh instance of the winning model is refitted on 100% of available historical observations before generating future forecasts.
- **Statistical Diagnostics**: Trend trajectory extraction, annual seasonality detection (m=12), and autocorrelation (ACF) lag diagnostics via Darts and statsmodels.
- **CSV Data Exports**: Downloadable future forecast tables and candidate model ranking comparisons.

## Prerequisites

- Python 3.12+
- `uv` package manager

## Installation & Launch

```powershell
# 1. Navigate to Backend directory
cd Backend

# 2. Sync dependencies
uv sync

# 3. Launch FastAPI server with hot-reload
uv run uvicorn backend.main:app --reload --port 8000
```

The API will be available at:
- **API Base**: `http://localhost:8000`
- **Swagger Documentation**: `http://localhost:8000/docs`
- **Health Check**: `http://localhost:8000/api/health`

## Running Automated Tests

```powershell
uv run pytest tests/ -v
```

## API Endpoints Overview

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/upload` | Upload `.xlsx` workbook, returns available sheet names |
| `POST` | `/api/datasets/{id}/inspect` | Detect split headers, dimensions, and monthly periods |
| `POST` | `/api/datasets/{id}/transform` | Pivot workbook to clean long format |
| `GET` | `/api/datasets/{id}/preview` | Preview transformed rows |
| `GET` | `/api/datasets/{id}/dimensions` | Retrieve available dimension names and values |
| `GET` | `/api/training/models/available` | List supported models and requirements |
| `POST` | `/api/training` | Start synchronous tournament job in background thread |
| `GET` | `/api/training/{job_id}` | Poll tournament progress, stage, and real-time logs |
| `GET` | `/api/reports/{job_id}/forecast` | Retrieve forecast points, actuals, and validation scores |
| `GET` | `/api/reports/{job_id}/explanation` | Retrieve trend, seasonality, and ACF diagnostic data |
| `GET` | `/api/reports/{job_id}/export/forecast.csv` | Download forecast table as CSV |
| `GET` | `/api/reports/{job_id}/export/models.csv` | Download model tournament rankings as CSV |


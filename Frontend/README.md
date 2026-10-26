# Enterprise Time-Series Forecasting Frontend

Modern React dashboard inspired by **SAP Analytics Cloud Smart Predict**, built with **Vite**, **TypeScript**, **Tailwind CSS**, and **Recharts**.

## Features

- **Guided 4-Step Predictive Workflow**:
  1. **Upload & Inspection**: Drag-and-drop Excel files, sheet selection, diagnosis of multi-row split headers, raw and long-format data preview.
  2. **Configuration**: Target measure specification, searchable multi-select entity dimension filters, horizon picker (3, 6, 12, 24 months), validation split slider, and candidate model selector.
  3. **Real-time Training Monitor**: Live progress bar, active candidate model indicator, and streaming terminal execution logs.
  4. **Forecast & Explanation Reports**: Interactive actual vs. validation vs. future forecast curves, KPI cards (MAPE, MAE, RMSE), future predictions table, candidate rankings table, trend decomposition, seasonality analysis, and autocorrelation (ACF) chart.
- **CSV Data Export**: One-click download of future predictions and model comparison results.
- **Enterprise Design**: Clean light canvas, accessible typography, restrained blue accents, and responsive layout.

## Prerequisites

- Node.js 18+
- npm

## Installation & Launch

```powershell
# 1. Navigate to Frontend directory
cd Frontend

# 2. Install dependencies
npm install

# 3. Start Vite development server
npm run dev
```

The application will launch at:
- **Frontend Dashboard**: `http://localhost:5173`

Vite proxies all `/api/*` requests directly to `http://localhost:8000`.

## Production Build

```powershell
npm run build
```

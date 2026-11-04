# Complete Setup & Run Instructions

This document provides step-by-step instructions to clone, set up, configure, and run the **Smart Predict Studio** time-series forecasting application from scratch.

---

## Prerequisites

Before starting, ensure you have the following installed on your machine:

1. **Git**: [Download Git](https://git-scm.com/downloads)
2. **Python 3.12** (Python 3.12.x recommended; Python 3.13 is also supported):
   - Check version:
     ```bash
     python --version
     ```
3. **Node.js (v18.x or v20.x+) & npm**:
   - Check version:
     ```bash
     node -v
     npm -v
     ```
4. **`uv` (Recommended Python package manager)**:
   - Extremely fast installer and runner for Python environments.
   - Install via `pip`:
     ```bash
     pip install uv
     ```
   - Or install via official standalone installers:
     - **Windows (PowerShell)**:
       ```powershell
       powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
       ```
     - **macOS / Linux (curl)**:
       ```bash
       curl -LsSf https://astral.sh/uv/install.sh | sh
       ```
   *(Alternatively, you can use standard Python `venv` + `pip` as described in Step 2B below).*

---

## Step 1: Clone the Repository

Open your terminal or PowerShell and run:

```bash
git clone https://github.com/MRushan-Trijotech/Time-Series-System-Python-Darts-FastAPI-React.git
cd Time-Series-System-Python-Darts-FastAPI-React
```

Verify you are in the root directory containing the `Backend/` and `Frontend/` folders:

```text
Time-Series-System-Python-Darts-FastAPI-React/
├── Backend/
├── Frontend/
├── README.md
├── Instruction.md
└── .gitignore
```

---

## Step 2: Backend Setup & Installation

You will need two separate terminal windows: one for the Backend and one for the Frontend.

### Method A: Using `uv` (Recommended & Fastest)

1. Open your first terminal and navigate to the `Backend` directory:
   ```bash
   cd Backend
   ```

2. Create the virtual environment using `uv`:
   ```bash
   uv venv .venv
   ```

3. Activate the virtual environment:
   - **Windows (PowerShell)**:
     ```powershell
     .venv\Scripts\activate
     ```
   - **Windows (Command Prompt)**:
     ```cmd
     .venv\Scripts\activate.bat
     ```
   - **macOS / Linux**:
     ```bash
     source .venv/bin/activate
     ```

4. Synchronize and install all dependencies:
   ```bash
   uv sync
   ```
   *This automatically sets up Python 3.12 and installs all project dependencies (FastAPI, Darts, Pandas, Scikit-learn, LightGBM, CatBoost, Statsmodels, Uvicorn, etc.) directly into `.venv/`.*

---

### Method B: Using Standard Python `venv` and `pip`

If you prefer not to use `uv`, you can use Python's built-in `venv`:

1. Open your terminal and navigate to `Backend`:
   ```bash
   cd Backend
   ```

2. Create a virtual environment:
   - **Windows**:
     ```powershell
     python -m venv .venv
     .venv\Scripts\activate
     ```
   - **macOS / Linux**:
     ```bash
     python3 -m venv .venv
     source .venv/bin/activate
     ```

3. Upgrade `pip` and install backend dependencies:
   ```bash
   pip install --upgrade pip
   pip install -e .
   pip install pytest pytest-asyncio httpx
   ```

---

## Step 3: Run the Backend Server (Uvicorn)

From inside the `Backend` directory:

### If using `uv`:
```bash
uv run uvicorn backend.main:app --reload --port 8000
```

### If using standard virtualenv (with `.venv` activated):
```bash
uvicorn backend.main:app --reload --port 8000
```

You should see output similar to:
```text
INFO:     Will watch for changes in these directories: ['...']
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [...] using StatReload
INFO:     Started server process [...]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

Leave this terminal running.

---

## Step 4: Frontend Setup & Installation

Open a **second terminal window** and navigate to the `Frontend` directory:

```bash
cd Frontend
```

Install the Node.js packages using `npm`:

```bash
npm install
```

---

## Step 5: Run the Frontend Application

From inside the `Frontend` directory, launch the Vite development server:

```bash
npm run dev
```

You should see output similar to:
```text
  VITE v8.3.5  ready in 250 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

---

## Step 6: Verify the Setup in Your Browser

1. **Frontend Web UI**: Open your browser and navigate to:
   [http://localhost:5173](http://localhost:5173)

2. **Backend API Swagger Documentation**:
   [http://localhost:8000/docs](http://localhost:8000/docs)

3. **Backend Health Check**:
   [http://localhost:8000/api/health](http://localhost:8000/api/health)
   *(Should return `{"status": "healthy", ...}`)*

---

## Step 7: Running Test Suites & Verification

### Run Backend Tests (Pytest)

In the Backend terminal:

```bash
# With uv:
uv run pytest tests/ -v

# Or with activated .venv:
pytest tests/ -v
```

Expected result: All unit and integration tests passing (`100%`).

### Verify Frontend TypeScript & Production Build

In the Frontend terminal:

```bash
npm run build
```

Expected result: Clean build with 0 TypeScript compilation errors.

---

## Step 8: End-to-End Workflow Walkthrough

1. **Step 1: Upload Data (`/upload`)**
   - Click **Download Sample Excel** in the top-right header to get a pre-formatted template (`sample_timeseries_structure.xlsx`).
   - Drag & drop single files or switch to **Multi-File Stitching** to stitch multiple annual files (e.g. 2023, 2024, 2025).
   - Review the automatic detection of Row 1 (Periods) and Row 2 (Dimensions).
   - Click **Confirm & Transform**.

2. **Step 2: Configure Forecast (`/configure`)**
   - Use the cascading dropdowns for **Business Unit**, **Legal Entity**, and child dimensions.
   - Notice that options are uniquely scoped (e.g., `"BU1-1400"` vs `"BU2-1400"`) and selected items stay pinned at the top.
   - Select your target account (e.g., `PL01 – Sales Revenue`).
   - Verify the historical observations count and dynamically suggested horizon.
   - Click **Start Forecasting Tournament**.

3. **Step 3: Training Tournament (`/training`)**
   - Watch candidate models compete side-by-side in real time across statistical, machine learning, and baseline families.
   - The winning model is crowned based on lowest validation MAPE.
   - The winning champion is automatically refitted on 100% of historical observations.

4. **Step 4: Forecast Report (`/report/forecast`)**
   - Inspect historical actuals seamlessly joined with the projected trajectory.
   - Review validation curves, residual errors, and period-over-period numbers.
   - Export forecast tables to CSV or Excel.

5. **Step 5: Explanation Report (`/report/explanation`)**
   - Review decomposition graphs: linear trend slope, annual 12-month seasonality, and autocorrelation (ACF) diagnostic bars.

6. **Step 6: Segment-Wise Report (`/report/segment-wise`)**
   - View independent predictions generated for every leaf segment in a hierarchical tree matrix matching the exact SAP Analytics Cloud Story format.
   - Export full hierarchical matrix directly to formatted `.xlsx` or `.csv`.

7. **Starting a New Session**:
   - Return to `/upload` or click **New Session** in the top navigation bar.
   - All previous jobs, data frames, and selections are cleanly reset.

---

## Common Troubleshooting & FAQs

### 1. `uvicorn: command not found`
- **Cause**: Virtual environment is not activated or dependencies were not installed.
- **Fix**: Run `uv sync` inside `Backend` and use `uv run uvicorn backend.main:app --reload --port 8000`, or activate `.venv` first (`.venv\Scripts\activate` on Windows).

### 2. `Network Error` or CORS issues when clicking Transform
- **Cause**: Backend server is not running on port 8000.
- **Fix**: Verify backend terminal is running and shows `Uvicorn running on http://127.0.0.1:8000`. Test `http://localhost:8000/api/health` in your browser.

### 3. Port 8000 or 5173 Already in Use
- **Windows**:
  ```powershell
  # Find PID using port 8000:
  netstat -ano | findstr :8000
  # Terminate PID:
  taskkill /PID <PID> /F
  ```
- **macOS / Linux**:
  ```bash
  lsof -i :8000
  kill -9 <PID>
  ```

### 4. PowerShell Execution Policy Restriction on Windows
- **Error**: `File ... activate.ps1 cannot be loaded because running scripts is disabled on this system.`
- **Fix**: Open PowerShell as Administrator and run:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```

### 5. Memory Considerations (Free Cloud Tiers like Render 512MB RAM)
- The backend incorporates streaming readers, chunked previewing, category datatype compression, and garbage collection sweeps (`gc.collect()`) to run reliably within 512MB RAM constraints.


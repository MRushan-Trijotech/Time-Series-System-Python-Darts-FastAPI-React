FROM python:3.12-slim
WORKDIR /app

# Install system build dependencies required by C/C++ compiled dependencies in Darts/statsmodels/Prophet
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv package manager
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Copy pyproject.toml & lock file
COPY pyproject.toml uv.lock* ./

# Install third-party dependencies first without the root package
RUN uv sync --frozen --no-dev --no-install-project

# Copy project files needed for package build (README.md is required by pyproject.toml)
COPY README.md ./
COPY src ./src

# Install root project into the virtual environment
RUN uv sync --frozen --no-dev

ENV PORT=8000
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Start Uvicorn bound to Render dynamic $PORT
CMD ["sh", "-c", "uv run uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

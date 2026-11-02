"""FastAPI entry point for the Time Series Forecasting application."""
import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api import routes_data, routes_reports, routes_training, routes_upload
from backend.config import settings

app = FastAPI(
    title=settings.app_title,
    version=settings.app_version,
    description="Enterprise Time Series Forecasting API inspired by SAP Analytics Cloud Smart Predict",
)

# CORS configuration supporting environment variable FRONTEND_URL
# Supports single URL, comma-separated URLs, or fallback wildcard for local development
frontend_env = os.getenv("FRONTEND_URL", "").strip()
if frontend_env:
    allowed_origins = [origin.strip() for origin in frontend_env.split(",") if origin.strip()]
else:
    allowed_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API routers
app.include_router(routes_upload.router, prefix="/api")
app.include_router(routes_data.router, prefix="/api")
app.include_router(routes_training.router, prefix="/api")
app.include_router(routes_reports.router, prefix="/api")


@app.get("/")
@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "app": settings.app_title,
        "version": settings.app_version,
    }


def main():
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)


if __name__ == "__main__":
    main()


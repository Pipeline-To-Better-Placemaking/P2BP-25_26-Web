import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import amc, calibration, rplidar, tracking, visualizer


def create_app() -> FastAPI:
    app = FastAPI(title="P2BP Workstation API")
    origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.get("/health")
    def health():
        return {"status": "ok"}

    for r in (tracking, rplidar, visualizer, calibration, amc):
        app.include_router(r.router)
    return app


app = create_app()

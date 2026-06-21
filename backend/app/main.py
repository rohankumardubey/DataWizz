from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import SQLAlchemyError

from app.api.dependencies import get_current_user
from app.api.routes import bi, engines, files, pipelines, queries, system, tables
from app.core.config import get_settings
from app.db.base import *  # noqa: F403
from app.db.runtime_schema import ensure_runtime_schema
from app.db.session import Base, SessionLocal, engine
from app.services.auth_service import auth_service
from app.services.pipeline_scheduler_service import pipeline_scheduler_service
from app.services.quality_scheduler_service import quality_scheduler_service
from app.services.storage import StorageService
from app.services.superset_catalog_service import superset_catalog_service


settings = get_settings()
storage_service = StorageService()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup() -> None:
    storage_service.ensure_directories()
    Base.metadata.create_all(bind=engine)
    ensure_runtime_schema(engine)
    db = SessionLocal()
    try:
        auth_service.ensure_seed_users(db)
        superset_catalog_service.safe_sync(db, reason="startup")
    finally:
        db.close()
    await pipeline_scheduler_service.start()
    await quality_scheduler_service.start()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    await pipeline_scheduler_service.stop()
    await quality_scheduler_service.stop()


app.include_router(system.router, prefix=settings.api_prefix)
app.include_router(engines.router, prefix=settings.api_prefix, dependencies=[Depends(get_current_user)])
app.include_router(files.router, prefix=settings.api_prefix, dependencies=[Depends(get_current_user)])
app.include_router(queries.router, prefix=settings.api_prefix, dependencies=[Depends(get_current_user)])
app.include_router(tables.router, prefix=settings.api_prefix, dependencies=[Depends(get_current_user)])
app.include_router(pipelines.router, prefix=settings.api_prefix, dependencies=[Depends(get_current_user)])
app.include_router(bi.router, prefix=settings.api_prefix, dependencies=[Depends(get_current_user)])


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
def readiness() -> dict[str, str]:
    try:
        with engine.connect() as connection:
            if connection.dialect.name == "sqlite":
                connection.exec_driver_sql("BEGIN IMMEDIATE")
                current_version = int(connection.exec_driver_sql("PRAGMA user_version").scalar_one())
                connection.exec_driver_sql(f"PRAGMA user_version = {current_version}")
                connection.rollback()
            else:
                connection.exec_driver_sql("SELECT 1")
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Metadata database is not writable") from exc
    return {"status": "ready"}

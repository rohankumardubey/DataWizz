from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, HTTPException, Query, Request as FastAPIRequest
from fastapi.responses import RedirectResponse
from sqlalchemy import desc, or_
from sqlalchemy.orm import Session

from app.api.dependencies import get_bearer_token, get_current_user, require_roles
from app.core.config import get_settings
from app.db.session import get_db
from app.models.auth import User
from app.models.bi import Chart, Dashboard, SemanticMetric
from app.models.catalog import DeltaTable, UploadedFile
from app.models.pipeline import JobLog, PipelineRun
from app.models.pipeline import Pipeline
from app.schemas.system import (
    AuthSessionResponse,
    AuthUserResponse,
    DashboardMetricsResponse,
    GlobalSearchResponse,
    GlobalSearchResult,
    LoginRequest,
    OpenLineageEventListResponse,
    OpenLineageStatusResponse,
    RecentActivityItem,
    SettingsSnapshotResponse,
    SupersetEmbedLaunchResponse,
    SupersetHealthResponse,
)
from app.services.auth_service import auth_service
from app.services.bi_service import BiService
from app.services.openlineage_service import openlineage_service
from app.services.storage import StorageService
from app.services.superset_catalog_service import superset_catalog_service
from app.services.superset_runtime_service import superset_runtime_service


router = APIRouter(prefix="/system", tags=["system"])
settings = get_settings()
storage_service = StorageService()
bi_service = BiService()


@router.get("/dashboard-metrics", response_model=DashboardMetricsResponse)
def dashboard_metrics(db: Session = Depends(get_db), _: User = Depends(get_current_user)) -> DashboardMetricsResponse:
    recent_activity: list[RecentActivityItem] = []
    recent_files = db.query(UploadedFile).order_by(desc(UploadedFile.created_at)).limit(3).all()
    recent_runs = db.query(PipelineRun).order_by(desc(PipelineRun.created_at)).limit(3).all()
    recent_logs = db.query(JobLog).order_by(desc(JobLog.created_at)).limit(3).all()

    for item in recent_files:
        recent_activity.append(RecentActivityItem(id=item.id, kind="file", title=item.name, status="uploaded", created_at=item.created_at.isoformat()))
    for item in recent_runs:
        recent_activity.append(RecentActivityItem(id=item.id, kind="pipeline_run", title=item.pipeline_id, status=item.status, created_at=item.created_at.isoformat()))
    for item in recent_logs:
        recent_activity.append(RecentActivityItem(id=item.id, kind="log", title=item.source, status=item.status or "info", created_at=item.created_at.isoformat()))

    recent_activity = sorted(recent_activity, key=lambda item: item.created_at, reverse=True)[:8]

    return DashboardMetricsResponse(
        total_files=db.query(UploadedFile).count(),
        total_delta_tables=db.query(DeltaTable).count(),
        total_pipeline_runs=db.query(PipelineRun).count(),
        failed_jobs=db.query(PipelineRun).filter(PipelineRun.status == "failed").count(),
        storage_usage_bytes=storage_service.get_storage_usage_bytes(),
        recent_activity=recent_activity,
    )


@router.get("/settings", response_model=SettingsSnapshotResponse)
def settings_snapshot(_: User = Depends(require_roles("admin"))) -> SettingsSnapshotResponse:
    return SettingsSnapshotResponse(
        storage={
            "raw": settings.raw_storage_path,
            "curated": settings.curated_storage_path,
            "temp": settings.temp_storage_path,
            "minio_endpoint": settings.minio_endpoint,
            "minio_bucket": settings.minio_bucket,
        },
        execution={"engine": settings.execution_engine, "query_preview_limit": settings.query_preview_limit},
    )


@router.get("/openlineage/status", response_model=OpenLineageStatusResponse)
def openlineage_status(_: User = Depends(get_current_user)) -> OpenLineageStatusResponse:
    return OpenLineageStatusResponse.model_validate(openlineage_service.get_status())


@router.get("/openlineage/events", response_model=OpenLineageEventListResponse)
def openlineage_events(
    limit: int = Query(default=100, ge=1, le=500),
    event_type: str | None = Query(default=None),
    job_name: str | None = Query(default=None),
    run_id: str | None = Query(default=None),
    _: User = Depends(get_current_user),
) -> OpenLineageEventListResponse:
    return OpenLineageEventListResponse(
        items=openlineage_service.list_events(
            limit=limit,
            event_type=event_type,
            job_name=job_name,
            run_id=run_id,
        )
    )


@router.post("/login", response_model=AuthSessionResponse)
@router.post("/demo-login", response_model=AuthSessionResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> AuthSessionResponse:
    user = auth_service.authenticate_user(db, payload.email, payload.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    _, token = auth_service.create_session(db, user)
    return AuthSessionResponse(
        token=token,
        user=AuthUserResponse(name=user.name, email=user.email, role=user.role),
    )


@router.get("/me", response_model=AuthUserResponse)
def current_session_me(current_user: User = Depends(get_current_user)) -> AuthUserResponse:
    return AuthUserResponse(name=current_user.name, email=current_user.email, role=current_user.role)


@router.post("/logout")
def logout(token: str = Depends(get_bearer_token), db: Session = Depends(get_db)) -> dict[str, str]:
    auth_service.revoke_session(db, token)
    return {"message": "Logged out successfully"}


@router.get("/search", response_model=GlobalSearchResponse)
def global_search(
    db: Session = Depends(get_db),
    q: str = Query(min_length=1),
    limit: int = Query(default=12, ge=1, le=30),
    current_user: User = Depends(get_current_user),
) -> GlobalSearchResponse:
    needle = q.strip()
    if not needle:
        return GlobalSearchResponse(query=q, items=[])

    like = f"%{needle}%"
    items: list[GlobalSearchResult] = []

    files = (
        db.query(UploadedFile)
        .filter(UploadedFile.name.ilike(like))
        .order_by(desc(UploadedFile.updated_at))
        .limit(limit)
        .all()
    )
    items.extend(
        [
            GlobalSearchResult(
                id=item.id,
                kind="file",
                title=item.name,
                subtitle=f"{item.file_type.upper()} raw asset",
                route=f"/files?fileId={item.id}",
                updated_at=item.updated_at.isoformat(),
            )
            for item in files
        ]
    )

    tables = (
        db.query(DeltaTable)
        .filter(or_(DeltaTable.name.ilike(like), DeltaTable.description.ilike(like), DeltaTable.schema_name.ilike(like)))
        .order_by(desc(DeltaTable.updated_at))
        .limit(limit)
        .all()
    )
    items.extend(
        [
            GlobalSearchResult(
                id=item.id,
                kind="table",
                title=f"{item.schema_name}.{item.name}",
                subtitle=item.description or "Curated Delta Lake table",
                route=f"/catalog?tableId={item.id}",
                updated_at=item.updated_at.isoformat(),
            )
            for item in tables
        ]
    )

    pipelines = (
        db.query(Pipeline)
        .filter(or_(Pipeline.name.ilike(like), Pipeline.description.ilike(like)))
        .order_by(desc(Pipeline.updated_at))
        .limit(limit)
        .all()
    )
    items.extend(
        [
            GlobalSearchResult(
                id=item.id,
                kind="pipeline",
                title=item.name,
                subtitle=item.description or "Pipeline definition",
                route=f"/pipelines?pipelineId={item.id}",
                updated_at=item.updated_at.isoformat(),
            )
            for item in pipelines
        ]
    )

    dashboards = [
        dashboard
        for dashboard in db.query(Dashboard)
        .filter(or_(Dashboard.name.ilike(like), Dashboard.description.ilike(like)))
        .order_by(desc(Dashboard.updated_at))
        .all()
        if bi_service.can_user_view_dashboard(current_user, dashboard)
    ][:limit]
    items.extend(
        [
            GlobalSearchResult(
                id=item.id,
                kind="dashboard",
                title=item.name,
                subtitle=item.description or "BI dashboard",
                route=f"/bi/dashboards?dashboardId={item.id}",
                updated_at=item.updated_at.isoformat(),
            )
            for item in dashboards
        ]
    )

    charts = (
        db.query(Chart)
        .filter(or_(Chart.name.ilike(like), Chart.chart_type.ilike(like)))
        .order_by(desc(Chart.updated_at))
        .limit(limit)
        .all()
    )
    items.extend(
        [
            GlobalSearchResult(
                id=item.id,
                kind="chart",
                title=item.name,
                subtitle=f"{item.chart_type} chart",
                route=f"/bi/charts?chartId={item.id}",
                updated_at=item.updated_at.isoformat(),
            )
            for item in charts
        ]
    )

    metrics = (
        db.query(SemanticMetric)
        .filter(or_(SemanticMetric.name.ilike(like), SemanticMetric.label.ilike(like), SemanticMetric.description.ilike(like)))
        .order_by(desc(SemanticMetric.updated_at))
        .limit(limit)
        .all()
    )
    items.extend(
        [
            GlobalSearchResult(
                id=item.id,
                kind="metric",
                title=item.label,
                subtitle=item.description or item.expression,
                route=f"/bi/metrics?metricId={item.id}",
                updated_at=item.updated_at.isoformat(),
            )
            for item in metrics
        ]
    )

    items.sort(key=lambda item: item.updated_at, reverse=True)
    return GlobalSearchResponse(query=q, items=items[:limit])


def _build_superset_integration_status() -> SupersetHealthResponse:
    checked_url = f"{settings.superset_url.rstrip('/')}/health"
    ui_check_url = f"{settings.superset_url.rstrip('/')}/login/?next=/superset/welcome/"
    reachable = False
    http_status: int | None = None
    detail: str | None = None
    ui_http_status: int | None = None
    ui_healthy = False

    try:
        request = Request(checked_url, method="GET")
        with urlopen(request, timeout=2) as response:
            http_status = response.status
            reachable = 200 <= response.status < 400
            detail = "Superset health endpoint responded successfully."
    except HTTPError as exc:
        http_status = exc.code
        detail = f"Superset responded with HTTP {exc.code}."
    except URLError as exc:
        detail = f"Could not reach Superset at {checked_url}: {exc.reason}"
    except Exception as exc:  # noqa: BLE001
        detail = f"Unexpected Superset health check failure: {exc}"

    if reachable:
        try:
            ui_request = Request(ui_check_url, method="GET")
            with urlopen(ui_request, timeout=2) as response:
                ui_http_status = response.status
                ui_healthy = 200 <= response.status < 400
        except HTTPError as exc:
            ui_http_status = exc.code
            detail = f"Superset health endpoint is up, but the UI returned HTTP {exc.code}."
        except URLError as exc:
            detail = f"Superset health endpoint is up, but the UI check failed: {exc.reason}"
        except Exception as exc:  # noqa: BLE001
            detail = f"Superset health endpoint is up, but the UI check failed: {exc}"

    overall_reachable = reachable
    serving_catalog = superset_catalog_service.get_status()
    auto_connection = superset_runtime_service.get_connection_status() if overall_reachable else {
        "name": superset_runtime_service.connection_name,
        "runtime_mode": superset_runtime_service.read_runtime_state().get("mode", "unknown"),
        "expected_sqlalchemy_uri": superset_runtime_service.get_connection_target()["sqlalchemy_uri"],
        "database_path": serving_catalog.get("database_path"),
        "provisioned": False,
        "database_id": None,
        "found_sqlalchemy_uri": None,
        "backend": None,
        "expose_in_sqllab": None,
    }

    sample_connections = [
        {
            "label": "Host DuckDB Serving Catalog",
            "purpose": "Recommended local connection for Superset running natively on the same machine as DataWizz.",
            "sqlalchemy_uri": serving_catalog["host_sqlalchemy_uri"],
        },
        {
            "label": "Docker DuckDB Serving Catalog",
            "purpose": "Use this from inside the Superset container when the managed runtime is using the Docker profile.",
            "sqlalchemy_uri": serving_catalog["container_sqlalchemy_uri"],
        },
        {
            "label": "PostgreSQL Metadata",
            "purpose": "Optional metadata-only connection if you want to inspect platform tables rather than curated analytics data.",
            "sqlalchemy_uri": "postgresql://postgres:postgres@localhost:5432/lakehouse",
        },
    ]

    sample_datasets = [
        {
            "name": asset["object_name"],
            "schema": asset["object_schema"],
            "description": asset["description"],
            "asset_kind": asset["asset_kind"],
            "display_name": asset["display_name"],
        }
        for asset in serving_catalog.get("assets", [])
        if asset["asset_kind"] in {"curated_table", "semantic_dataset"}
    ][:8]

    return SupersetHealthResponse(
        status="healthy" if overall_reachable and ui_healthy else ("degraded" if overall_reachable else "unreachable"),
        reachable=overall_reachable,
        checked_url=checked_url,
        http_status=ui_http_status or http_status,
        detail=detail,
        login={
            "ui_url": settings.superset_url,
            "username": settings.superset_username,
            "password": settings.superset_password,
            "embed_launch_path": "/api/system/integrations/superset/embed-login",
        },
        serving_catalog=serving_catalog,
        auto_connection=auto_connection,
        sample_connections=sample_connections,
        sample_datasets=sample_datasets,
        setup={
            "compose_command": "docker compose --profile superset up --build",
            "local_command": "./run.sh local superset",
            "auto_command": "./run.sh auto superset",
            "native_command": "./run.sh local superset native",
            "profile": "superset",
            "embedded_ui_path": "/bi/superset",
            "notes": [
                "Use ./run.sh local superset for the managed Superset launch path; it will use Docker when available and native Python fallback when Docker is missing.",
                "Use ./run.sh local superset native if you want to force the no-Docker path explicitly.",
                "The embedded page in DataWizz points at the same local Superset runtime shown at the ui_url above.",
                "DataWizz now auto-registers the DuckDB serving catalog inside Superset during startup when the managed runtime is healthy.",
                "Use the provision action on this page if you ever want to repair or recreate that connection manually.",
                "After adding the connection, look in the raw, analytics, and semantic schemas for synced DataWizz sources.",
            ],
        },
    )


@router.get("/integrations/superset", response_model=SupersetHealthResponse)
def superset_integration_status(_: User = Depends(get_current_user)) -> SupersetHealthResponse:
    return _build_superset_integration_status()


@router.post("/integrations/superset/embed-launch", response_model=SupersetEmbedLaunchResponse)
def create_superset_embed_launch(
    request: FastAPIRequest,
    next: str | None = Query(default="/superset/welcome/"),
    current_user: User = Depends(get_current_user),
) -> SupersetEmbedLaunchResponse:
    if not superset_runtime_service.is_healthy():
        raise HTTPException(
            status_code=503,
            detail="Superset is not ready. Start DataWizz with ./run.sh and wait for the launcher to report that Superset is healthy.",
        )
    ticket = superset_runtime_service.create_embed_ticket(user_id=current_user.id, next_path=next)
    return SupersetEmbedLaunchResponse(
        launch_url=str(request.url_for("superset_embed_login")) + f"?ticket={ticket}"
    )


@router.get("/integrations/superset/embed-login")
def superset_embed_login(ticket: str = Query(min_length=12)) -> RedirectResponse:
    ticket_record = superset_runtime_service.consume_embed_ticket(ticket)
    if ticket_record is None:
        raise HTTPException(status_code=401, detail="Superset launch ticket is invalid or expired")

    try:
        target_url, cookies = superset_runtime_service.login_browser_session(next_path=ticket_record.get("next_path"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Could not establish the Superset browser session: {exc}") from exc

    response = RedirectResponse(url=target_url, status_code=302)
    for cookie in cookies:
        response.set_cookie(
            key=cookie["name"],
            value=cookie["value"],
            path=cookie.get("path") or "/",
            secure=bool(cookie.get("secure")),
            httponly=bool(cookie.get("httponly")),
            samesite="lax",
        )
    return response


@router.post("/integrations/superset/sync", response_model=SupersetHealthResponse, dependencies=[Depends(require_roles("admin", "analyst"))])
def sync_superset_catalog(db: Session = Depends(get_db)) -> SupersetHealthResponse:
    superset_catalog_service.safe_sync(db, reason="manual_resync")
    return _build_superset_integration_status()


@router.post("/integrations/superset/provision", response_model=SupersetHealthResponse, dependencies=[Depends(require_roles("admin", "analyst"))])
def provision_superset_connection(db: Session = Depends(get_db)) -> SupersetHealthResponse:
    superset_catalog_service.safe_sync(db, reason="pre_provision_sync")
    superset_runtime_service.provision_serving_catalog_connection()
    return _build_superset_integration_status()

import json
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, require_roles
from app.db.session import get_db
from app.models.auth import User
from app.models.bi import Chart, Dashboard, MetricAlert, ReportSchedule, SemanticDataset, SemanticMetric
from app.schemas.common import ApiMessage
from app.schemas.bi import (
    ChartListResponse,
    ChartCreateRequest,
    ChartRead,
    ChartTraceabilityResponse,
    ChartPreviewResponse,
    ChartUpdateRequest,
    DashboardListResponse,
    DashboardCreateRequest,
    DashboardDetailResponse,
    DashboardExportPayload,
    DashboardImportRequest,
    DashboardImportResponse,
    DashboardUpdateRequest,
    DashboardSnapshotRequest,
    DashboardSnapshotResponse,
    DatasetPreviewResponse,
    DatasetExplorerResponse,
    MetricAlertCreateRequest,
    MetricAlertEvaluationResponse,
    MetricAlertEventListResponse,
    MetricAlertListResponse,
    MetricAlertRead,
    MetricAlertSweepResponse,
    MetricAlertUpdateRequest,
    NaturalLanguageChartRequest,
    NaturalLanguageChartResponse,
    ReportScheduleCreateRequest,
    ReportScheduleExecutionResponse,
    ReportScheduleListResponse,
    ReportScheduleRead,
    ReportSnapshotListResponse,
    SemanticDatasetCreateRequest,
    SemanticDatasetRead,
    SemanticDatasetUpdateRequest,
    SemanticMetricCreateRequest,
    SemanticMetricListResponse,
    SemanticMetricPreviewRequest,
    SemanticMetricPreviewResponse,
    SemanticMetricRead,
    SemanticMetricUpdateRequest,
)
from app.services.bi_service import BiService
from app.services.superset_catalog_service import superset_catalog_service


router = APIRouter(prefix="/bi", tags=["bi"])
bi_service = BiService()


@router.get("/datasets", response_model=DatasetExplorerResponse)
def list_datasets(db: Session = Depends(get_db)) -> DatasetExplorerResponse:
    stored = db.query(SemanticDataset).order_by(SemanticDataset.updated_at.desc()).all()
    candidates = bi_service.list_candidate_datasets(db)
    return DatasetExplorerResponse(items=stored, candidates=candidates)


@router.post("/datasets", response_model=SemanticDatasetRead, dependencies=[Depends(require_roles("admin", "analyst"))])
def create_dataset(payload: SemanticDatasetCreateRequest, db: Session = Depends(get_db)) -> SemanticDatasetRead:
    data = payload.model_dump(by_alias=True)
    data["name"] = bi_service.resolve_dataset_name(db, payload.name)
    record = SemanticDataset(**data)
    db.add(record)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A dataset with this name already exists. Please try again.") from exc
    db.refresh(record)
    superset_catalog_service.safe_sync(db, reason=f"dataset_create:{record.name}")
    return record


@router.put("/datasets/{dataset_id}", response_model=SemanticDatasetRead, dependencies=[Depends(require_roles("admin", "analyst"))])
def update_dataset(dataset_id: str, payload: SemanticDatasetUpdateRequest, db: Session = Depends(get_db)) -> SemanticDatasetRead:
    record = db.query(SemanticDataset).filter(SemanticDataset.id == dataset_id).one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    data = payload.model_dump(by_alias=True)
    data["name"] = bi_service.resolve_dataset_name(db, payload.name, exclude_id=dataset_id)
    for key, value in data.items():
        setattr(record, key, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A dataset with this name already exists. Please try again.") from exc
    db.refresh(record)
    superset_catalog_service.safe_sync(db, reason=f"dataset_update:{record.name}")
    return record


@router.get("/datasets/{dataset_id}/preview", response_model=DatasetPreviewResponse)
def preview_dataset(dataset_id: str, db: Session = Depends(get_db)) -> DatasetPreviewResponse:
    dataset = db.query(SemanticDataset).filter(SemanticDataset.id == dataset_id).one_or_none()
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if dataset.source_type == "delta_table":
        preview = bi_service.preview_delta_source(db, table_name=dataset.source_ref)
    elif dataset.source_type == "notebook_snapshot":
        preview = bi_service.preview_notebook_snapshot_source(dataset)
    else:
        raise HTTPException(status_code=400, detail="Preview is currently supported only for Delta table or notebook snapshot datasets")
    return DatasetPreviewResponse(**preview)


@router.get("/datasets/candidates/{candidate_id}/preview", response_model=DatasetPreviewResponse)
def preview_candidate_dataset(candidate_id: str, db: Session = Depends(get_db)) -> DatasetPreviewResponse:
    try:
        preview = bi_service.preview_delta_source(db, table_id=candidate_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return DatasetPreviewResponse(**preview)


@router.get("/metrics", response_model=SemanticMetricListResponse)
def list_metrics(db: Session = Depends(get_db)) -> SemanticMetricListResponse:
    return SemanticMetricListResponse(items=bi_service.list_metrics(db))


@router.post("/metrics", response_model=SemanticMetricRead, dependencies=[Depends(require_roles("admin", "analyst"))])
def create_metric(
    payload: SemanticMetricCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SemanticMetricRead:
    dataset = db.query(SemanticDataset).filter(SemanticDataset.id == payload.dataset_id).one_or_none()
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    try:
        bi_service.validate_metric_sql_fragment(payload.expression, "Metric expression")
        if payload.filter_sql:
            bi_service.validate_metric_sql_fragment(payload.filter_sql, "Metric filter")
        bi_service.validate_metric_dimensions(dataset, payload.dimensions_json)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    record = SemanticMetric(
        **{
            **payload.model_dump(),
            "name": bi_service.resolve_metric_name(db, payload.name),
            "owner_email": current_user.email,
        }
    )
    db.add(record)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A metric with this name already exists. Please try again.") from exc
    db.refresh(record)
    return SemanticMetricRead.model_validate(bi_service.serialize_metric(db, record))


@router.put("/metrics/{metric_id}", response_model=SemanticMetricRead, dependencies=[Depends(require_roles("admin", "analyst"))])
def update_metric(metric_id: str, payload: SemanticMetricUpdateRequest, db: Session = Depends(get_db)) -> SemanticMetricRead:
    record = db.query(SemanticMetric).filter(SemanticMetric.id == metric_id).one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Metric not found")
    dataset = db.query(SemanticDataset).filter(SemanticDataset.id == payload.dataset_id).one_or_none()
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    try:
        bi_service.validate_metric_sql_fragment(payload.expression, "Metric expression")
        if payload.filter_sql:
            bi_service.validate_metric_sql_fragment(payload.filter_sql, "Metric filter")
        bi_service.validate_metric_dimensions(dataset, payload.dimensions_json)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    data = payload.model_dump()
    data["name"] = bi_service.resolve_metric_name(db, payload.name, exclude_id=metric_id)
    for key, value in data.items():
        setattr(record, key, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A metric with this name already exists. Please try again.") from exc
    db.refresh(record)
    return SemanticMetricRead.model_validate(bi_service.serialize_metric(db, record))


@router.post("/metrics/{metric_id}/preview", response_model=SemanticMetricPreviewResponse)
def preview_metric(metric_id: str, payload: SemanticMetricPreviewRequest, db: Session = Depends(get_db)) -> SemanticMetricPreviewResponse:
    record = db.query(SemanticMetric).filter(SemanticMetric.id == metric_id).one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Metric not found")
    try:
        preview = bi_service.build_metric_preview(
            db,
            record,
            dimensions=payload.dimensions,
            where_sql=payload.where_sql,
            limit=payload.limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SemanticMetricPreviewResponse.model_validate(preview)


@router.delete("/metrics/{metric_id}", response_model=ApiMessage, dependencies=[Depends(require_roles("admin", "analyst"))])
def delete_metric(metric_id: str, db: Session = Depends(get_db)) -> ApiMessage:
    record = db.query(SemanticMetric).filter(SemanticMetric.id == metric_id).one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Metric not found")
    db.delete(record)
    db.commit()
    return ApiMessage(message="Metric deleted successfully")


@router.get("/alerts", response_model=MetricAlertListResponse)
def list_alerts(db: Session = Depends(get_db)) -> MetricAlertListResponse:
    return MetricAlertListResponse(items=bi_service.list_alerts(db))


@router.post("/alerts", response_model=MetricAlertRead, dependencies=[Depends(require_roles("admin", "analyst"))])
def create_alert(
    payload: MetricAlertCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MetricAlertRead:
    metric = db.query(SemanticMetric).filter(SemanticMetric.id == payload.metric_id).one_or_none()
    if metric is None:
        raise HTTPException(status_code=404, detail="Metric not found")
    record = MetricAlert(
        **{
            **payload.model_dump(),
            "name": bi_service.resolve_alert_name(db, payload.name),
            "owner_email": current_user.email,
            "last_status": "not_evaluated",
        }
    )
    db.add(record)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="An alert with this name already exists. Please try again.") from exc
    db.refresh(record)
    return MetricAlertRead.model_validate(bi_service.serialize_alert(db, record))


@router.put("/alerts/{alert_id}", response_model=MetricAlertRead, dependencies=[Depends(require_roles("admin", "analyst"))])
def update_alert(alert_id: str, payload: MetricAlertUpdateRequest, db: Session = Depends(get_db)) -> MetricAlertRead:
    record = db.query(MetricAlert).filter(MetricAlert.id == alert_id).one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    metric = db.query(SemanticMetric).filter(SemanticMetric.id == payload.metric_id).one_or_none()
    if metric is None:
        raise HTTPException(status_code=404, detail="Metric not found")

    data = payload.model_dump()
    data["name"] = bi_service.resolve_alert_name(db, payload.name, exclude_id=alert_id)
    for key, value in data.items():
        setattr(record, key, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="An alert with this name already exists. Please try again.") from exc
    db.refresh(record)
    return MetricAlertRead.model_validate(bi_service.serialize_alert(db, record))


@router.delete("/alerts/{alert_id}", response_model=ApiMessage, dependencies=[Depends(require_roles("admin", "analyst"))])
def delete_alert(alert_id: str, db: Session = Depends(get_db)) -> ApiMessage:
    record = db.query(MetricAlert).filter(MetricAlert.id == alert_id).one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    db.delete(record)
    db.commit()
    return ApiMessage(message="Alert deleted successfully")


@router.post("/alerts/{alert_id}/evaluate", response_model=MetricAlertEvaluationResponse, dependencies=[Depends(require_roles("admin", "analyst"))])
def evaluate_alert(alert_id: str, db: Session = Depends(get_db)) -> MetricAlertEvaluationResponse:
    record = db.query(MetricAlert).filter(MetricAlert.id == alert_id).one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    event = bi_service.evaluate_metric_alert(db, record)
    db.commit()
    db.refresh(record)
    db.refresh(event)
    return MetricAlertEvaluationResponse(
        alert=MetricAlertRead.model_validate(bi_service.serialize_alert(db, record)),
        event=bi_service.serialize_alert_event(db, event),
    )


@router.post("/alerts/evaluate-all", response_model=MetricAlertSweepResponse, dependencies=[Depends(require_roles("admin", "analyst"))])
def evaluate_all_alerts(db: Session = Depends(get_db)) -> MetricAlertSweepResponse:
    events = bi_service.evaluate_enabled_metric_alerts(db)
    db.commit()
    for event in events:
        db.refresh(event)
    serialized_events = [bi_service.serialize_alert_event(db, event) for event in events]
    return MetricAlertSweepResponse(
        checked=len(serialized_events),
        triggered=sum(1 for event in serialized_events if event["triggered"]),
        errored=sum(1 for event in serialized_events if event["status"] == "error"),
        events=serialized_events,
    )


@router.get("/alerts/events", response_model=MetricAlertEventListResponse)
def list_alert_events(
    alert_id: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> MetricAlertEventListResponse:
    return MetricAlertEventListResponse(items=bi_service.list_alert_events(db, alert_id=alert_id, limit=limit))


@router.get("/charts", response_model=ChartListResponse)
def list_charts(db: Session = Depends(get_db)) -> ChartListResponse:
    items = db.query(Chart).order_by(Chart.updated_at.desc()).all()
    return ChartListResponse(items=items)


@router.post("/charts/generate", response_model=NaturalLanguageChartResponse, dependencies=[Depends(require_roles("admin", "analyst"))])
def generate_chart_from_prompt(payload: NaturalLanguageChartRequest, db: Session = Depends(get_db)) -> NaturalLanguageChartResponse:
    try:
        generated = bi_service.generate_chart_from_prompt(
            db,
            prompt=payload.prompt,
            dataset_id=payload.dataset_id,
            limit=payload.limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return NaturalLanguageChartResponse.model_validate(generated)


@router.post("/charts", response_model=ChartRead, dependencies=[Depends(require_roles("admin", "analyst"))])
def create_chart(payload: ChartCreateRequest, db: Session = Depends(get_db)) -> ChartRead:
    record = Chart(**payload.model_dump())
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.put("/charts/{chart_id}", response_model=ChartRead, dependencies=[Depends(require_roles("admin", "analyst"))])
def update_chart(chart_id: str, payload: ChartUpdateRequest, db: Session = Depends(get_db)) -> ChartRead:
    record = db.query(Chart).filter(Chart.id == chart_id).one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Chart not found")
    data = payload.model_dump()
    for key, value in data.items():
        setattr(record, key, value)
    db.commit()
    db.refresh(record)
    return record


@router.get("/charts/{chart_id}/traceability", response_model=ChartTraceabilityResponse)
def get_chart_traceability(chart_id: str, db: Session = Depends(get_db)) -> ChartTraceabilityResponse:
    try:
        payload = bi_service.get_chart_traceability(db, chart_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ChartTraceabilityResponse.model_validate(payload)


@router.delete("/charts/{chart_id}", response_model=ApiMessage, dependencies=[Depends(require_roles("admin", "analyst"))])
def delete_chart(chart_id: str, db: Session = Depends(get_db)) -> ApiMessage:
    record = db.query(Chart).filter(Chart.id == chart_id).one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Chart not found")
    db.delete(record)
    db.commit()
    return ApiMessage(message="Chart deleted successfully")


@router.post("/charts/preview", response_model=ChartPreviewResponse)
def preview_chart(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "analyst")),
) -> ChartPreviewResponse:
    sql = payload.get("sql")
    if not sql:
        raise HTTPException(status_code=400, detail="SQL is required")
    preview = bi_service.preview_chart(
        db,
        sql,
        limit=int(payload.get("limit", 200)),
        access_context={"role": current_user.role, "email": current_user.email},
    )
    return ChartPreviewResponse(**preview)


@router.get("/dashboards", response_model=DashboardListResponse)
def list_dashboards(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> DashboardListResponse:
    items = bi_service.list_visible_dashboards(db, current_user)
    return DashboardListResponse(items=items)


@router.post("/dashboards", response_model=DashboardDetailResponse, dependencies=[Depends(require_roles("admin", "analyst"))])
def create_dashboard(
    payload: DashboardCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DashboardDetailResponse:
    visibility, shared_roles = bi_service.normalize_dashboard_access(payload.visibility, payload.shared_roles_json)
    dashboard = Dashboard(
        name=bi_service.resolve_dashboard_name(db, payload.name),
        description=payload.description,
        layout_json=payload.layout_json,
        filters_json=payload.filters_json,
        owner_email=current_user.email,
        visibility=visibility,
        shared_roles_json=shared_roles,
    )
    db.add(dashboard)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A dashboard with this name already exists. Please try again.") from exc
    db.refresh(dashboard)
    widgets = bi_service.replace_dashboard_widgets(db, dashboard, [item.model_dump() for item in payload.widgets])
    return DashboardDetailResponse(dashboard=dashboard, widgets=widgets)


@router.put("/dashboards/{dashboard_id}", response_model=DashboardDetailResponse, dependencies=[Depends(require_roles("admin", "analyst"))])
def update_dashboard(dashboard_id: str, payload: DashboardUpdateRequest, db: Session = Depends(get_db)) -> DashboardDetailResponse:
    dashboard = db.query(Dashboard).filter(Dashboard.id == dashboard_id).one_or_none()
    if dashboard is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    visibility, shared_roles = bi_service.normalize_dashboard_access(payload.visibility, payload.shared_roles_json)
    dashboard.name = bi_service.resolve_dashboard_name(db, payload.name, exclude_id=dashboard_id)
    dashboard.description = payload.description
    dashboard.layout_json = payload.layout_json
    dashboard.filters_json = payload.filters_json
    dashboard.visibility = visibility
    dashboard.shared_roles_json = shared_roles
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A dashboard with this name already exists. Please try again.") from exc
    db.refresh(dashboard)
    widgets = bi_service.replace_dashboard_widgets(db, dashboard, [item.model_dump() for item in payload.widgets])
    return DashboardDetailResponse(dashboard=dashboard, widgets=widgets)


@router.get("/dashboards/{dashboard_id}/export")
def export_dashboard(
    dashboard_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    try:
        dashboard = bi_service.get_visible_dashboard(db, dashboard_id, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    payload = DashboardExportPayload(**bi_service.build_dashboard_export(db, dashboard))
    output = BytesIO(payload.model_dump_json(indent=2).encode("utf-8"))
    safe_name = dashboard.name.strip().lower().replace(" ", "_") or "dashboard"
    return StreamingResponse(
        output,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.dashboard.json"'},
    )


@router.post("/dashboards/import", response_model=DashboardImportResponse, dependencies=[Depends(require_roles("admin", "analyst"))])
def import_dashboard(
    payload: DashboardImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DashboardImportResponse:
    try:
        dashboard, widgets, imported_charts = bi_service.import_dashboard_export(
            db,
            {
                **payload.model_dump(),
                "owner_email": current_user.email,
            },
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid dashboard config: {exc}") from exc
    return DashboardImportResponse(dashboard=dashboard, widgets=widgets, imported_charts=imported_charts)


@router.post("/dashboards/{dashboard_id}/snapshots", response_model=DashboardSnapshotResponse, dependencies=[Depends(require_roles("admin", "analyst"))])
def create_dashboard_snapshot(
    dashboard_id: str,
    payload: DashboardSnapshotRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DashboardSnapshotResponse:
    try:
        dashboard = bi_service.get_visible_dashboard(db, dashboard_id, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    export_payload = bi_service.build_dashboard_export(db, dashboard)
    artifact = bi_service.create_dashboard_snapshot_artifact(dashboard.name, payload.format, export_payload)
    return DashboardSnapshotResponse(
        message=f"Created {payload.format.upper()} snapshot manifest for {dashboard.name}.",
        requested_format=payload.format,
        dashboard_name=dashboard.name,
        artifact_path=artifact["artifact_path"],
        artifact_file_name=artifact["artifact_file_name"],
    )


@router.get("/dashboards/{dashboard_id}", response_model=DashboardDetailResponse)
def get_dashboard(
    dashboard_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DashboardDetailResponse:
    try:
        dashboard = bi_service.get_visible_dashboard(db, dashboard_id, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    widgets = bi_service.list_dashboard_widgets(db, dashboard_id)
    return DashboardDetailResponse(dashboard=dashboard, widgets=widgets)


@router.post("/report-schedules", response_model=ReportScheduleRead, dependencies=[Depends(require_roles("admin", "analyst"))])
def create_report_schedule(payload: ReportScheduleCreateRequest, db: Session = Depends(get_db)) -> ReportScheduleRead:
    data = payload.model_dump()
    data["name"] = bi_service.resolve_report_schedule_name(db, payload.name)
    record = ReportSchedule(**data)
    db.add(record)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A report schedule with this name already exists. Please try again.") from exc
    db.refresh(record)
    return record


@router.get("/report-schedules", response_model=ReportScheduleListResponse)
def list_report_schedules(db: Session = Depends(get_db)) -> ReportScheduleListResponse:
    items = db.query(ReportSchedule).order_by(ReportSchedule.updated_at.desc()).all()
    return ReportScheduleListResponse(items=items)


@router.post("/report-schedules/{schedule_id}/run", response_model=ReportScheduleExecutionResponse, dependencies=[Depends(require_roles("admin", "analyst"))])
def run_report_schedule(schedule_id: str, db: Session = Depends(get_db)) -> ReportScheduleExecutionResponse:
    record = db.query(ReportSchedule).filter(ReportSchedule.id == schedule_id).one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Report schedule not found")
    snapshot = bi_service.execute_report_schedule(db, record)
    db.refresh(record)
    return ReportScheduleExecutionResponse(schedule=record, snapshot=snapshot)


@router.get("/report-snapshots", response_model=ReportSnapshotListResponse)
def list_report_snapshots(db: Session = Depends(get_db)) -> ReportSnapshotListResponse:
    items = bi_service.list_report_snapshots(db)
    return ReportSnapshotListResponse(items=items)


@router.delete("/report-schedules/{schedule_id}", response_model=ApiMessage, dependencies=[Depends(require_roles("admin", "analyst"))])
def delete_report_schedule(schedule_id: str, db: Session = Depends(get_db)) -> ApiMessage:
    record = db.query(ReportSchedule).filter(ReportSchedule.id == schedule_id).one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Report schedule not found")
    db.delete(record)
    db.commit()
    return ApiMessage(message="Report schedule deleted successfully")

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.dependencies import require_roles
from app.db.session import get_db
from app.models.catalog import DeltaTable
from app.schemas.table_lineage import TableLineageResponse
from app.schemas.tables import (
    DeltaTableContractUpdateRequest,
    DeltaTableListResponse,
    DeltaTableMetadataUpdateRequest,
    DeltaTablePreviewResponse,
    DeltaTableRead,
    QualityRunResponse,
    QualitySuiteUpdateRequest,
)
from app.services.catalog_governance_service import catalog_governance_service
from app.services.catalog_lineage_service import catalog_lineage_service
from app.services.catalog_metadata_service import CatalogMetadataService
from app.services.delta_service import DeltaService
from app.services.duckdb_service import DuckDBService
from app.services.data_quality_service import data_quality_service
from app.services.superset_catalog_service import superset_catalog_service


router = APIRouter(prefix="/tables", tags=["tables"])
duckdb_service = DuckDBService()
delta_service = DeltaService()
catalog_metadata_service = CatalogMetadataService()


@router.get("", response_model=DeltaTableListResponse)
def list_tables(db: Session = Depends(get_db)) -> DeltaTableListResponse:
    items = db.query(DeltaTable).order_by(DeltaTable.updated_at.desc()).all()
    payload_items = []
    for item in items:
        enriched = catalog_metadata_service.enrich_table(item)
        lineage = catalog_lineage_service.build_table_lineage(db, item)
        governed = catalog_metadata_service.attach_governance(
            enriched,
            catalog_governance_service.build_score(item, enriched, lineage),
        )
        payload_items.append(DeltaTableRead.model_validate(governed))
    return DeltaTableListResponse(items=payload_items)


@router.get("/{table_id}/preview", response_model=DeltaTablePreviewResponse)
def preview_table(table_id: str, db: Session = Depends(get_db)) -> DeltaTablePreviewResponse:
    table = db.query(DeltaTable).filter(DeltaTable.id == table_id).one_or_none()
    if table is None:
        raise HTTPException(status_code=404, detail="Delta table not found")
    preview = duckdb_service.preview_delta(table)
    enriched_payload = catalog_metadata_service.enrich_table(table)
    lineage = catalog_lineage_service.build_table_lineage(db, table)
    enriched = DeltaTableRead.model_validate(
        catalog_metadata_service.attach_governance(
            enriched_payload,
            catalog_governance_service.build_score(table, enriched_payload, lineage),
        )
    )
    return DeltaTablePreviewResponse(table=enriched, columns=preview["columns"], rows=preview["rows"])


@router.get("/{table_id}/lineage", response_model=TableLineageResponse)
def get_table_lineage(table_id: str, db: Session = Depends(get_db)) -> TableLineageResponse:
    table = db.query(DeltaTable).filter(DeltaTable.id == table_id).one_or_none()
    if table is None:
        raise HTTPException(status_code=404, detail="Delta table not found")
    return TableLineageResponse.model_validate(catalog_lineage_service.build_table_lineage(db, table))


@router.put("/{table_id}/metadata", response_model=DeltaTableRead, dependencies=[Depends(require_roles("admin", "analyst"))])
def update_table_metadata(table_id: str, payload: DeltaTableMetadataUpdateRequest, db: Session = Depends(get_db)) -> DeltaTableRead:
    table = db.query(DeltaTable).filter(DeltaTable.id == table_id).one_or_none()
    if table is None:
        raise HTTPException(status_code=404, detail="Delta table not found")
    enriched = catalog_metadata_service.update_metadata(table, owner=payload.owner, tags=payload.tags, lineage_hint=payload.lineage_hint)
    lineage = catalog_lineage_service.build_table_lineage(db, table)
    governed = catalog_metadata_service.attach_governance(
        enriched,
        catalog_governance_service.build_score(table, enriched, lineage),
    )
    superset_catalog_service.safe_sync(db, reason=f"table_metadata:{table.name}")
    return DeltaTableRead.model_validate(governed)


@router.put("/{table_id}/contract", response_model=DeltaTableRead, dependencies=[Depends(require_roles("admin", "analyst"))])
def update_table_contract(table_id: str, payload: DeltaTableContractUpdateRequest, db: Session = Depends(get_db)) -> DeltaTableRead:
    table = db.query(DeltaTable).filter(DeltaTable.id == table_id).one_or_none()
    if table is None:
        raise HTTPException(status_code=404, detail="Delta table not found")
    enriched = catalog_metadata_service.update_contract(
        table,
        contract_mode=payload.contract_mode,
        allow_additive_columns=payload.contract_allow_additive_columns,
        allow_column_removal=payload.contract_allow_column_removal,
        allow_type_changes=payload.contract_allow_type_changes,
        required_columns=payload.contract_required_columns,
        adopt_current_schema=payload.adopt_current_schema,
    )
    lineage = catalog_lineage_service.build_table_lineage(db, table)
    governed = catalog_metadata_service.attach_governance(
        enriched,
        catalog_governance_service.build_score(table, enriched, lineage),
    )
    return DeltaTableRead.model_validate(governed)


@router.post("/{table_id}/refresh", response_model=DeltaTableRead, dependencies=[Depends(require_roles("admin", "analyst"))])
def refresh_table_metadata(table_id: str, db: Session = Depends(get_db)) -> DeltaTableRead:
    table = db.query(DeltaTable).filter(DeltaTable.id == table_id).one_or_none()
    if table is None:
        raise HTTPException(status_code=404, detail="Delta table not found")
    refreshed = delta_service.refresh_metadata(db, table)
    enriched = catalog_metadata_service.refresh_freshness(refreshed)
    lineage = catalog_lineage_service.build_table_lineage(db, refreshed)
    governed = catalog_metadata_service.attach_governance(
        enriched,
        catalog_governance_service.build_score(refreshed, enriched, lineage),
    )
    return DeltaTableRead.model_validate(governed)


@router.put("/{table_id}/quality-suite", response_model=DeltaTableRead, dependencies=[Depends(require_roles("admin", "analyst"))])
def update_quality_suite(table_id: str, payload: QualitySuiteUpdateRequest, db: Session = Depends(get_db)) -> DeltaTableRead:
    table = db.query(DeltaTable).filter(DeltaTable.id == table_id).one_or_none()
    if table is None:
        raise HTTPException(status_code=404, detail="Delta table not found")
    enriched = catalog_metadata_service.update_quality_suite(
        table,
        name=payload.name,
        expectations=[expectation.model_dump() for expectation in payload.expectations],
    )
    lineage = catalog_lineage_service.build_table_lineage(db, table)
    governed = catalog_metadata_service.attach_governance(
        enriched,
        catalog_governance_service.build_score(table, enriched, lineage),
    )
    return DeltaTableRead.model_validate(governed)


@router.post("/{table_id}/quality-runs", response_model=QualityRunResponse, dependencies=[Depends(require_roles("admin", "analyst"))])
def run_quality_suite(table_id: str, db: Session = Depends(get_db)) -> QualityRunResponse:
    table = db.query(DeltaTable).filter(DeltaTable.id == table_id).one_or_none()
    if table is None:
        raise HTTPException(status_code=404, detail="Delta table not found")
    suite = catalog_metadata_service.get_quality_suite(table)
    result = data_quality_service.run(
        table,
        suite["quality_expectations"],
        suite_name=suite["quality_suite_name"],
    )
    catalog_metadata_service.record_quality_run(table, result)
    return QualityRunResponse.model_validate(result)

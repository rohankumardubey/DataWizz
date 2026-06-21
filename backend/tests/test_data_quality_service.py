from pathlib import Path

import pyarrow as pa
from deltalake import write_deltalake

from app.models.catalog import DeltaTable
from app.services.data_quality_service import DataQualityService


def test_quality_suite_reports_expectation_evidence(tmp_path: Path) -> None:
    table_path = tmp_path / "orders"
    write_deltalake(
        str(table_path),
        pa.table(
            {
                "order_id": [1, 2, 2],
                "status": ["complete", "pending", None],
            }
        ),
        mode="overwrite",
    )
    table = DeltaTable(
        id="orders-table",
        name="orders",
        schema_name="analytics",
        storage_path=str(table_path),
        mode="overwrite",
    )

    result = DataQualityService().run(
        table,
        [
            {
                "id": "has-rows",
                "expectation_type": "row_count_between",
                "enabled": True,
                "severity": "error",
                "min_value": 1,
                "max_value": None,
            },
            {
                "id": "status-required",
                "expectation_type": "not_null",
                "enabled": True,
                "severity": "error",
                "column": "status",
            },
            {
                "id": "order-id-unique",
                "expectation_type": "unique",
                "enabled": True,
                "severity": "warning",
                "column": "order_id",
            },
            {
                "id": "known-status",
                "expectation_type": "accepted_values",
                "enabled": True,
                "severity": "error",
                "column": "status",
                "accepted_values": ["complete", "pending"],
            },
        ],
    )

    assert result["status"] == "failed"
    assert result["row_count"] == 3
    assert result["passed_count"] == 2
    assert result["failed_count"] == 2
    assert result["results"][1]["unexpected_count"] == 1
    assert result["results"][2]["unexpected_count"] == 1

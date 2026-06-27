import pyarrow as pa
from deltalake import write_deltalake
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.main import app
from app.models.catalog import DeltaTable


def _login(client: TestClient, email: str) -> dict[str, str]:
    response = client.post(
        "/api/system/login",
        json={"email": email, "password": "datawizz123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_access_policy_filters_rows_and_masks_columns_for_governed_views() -> None:
    settings = get_settings()
    table_path = settings.curated_storage_path + "/access_policy_orders"
    write_deltalake(
        table_path,
        pa.table(
            {
                "region": ["EMEA", "AMER", "EMEA"],
                "email": ["alice@example.com", "bob@example.com", "cora@example.com"],
                "revenue": [100, 80, 120],
            }
        ),
        mode="overwrite",
    )

    with TestClient(app) as client:
        db = SessionLocal()
        try:
            table = DeltaTable(
                name="access_policy_orders",
                schema_name="analytics",
                storage_path=table_path,
                mode="overwrite",
                schema_json=[
                    {"name": "region", "type": "string"},
                    {"name": "email", "type": "string"},
                    {"name": "revenue", "type": "int64"},
                ],
                row_count=3,
            )
            db.add(table)
            db.commit()
            db.refresh(table)
            table_id = table.id
        finally:
            db.close()

        admin_headers = _login(client, "admin@datawizz.local")
        saved = client.put(
            f"/api/tables/{table_id}/access-policy",
            headers=admin_headers,
            json={
                "access_policy_mode": "enforce",
                "row_filters": [
                    {
                        "role": "all",
                        "expression": "region = 'EMEA'",
                        "enabled": True,
                    }
                ],
                "column_masks": [
                    {
                        "role": "all",
                        "column": "email",
                        "mask_type": "partial",
                        "replacement": "***MASKED***",
                        "enabled": True,
                    }
                ],
            },
        )
        assert saved.status_code == 200
        assert saved.json()["access_policy_mode"] == "enforce"

        viewer_headers = _login(client, "viewer@datawizz.local")
        preview = client.get(f"/api/tables/{table_id}/preview", headers=viewer_headers)
        assert preview.status_code == 200
        preview_payload = preview.json()
        assert preview_payload["columns"] == ["region", "email", "revenue"]
        assert preview_payload["rows"] == [
            {"region": "EMEA", "email": "al…om", "revenue": 100},
            {"region": "EMEA", "email": "co…om", "revenue": 120},
        ]

        analyst_headers = _login(client, "analyst@datawizz.local")
        query = client.post(
            "/api/queries/execute",
            headers=analyst_headers,
            json={
                "sql": "SELECT region, email, revenue FROM access_policy_orders ORDER BY revenue",
                "limit": 20,
            },
        )
        assert query.status_code == 200
        assert query.json()["result"]["rows"] == [
            {"region": "EMEA", "email": "al…om", "revenue": 100},
            {"region": "EMEA", "email": "co…om", "revenue": 120},
        ]

        unsafe = client.put(
            f"/api/tables/{table_id}/access-policy",
            headers=admin_headers,
            json={
                "access_policy_mode": "enforce",
                "row_filters": [{"role": "viewer", "expression": "DROP TABLE access_policy_orders"}],
                "column_masks": [],
            },
        )
        assert unsafe.status_code == 400

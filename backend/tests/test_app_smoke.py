import os
import tempfile
from pathlib import Path


TEST_ROOT = Path(tempfile.mkdtemp(prefix="datawizz-ci-"))
os.environ.update(
    {
        "DATABASE_URL": f"sqlite:///{TEST_ROOT / 'metadata.db'}",
        "RAW_STORAGE_PATH": str(TEST_ROOT / "raw"),
        "CURATED_STORAGE_PATH": str(TEST_ROOT / "curated"),
        "SERVING_STORAGE_PATH": str(TEST_ROOT / "serving"),
        "TEMP_STORAGE_PATH": str(TEST_ROOT / "temp"),
        "SCHEDULER_ENABLED": "false",
    }
)

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def test_health_and_seeded_admin_login() -> None:
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json() == {"status": "ok"}

        login = client.post(
            "/api/system/login",
            json={"email": "admin@datawizz.local", "password": "datawizz123"},
        )
        assert login.status_code == 200
        payload = login.json()
        assert payload["token"]
        assert payload["user"]["role"] == "admin"

        me = client.get(
            "/api/system/me",
            headers={"Authorization": f"Bearer {payload['token']}"},
        )
        assert me.status_code == 200
        assert me.json()["email"] == "admin@datawizz.local"


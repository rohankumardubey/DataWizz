import os
import tempfile
from pathlib import Path


TEST_ROOT = Path(tempfile.mkdtemp(prefix="datawizz-tests-"))
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

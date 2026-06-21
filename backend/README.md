# Backend

FastAPI service for the Internal Lakehouse Platform.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The root `run.sh` launcher uses a machine-local SQLite database at
`${DATAWIZZ_LOCAL_DATABASE_PATH:-${DATAWIZZ_CACHE_DIR:-$HOME/.cache/datawizz}/local/metadata.db}`
for demo mode. Keeping the writable database outside the repository prevents Git
operations and cloud-sync clients from replacing it while FastAPI is running.

Configure environment variables in `.env` if you are not using Docker.

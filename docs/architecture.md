# Internal Lakehouse Platform Architecture

## Goal

The MVP delivers an internal, demo-ready lakehouse platform that combines:

- File ingestion into a raw zone
- SQL querying over files and curated Delta tables with DuckDB
- Delta Lake writes powered by `delta-rs`
- Visual pipeline authoring and manual execution
- Operational metadata persisted in PostgreSQL
- A lightweight BI layer for charts and dashboards

## Architectural Principles

- Clean separation between UI, API, execution engine, and metadata store
- Local-first developer experience with Docker support for demos
- Machine-local SQLite metadata outside the synced repository for safe demo-mode writes
- Open-source execution path that can evolve toward Spark, Flink, Trino, or Airflow later
- Modular services so ingestion, SQL, orchestration, and BI can grow independently

## System Context

```mermaid
flowchart LR
    U["Internal User"] --> FE["React Web App"]
    FE --> API["FastAPI Backend"]
    API --> PG["PostgreSQL Metadata Store"]
    API --> FS["Local Storage Raw / Curated / Temp"]
    API --> DUCK["DuckDB Query Engine"]
    API --> DELTA["delta-rs / Delta Lake"]
    API --> MINIO["MinIO (Optional S3-Compatible Storage)"]
    API --> DAG["Airflow DAG Generator"]
    BI["In-App BI Module"] --> API
    SUPERSET["Optional Apache Superset"] --> PG
    SUPERSET --> FS
```

## Monorepo Layout

```text
frontend/              React + TypeScript + Tailwind + React Flow + Monaco
backend/               FastAPI app, services, metadata models, migrations
docker/                Compose assets and service configs
docs/                  Architecture, API docs, demo instructions
sample_data/           Demo CSV files and sample pipeline JSON
storage/
  raw/                 Uploaded source files
  curated/             Delta Lake tables
  temp/                Temporary query outputs and exports
```

## Backend Modules

### API Layer

- `files`: upload, list, preview, schema inference, delete
- `queries`: execute SQL, persist history, export results
- `tables`: list and preview Delta tables
- `pipelines`: save/load pipelines, validate graph, execute manually
- `runs`: pipeline runs and logs
- `bi`: datasets, charts, dashboards, report schedules
- `system`: dashboard metrics, health, configuration snapshot

### Service Layer

- `StorageService`: file paths, uploads, deletes, storage accounting
- `DuckDBService`: runtime SQL execution and file registration
- `DeltaService`: write/read/list Delta Lake tables
- `PipelineService`: DAG validation, topological execution, logging
- `MetadataService`: shared CRUD helpers for persisted entities
- `BiService`: chart query previews, dashboard persistence
- `AirflowDagService`: Python DAG code generation from pipeline JSON

### Persistence Layer

Metadata lives in PostgreSQL and includes:

- users
- uploaded_files
- delta_tables
- quality_runs
- queries
- pipelines
- pipeline_runs
- job_logs
- semantic_datasets
- charts
- dashboards
- dashboard_widgets
- report_schedules

## Execution Model

### File Querying

1. User uploads CSV, JSON, or Parquet into `storage/raw`
2. Backend stores metadata in PostgreSQL
3. DuckDB registers the raw file as a logical view
4. SQL editor queries raw files or curated Delta tables

### Delta Writes

1. SQL result is materialized as Arrow or pandas
2. Backend writes the result into `storage/curated/<table_name>` using `write_deltalake`
3. Table metadata and schema are stored in PostgreSQL
4. The table becomes queryable in the catalog and SQL workspace

### Pipeline Execution

1. User defines a pipeline graph in the visual builder
2. Pipeline graph is stored as JSON plus normalized metadata
3. Manual execution validates the DAG and computes topological order
4. Each node reads from upstream outputs or source assets
5. Transform nodes compile to DuckDB SQL
6. Write nodes publish Delta tables and persist catalog metadata
7. Logs and statuses are recorded per run

## BI Layer

The in-app BI module is intentionally lightweight in the MVP:

- datasets map to Delta tables or saved SQL
- charts persist configuration and rendering metadata
- dashboards store widget layout and chart references
- chart preview queries execute through DuckDB

Optional Superset integration is documented, but not required for the in-app MVP flow.

## Data Quality

Curated Delta tables can retain reusable expectation-style quality suites in the local catalog metadata registry. The first implementation supports:

- minimum and maximum row-count expectations
- not-null column expectations
- uniqueness expectations for non-null values
- accepted-value expectations
- per-table execution through either the lightweight native DuckDB engine or Great Expectations Core
- persisted latest-run status plus full historical run evidence and unexpected-row percentages
- per-table cron schedules executed by the local scheduler
- post-write pipeline gates with `off`, `warn`, and `block` modes

Checks execute locally against the current Delta snapshot. The native engine evaluates expectations directly with DuckDB; the Great Expectations adapter creates an ephemeral pandas Data Source over the Delta snapshot and returns GX-native evidence. Manual, scheduled, and pipeline-triggered runs use the table's selected engine, persist that engine in `quality_runs`, and emit OpenLineage lifecycle events. A blocking gate fails the pipeline after the Delta write when an error-severity expectation fails; it does not roll back the already-published Delta version.

## Operational Lineage

Pipeline and saved-notebook executions emit OpenLineage 2.x-compatible `RunEvent` payloads:

- `START`, `COMPLETE`, and `FAIL` lifecycle events
- stable DataWizz job namespaces and persisted run IDs
- uploaded-file and Delta-table inputs resolved from pipeline source nodes
- Delta outputs captured from successful pipeline write nodes
- schema facets and a documented DataWizz custom facet
- local JSONL retention under `storage/temp/openlineage/events.jsonl`
- optional failure-isolated HTTP delivery to an external OpenLineage collector

Lineage persistence and transport failures never fail the underlying workload. The in-app Lineage Events page reads the same retained payloads exposed through the system API.

For external delivery, set `OPENLINEAGE_TRANSPORT_URL` to the collector's full ingestion endpoint, for example `http://localhost:5000/api/v1/lineage` for a local Marquez-compatible backend.

## Future-Ready Extension Points

- Spark or DataFusion execution engines behind the query interface
- MinIO-backed object storage paths and credentials
- Airflow API trigger integration
- Transactional quarantine and richer quality remediation actions
- OpenLineage coverage for SQL and report executions
- Trino or Nessie integration for richer lakehouse metadata

## Delivery and Portability Checks

GitHub Actions validates the repository as a clean checkout before changes reach `main`:

- critical source files must exist and be tracked
- relative React/TypeScript imports must resolve
- frontend lint and production build must complete
- FastAPI must compile and pass a temporary-SQLite startup/login smoke test
- core and Superset Docker Compose profiles must parse successfully

The same repository-integrity check is available locally through `./scripts/ci/check-repository.sh`.

## MVP Boundaries

Included in this first version:

- File upload, preview, delete, and schema inference
- SQL execution with DuckDB
- Write query results to Delta Lake
- Delta catalog browsing
- Curated-table quality suites, persisted validation history, cron schedules, and pipeline quality gates
- Visual pipeline builder with manual execution
- Pipeline runs and logs
- OpenLineage-compatible pipeline and notebook lifecycle events
- Basic BI module with datasets, charts, and dashboards
- Docker Compose setup for frontend, backend, PostgreSQL, and MinIO

Deferred but documented as TODOs:

- external Airflow execution
- Flink streaming
- transactional quarantine/remediation for failed quality gates
- production observability and Kubernetes deployment

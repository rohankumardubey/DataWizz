from pydantic import BaseModel


class RecentActivityItem(BaseModel):
    id: str
    kind: str
    title: str
    status: str
    created_at: str


class DashboardMetricsResponse(BaseModel):
    total_files: int
    total_delta_tables: int
    total_pipeline_runs: int
    failed_jobs: int
    storage_usage_bytes: int
    recent_activity: list[RecentActivityItem]


class SettingsSnapshotResponse(BaseModel):
    storage: dict
    execution: dict


class OpenLineageEventListResponse(BaseModel):
    items: list[dict]


class OpenLineageStatusResponse(BaseModel):
    enabled: bool
    namespace: str
    transport_mode: str
    transport_url: str | None = None
    events_path: str
    event_count: int
    delivery_failures: int
    latest_event_at: str | None = None


class SupersetHealthResponse(BaseModel):
    status: str
    reachable: bool
    checked_url: str
    http_status: int | None = None
    detail: str | None = None
    login: dict
    serving_catalog: dict
    auto_connection: dict
    sample_connections: list[dict]
    sample_datasets: list[dict]
    setup: dict


class SupersetEmbedLaunchResponse(BaseModel):
    launch_url: str


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthUserResponse(BaseModel):
    name: str
    email: str
    role: str


class AuthSessionResponse(BaseModel):
    token: str
    user: AuthUserResponse


class GlobalSearchResult(BaseModel):
    id: str
    kind: str
    title: str
    subtitle: str
    route: str
    updated_at: str


class GlobalSearchResponse(BaseModel):
    query: str
    items: list[GlobalSearchResult]

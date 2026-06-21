import json
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import get_settings
from app.models.catalog import DeltaTable


class CatalogMetadataService:
    def __init__(self) -> None:
        settings = get_settings()
        self.metadata_path = Path(settings.temp_storage_path) / "catalog_table_metadata.json"

    def _load_registry(self) -> dict[str, dict]:
        if not self.metadata_path.exists():
            return {}
        try:
            return json.loads(self.metadata_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return {}

    def _save_registry(self, registry: dict[str, dict]) -> None:
        self.metadata_path.parent.mkdir(parents=True, exist_ok=True)
        self.metadata_path.write_text(json.dumps(registry, indent=2), encoding="utf-8")

    def _default_freshness(self, table: DeltaTable) -> str:
        reference = table.last_refreshed_at or table.updated_at or table.created_at
        if reference is None:
            return "unknown"
        if reference.tzinfo is None:
            reference = reference.replace(tzinfo=timezone.utc)
        age_hours = (datetime.now(timezone.utc) - reference).total_seconds() / 3600
        if age_hours <= 24:
            return "fresh"
        if age_hours <= 24 * 7:
            return "aging"
        return "stale"

    def _default_lineage_hint(self, table: DeltaTable) -> str:
        source_query = (table.source_query or "").strip()
        if source_query.startswith("Pipeline "):
            return "Pipeline-authored Delta table"
        if source_query:
            return "SQL workspace authored Delta table"
        return "Curated table with no retained lineage string"

    def _default_contract(self, table: DeltaTable) -> dict:
        schema_json = list(table.schema_json or [])
        required_columns = [field.get("name") for field in schema_json if field.get("name")]
        return {
            "contract_mode": "warn",
            "contract_version": 1,
            "contract_schema_json": schema_json,
            "contract_required_columns": required_columns,
            "contract_allow_additive_columns": True,
            "contract_allow_column_removal": False,
            "contract_allow_type_changes": False,
            "contract_last_check_status": "pass" if schema_json else "untracked",
            "contract_last_check_summary": "Current table schema is being used as the baseline contract." if schema_json else "No contract baseline captured yet.",
            "contract_last_check_issues": [],
            "contract_last_check_at": None,
        }

    def _default_quality_suite(self, table: DeltaTable) -> dict:
        return {
            "quality_suite_name": f"{table.schema_name}.{table.name} baseline",
            "quality_expectations": [
                {
                    "id": "minimum-row-count",
                    "expectation_type": "row_count_between",
                    "enabled": True,
                    "severity": "error",
                    "min_value": 1,
                    "max_value": None,
                }
            ],
            "quality_last_run_status": "untracked",
            "quality_last_run_summary": "Quality suite has not been run yet.",
            "quality_last_run_at": None,
            "quality_last_run_results": [],
            "quality_schedule_cron": None,
            "quality_schedule_enabled": False,
            "quality_schedule_updated_at": None,
        }

    def get_contract(self, table: DeltaTable) -> dict:
        registry = self._load_registry()
        stored = registry.get(table.id, {})
        default_contract = self._default_contract(table)
        contract = {
            "contract_mode": stored.get("contract_mode", default_contract["contract_mode"]),
            "contract_version": stored.get("contract_version", default_contract["contract_version"]),
            "contract_schema_json": stored.get("contract_schema_json", default_contract["contract_schema_json"]),
            "contract_required_columns": stored.get("contract_required_columns", default_contract["contract_required_columns"]),
            "contract_allow_additive_columns": stored.get(
                "contract_allow_additive_columns",
                default_contract["contract_allow_additive_columns"],
            ),
            "contract_allow_column_removal": stored.get(
                "contract_allow_column_removal",
                default_contract["contract_allow_column_removal"],
            ),
            "contract_allow_type_changes": stored.get(
                "contract_allow_type_changes",
                default_contract["contract_allow_type_changes"],
            ),
            "contract_last_check_status": stored.get(
                "contract_last_check_status",
                default_contract["contract_last_check_status"],
            ),
            "contract_last_check_summary": stored.get(
                "contract_last_check_summary",
                default_contract["contract_last_check_summary"],
            ),
            "contract_last_check_issues": stored.get(
                "contract_last_check_issues",
                default_contract["contract_last_check_issues"],
            ),
            "contract_last_check_at": stored.get(
                "contract_last_check_at",
                default_contract["contract_last_check_at"],
            ),
        }
        return contract

    def get_metadata(self, table: DeltaTable) -> dict:
        registry = self._load_registry()
        stored = registry.get(table.id, {})
        default_tags = ["delta", table.schema_name, table.mode]
        tags = stored.get("tags") or default_tags
        payload = {
            "owner": stored.get("owner") or ("analytics_engineering" if table.schema_name == "analytics" else "data_platform"),
            "tags": tags,
            "freshness_status": stored.get("freshness_status") or self._default_freshness(table),
            "lineage_hint": stored.get("lineage_hint") or self._default_lineage_hint(table),
        }
        payload.update(self.get_contract(table))
        payload.update(self.get_quality_suite(table))
        return payload

    def get_quality_suite(self, table: DeltaTable) -> dict:
        registry = self._load_registry()
        stored = registry.get(table.id, {})
        defaults = self._default_quality_suite(table)
        return {
            "quality_suite_name": stored.get("quality_suite_name", defaults["quality_suite_name"]),
            "quality_expectations": stored.get("quality_expectations", defaults["quality_expectations"]),
            "quality_last_run_status": stored.get("quality_last_run_status", defaults["quality_last_run_status"]),
            "quality_last_run_summary": stored.get("quality_last_run_summary", defaults["quality_last_run_summary"]),
            "quality_last_run_at": stored.get("quality_last_run_at", defaults["quality_last_run_at"]),
            "quality_last_run_results": stored.get("quality_last_run_results", defaults["quality_last_run_results"]),
            "quality_schedule_cron": stored.get("quality_schedule_cron", defaults["quality_schedule_cron"]),
            "quality_schedule_enabled": stored.get("quality_schedule_enabled", defaults["quality_schedule_enabled"]),
            "quality_schedule_updated_at": stored.get(
                "quality_schedule_updated_at",
                defaults["quality_schedule_updated_at"],
            ),
        }

    def update_quality_suite(self, table: DeltaTable, *, name: str, expectations: list[dict]) -> dict:
        registry = self._load_registry()
        current = registry.get(table.id, {})
        current["quality_suite_name"] = name.strip() or f"{table.schema_name}.{table.name} baseline"
        current["quality_expectations"] = expectations
        current["quality_last_run_status"] = "untracked"
        current["quality_last_run_summary"] = "Quality suite changed and needs to be run."
        current["quality_last_run_at"] = None
        current["quality_last_run_results"] = []
        registry[table.id] = current
        self._save_registry(registry)
        return self.enrich_table(table)

    def record_quality_run(self, table: DeltaTable, result: dict) -> None:
        registry = self._load_registry()
        current = registry.get(table.id, {})
        current["quality_last_run_status"] = result.get("status", "failed")
        current["quality_last_run_summary"] = result.get("summary", "Quality checks completed.")
        current["quality_last_run_at"] = result.get("run_at") or datetime.now(timezone.utc).isoformat()
        current["quality_last_run_results"] = list(result.get("results") or [])
        registry[table.id] = current
        self._save_registry(registry)

    def update_quality_schedule(self, table: DeltaTable, *, cron: str | None, enabled: bool) -> dict:
        registry = self._load_registry()
        current = registry.get(table.id, {})
        normalized_cron = (cron or "").strip() or None
        current["quality_schedule_cron"] = normalized_cron
        current["quality_schedule_enabled"] = bool(enabled and normalized_cron)
        current["quality_schedule_updated_at"] = datetime.now(timezone.utc).isoformat()
        registry[table.id] = current
        self._save_registry(registry)
        return self.enrich_table(table)

    def enrich_table(self, table: DeltaTable) -> dict:
        payload = {
            "id": table.id,
            "name": table.name,
            "schema_name": table.schema_name,
            "storage_path": table.storage_path,
            "description": table.description,
            "schema_json": table.schema_json,
            "mode": table.mode,
            "source_query": table.source_query,
            "row_count": table.row_count,
            "last_refreshed_at": table.last_refreshed_at,
            "created_at": table.created_at,
            "updated_at": table.updated_at,
        }
        payload.update(self.get_metadata(table))
        return payload

    def attach_governance(self, enriched_table: dict, governance: dict) -> dict:
        payload = dict(enriched_table)
        payload.update(
            {
                "governance_score": governance.get("score"),
                "governance_grade": governance.get("grade"),
                "governance_status": governance.get("status"),
                "governance_summary": governance.get("summary"),
                "governance_strengths": governance.get("strengths", []),
                "governance_gaps": governance.get("gaps", []),
                "governance_breakdown": governance.get("breakdown", []),
            }
        )
        return payload

    def update_metadata(self, table: DeltaTable, *, owner: str | None, tags: list[str] | None, lineage_hint: str | None) -> dict:
        registry = self._load_registry()
        current = registry.get(table.id, {})
        current["owner"] = owner.strip() if owner else current.get("owner")
        current["tags"] = [tag.strip() for tag in (tags or current.get("tags") or []) if tag and tag.strip()]
        current["lineage_hint"] = lineage_hint.strip() if lineage_hint else current.get("lineage_hint")
        current["freshness_status"] = self._default_freshness(table)
        registry[table.id] = current
        self._save_registry(registry)
        return self.enrich_table(table)

    def refresh_freshness(self, table: DeltaTable) -> dict:
        registry = self._load_registry()
        current = registry.get(table.id, {})
        current["freshness_status"] = self._default_freshness(table)
        registry[table.id] = current
        self._save_registry(registry)
        return self.enrich_table(table)

    def ensure_contract(self, table: DeltaTable) -> dict:
        registry = self._load_registry()
        current = registry.get(table.id, {})
        if "contract_mode" not in current:
            current.update(self._default_contract(table))
            registry[table.id] = current
            self._save_registry(registry)
        return self.get_contract(table)

    def update_contract(
        self,
        table: DeltaTable,
        *,
        contract_mode: str,
        allow_additive_columns: bool,
        allow_column_removal: bool,
        allow_type_changes: bool,
        required_columns: list[str] | None,
        adopt_current_schema: bool,
    ) -> dict:
        registry = self._load_registry()
        current = registry.get(table.id, {})
        contract = self.get_contract(table)
        current["contract_mode"] = contract_mode
        current["contract_allow_additive_columns"] = allow_additive_columns
        current["contract_allow_column_removal"] = allow_column_removal
        current["contract_allow_type_changes"] = allow_type_changes
        current["contract_required_columns"] = [column.strip() for column in (required_columns or []) if column and column.strip()]

        if adopt_current_schema or not current.get("contract_schema_json"):
            current["contract_schema_json"] = list(table.schema_json or [])
            current["contract_version"] = int(contract.get("contract_version", 1)) + (1 if contract.get("contract_schema_json") else 0)
            if not current["contract_required_columns"]:
                current["contract_required_columns"] = [
                    field.get("name") for field in (table.schema_json or []) if field.get("name")
                ]
            current["contract_last_check_status"] = "pass"
            current["contract_last_check_summary"] = "Current schema adopted as the active contract baseline."
            current["contract_last_check_issues"] = []
            current["contract_last_check_at"] = datetime.now(timezone.utc).isoformat()
        else:
            current["contract_version"] = int(contract.get("contract_version", 1))

        registry[table.id] = current
        self._save_registry(registry)
        return self.enrich_table(table)

    def evaluate_contract(
        self,
        table: DeltaTable,
        *,
        proposed_schema_json: list[dict],
    ) -> dict:
        contract = self.get_contract(table)
        contract_mode = contract.get("contract_mode") or "warn"
        baseline_schema = list(contract.get("contract_schema_json") or table.schema_json or [])
        required_columns = [column for column in (contract.get("contract_required_columns") or []) if column]
        baseline_by_name = {field.get("name"): str(field.get("type")) for field in baseline_schema if field.get("name")}
        proposed_by_name = {field.get("name"): str(field.get("type")) for field in proposed_schema_json if field.get("name")}

        if contract_mode == "off":
            return {
                "status": "pass",
                "summary": "Schema contract guardrails are disabled for this table.",
                "issues": [],
                "contract_mode": contract_mode,
                "contract_version": contract.get("contract_version", 1),
            }

        issues: list[str] = []
        missing_required = [column for column in required_columns if column not in proposed_by_name]
        removed_columns = [column for column in baseline_by_name if column not in proposed_by_name]
        additive_columns = [column for column in proposed_by_name if column not in baseline_by_name]
        type_changes = [
            f"{column}: {baseline_by_name[column]} -> {proposed_by_name[column]}"
            for column in baseline_by_name
            if column in proposed_by_name and baseline_by_name[column] != proposed_by_name[column]
        ]

        if missing_required:
            issues.append(f"Missing required columns: {', '.join(missing_required)}.")
        if removed_columns and not contract.get("contract_allow_column_removal", False):
            issues.append(f"Removed contract columns: {', '.join(removed_columns)}.")
        if additive_columns and not contract.get("contract_allow_additive_columns", True):
            issues.append(f"Added non-approved columns: {', '.join(additive_columns)}.")
        if type_changes and not contract.get("contract_allow_type_changes", False):
            issues.append(f"Column type changes detected: {'; '.join(type_changes)}.")

        if not issues:
            summary = "Published schema satisfies the active table contract."
            status = "pass"
        elif contract_mode == "strict":
            summary = f"Schema contract blocked this publish. {' '.join(issues)}"
            status = "blocked"
        else:
            summary = f"Schema contract warnings recorded for this publish. {' '.join(issues)}"
            status = "warning"

        return {
            "status": status,
            "summary": summary,
            "issues": issues,
            "contract_mode": contract_mode,
            "contract_version": contract.get("contract_version", 1),
        }

    def record_contract_check(self, table: DeltaTable, result: dict) -> None:
        registry = self._load_registry()
        current = registry.get(table.id, {})
        if "contract_mode" not in current:
            current.update(self._default_contract(table))
        current["contract_last_check_status"] = result.get("status", "pass")
        current["contract_last_check_summary"] = result.get("summary", "Schema contract check completed.")
        current["contract_last_check_issues"] = list(result.get("issues") or [])
        current["contract_last_check_at"] = datetime.now(timezone.utc).isoformat()
        registry[table.id] = current
        self._save_registry(registry)

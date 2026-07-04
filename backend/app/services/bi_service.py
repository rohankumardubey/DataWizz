import json
import re
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from html import escape
from pathlib import Path

import pyarrow.csv as pacsv
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.auth import User
from app.models.bi import Chart, Dashboard, DashboardWidget, MetricAlert, MetricAlertEvent, ReportSchedule, ReportSnapshot, SemanticDataset, SemanticMetric
from app.models.catalog import DeltaTable, UploadedFile
from app.services.duckdb_service import DuckDBService
from app.utils.naming import slugify_identifier


class BiService:
    def __init__(self) -> None:
        self.duckdb_service = DuckDBService()
        self.settings = get_settings()
        self.default_workspace_roles = ["admin", "analyst", "viewer"]

    def normalize_dashboard_access(self, visibility: str | None, shared_roles: list[str] | None) -> tuple[str, list[str]]:
        normalized_visibility = str(visibility or "workspace").strip().lower()
        if normalized_visibility not in {"private", "workspace", "public"}:
            normalized_visibility = "workspace"

        role_values = [str(role).strip().lower() for role in (shared_roles or []) if str(role).strip()]
        deduped_roles = list(dict.fromkeys(role_values))
        allowed_roles = [role for role in deduped_roles if role in {"admin", "analyst", "viewer"}]

        if normalized_visibility == "workspace" and not allowed_roles:
            allowed_roles = list(self.default_workspace_roles)
        if normalized_visibility != "workspace":
            allowed_roles = []

        return normalized_visibility, allowed_roles

    def can_user_view_dashboard(self, current_user: User, dashboard: Dashboard) -> bool:
        role = (current_user.role or "").strip().lower()
        if role == "admin":
            return True

        visibility, shared_roles = self.normalize_dashboard_access(
            getattr(dashboard, "visibility", None),
            getattr(dashboard, "shared_roles_json", None),
        )
        owner_email = (getattr(dashboard, "owner_email", None) or "").strip().lower()
        user_email = (current_user.email or "").strip().lower()

        if owner_email and owner_email == user_email:
            return True
        if visibility == "public":
            return True
        if visibility == "private":
            return False
        return role in shared_roles

    def list_visible_dashboards(self, db: Session, current_user: User) -> list[Dashboard]:
        dashboards = db.query(Dashboard).order_by(Dashboard.updated_at.desc()).all()
        return [dashboard for dashboard in dashboards if self.can_user_view_dashboard(current_user, dashboard)]

    def get_visible_dashboard(self, db: Session, dashboard_id: str, current_user: User) -> Dashboard:
        dashboard = db.query(Dashboard).filter(Dashboard.id == dashboard_id).one_or_none()
        if dashboard is None or not self.can_user_view_dashboard(current_user, dashboard):
            raise ValueError("Dashboard not found")
        return dashboard

    def list_candidate_datasets(self, db: Session) -> list[dict]:
        datasets = []
        for table in db.query(DeltaTable).order_by(DeltaTable.updated_at.desc()).all():
            datasets.append(
                {
                    "id": table.id,
                    "name": table.name,
                    "schema_name": table.schema_name,
                    "source_type": "delta_table",
                    "source_ref": table.name,
                    "description": table.description,
                    "schema_json": table.schema_json,
                    "row_count": table.row_count,
                    "updated_at": table.updated_at.isoformat() if table.updated_at else None,
                }
            )
        return datasets

    def resolve_dataset_name(self, db: Session, desired_name: str, *, exclude_id: str | None = None) -> str:
        base_name = desired_name.strip() or "Untitled Dataset"
        candidate = base_name
        suffix = 2

        while True:
            query = db.query(SemanticDataset).filter(SemanticDataset.name == candidate)
            if exclude_id is not None:
                query = query.filter(SemanticDataset.id != exclude_id)
            if query.one_or_none() is None:
                return candidate
            candidate = f"{base_name} ({suffix})"
            suffix += 1

    def resolve_dashboard_name(self, db: Session, desired_name: str, *, exclude_id: str | None = None) -> str:
        base_name = desired_name.strip() or "Untitled Dashboard"
        candidate = base_name
        suffix = 2

        while True:
            query = db.query(Dashboard).filter(Dashboard.name == candidate)
            if exclude_id is not None:
                query = query.filter(Dashboard.id != exclude_id)
            if query.one_or_none() is None:
                return candidate
            candidate = f"{base_name} ({suffix})"
            suffix += 1

    def resolve_report_schedule_name(self, db: Session, desired_name: str) -> str:
        base_name = desired_name.strip() or "Untitled Report Schedule"
        candidate = base_name
        suffix = 2

        while db.query(ReportSchedule).filter(ReportSchedule.name == candidate).one_or_none() is not None:
            candidate = f"{base_name} ({suffix})"
            suffix += 1

        return candidate

    def resolve_metric_name(self, db: Session, desired_name: str, *, exclude_id: str | None = None) -> str:
        base_name = desired_name.strip() or "Untitled Metric"
        candidate = base_name
        suffix = 2

        while True:
            query = db.query(SemanticMetric).filter(SemanticMetric.name == candidate)
            if exclude_id is not None:
                query = query.filter(SemanticMetric.id != exclude_id)
            if query.one_or_none() is None:
                return candidate
            candidate = f"{base_name} ({suffix})"
            suffix += 1

    def resolve_alert_name(self, db: Session, desired_name: str, *, exclude_id: str | None = None) -> str:
        base_name = desired_name.strip() or "Untitled Metric Alert"
        candidate = base_name
        suffix = 2

        while True:
            query = db.query(MetricAlert).filter(MetricAlert.name == candidate)
            if exclude_id is not None:
                query = query.filter(MetricAlert.id != exclude_id)
            if query.one_or_none() is None:
                return candidate
            candidate = f"{base_name} ({suffix})"
            suffix += 1

    def serialize_metric(self, db: Session, metric: SemanticMetric) -> dict:
        dataset = db.query(SemanticDataset).filter(SemanticDataset.id == metric.dataset_id).one_or_none()
        return {
            "id": metric.id,
            "created_at": metric.created_at,
            "updated_at": metric.updated_at,
            "name": metric.name,
            "label": metric.label,
            "description": metric.description,
            "dataset_id": metric.dataset_id,
            "dataset_name": dataset.name if dataset else None,
            "source_ref": dataset.source_ref if dataset else None,
            "expression": metric.expression,
            "filter_sql": metric.filter_sql,
            "dimensions_json": metric.dimensions_json or [],
            "format": metric.format,
            "owner_email": metric.owner_email,
            "is_certified": metric.is_certified,
        }

    def list_metrics(self, db: Session) -> list[dict]:
        metrics = db.query(SemanticMetric).order_by(SemanticMetric.updated_at.desc()).all()
        return [self.serialize_metric(db, metric) for metric in metrics]

    def serialize_alert(self, db: Session, alert: MetricAlert) -> dict:
        metric = db.query(SemanticMetric).filter(SemanticMetric.id == alert.metric_id).one_or_none()
        dataset = db.query(SemanticDataset).filter(SemanticDataset.id == metric.dataset_id).one_or_none() if metric else None
        return {
            "id": alert.id,
            "created_at": alert.created_at,
            "updated_at": alert.updated_at,
            "name": alert.name,
            "metric_id": alert.metric_id,
            "metric_name": metric.name if metric else None,
            "metric_label": metric.label if metric else None,
            "dataset_name": dataset.name if dataset else None,
            "source_ref": dataset.source_ref if dataset else None,
            "comparison": alert.comparison,
            "threshold_value": alert.threshold_value,
            "severity": alert.severity,
            "enabled": alert.enabled,
            "owner_email": alert.owner_email,
            "notification_channel": alert.notification_channel,
            "destination": alert.destination,
            "last_status": alert.last_status,
            "last_value": alert.last_value,
            "last_message": alert.last_message,
            "last_evaluated_at": alert.last_evaluated_at,
        }

    def serialize_alert_event(self, db: Session, event: MetricAlertEvent) -> dict:
        alert = db.query(MetricAlert).filter(MetricAlert.id == event.alert_id).one_or_none()
        metric = db.query(SemanticMetric).filter(SemanticMetric.id == event.metric_id).one_or_none() if event.metric_id else None
        return {
            "id": event.id,
            "created_at": event.created_at,
            "updated_at": event.updated_at,
            "alert_id": event.alert_id,
            "alert_name": alert.name if alert else None,
            "metric_id": event.metric_id,
            "metric_label": metric.label if metric else None,
            "status": event.status,
            "triggered": event.triggered,
            "observed_value": event.observed_value,
            "threshold_value": event.threshold_value,
            "message": event.message,
            "evaluated_at": event.evaluated_at,
            "details_json": event.details_json,
        }

    def list_alerts(self, db: Session) -> list[dict]:
        alerts = db.query(MetricAlert).order_by(MetricAlert.updated_at.desc()).all()
        return [self.serialize_alert(db, alert) for alert in alerts]

    def list_alert_events(self, db: Session, *, alert_id: str | None = None, limit: int = 50) -> list[dict]:
        query = db.query(MetricAlertEvent)
        if alert_id is not None:
            query = query.filter(MetricAlertEvent.alert_id == alert_id)
        events = query.order_by(MetricAlertEvent.created_at.desc()).limit(max(1, min(limit, 200))).all()
        return [self.serialize_alert_event(db, event) for event in events]

    def evaluate_metric_alert(self, db: Session, alert: MetricAlert) -> MetricAlertEvent:
        evaluated_at = datetime.now(timezone.utc)
        metric = db.query(SemanticMetric).filter(SemanticMetric.id == alert.metric_id).one_or_none()
        status = "error"
        triggered = False
        observed_value: float | None = None
        details: dict | None = None

        if metric is None:
            message = "The linked semantic metric could not be found."
        else:
            try:
                observed_value, sql = self.evaluate_metric_value(db, metric)
                triggered = self._compare_metric_value(observed_value, alert.comparison, alert.threshold_value)
                status = "triggered" if triggered else "ok"
                message = self._metric_alert_message(
                    metric_label=metric.label,
                    observed_value=observed_value,
                    comparison=alert.comparison,
                    threshold=alert.threshold_value,
                    triggered=triggered,
                )
                details = {"sql": sql, "metric_name": metric.name}
            except Exception as exc:  # noqa: BLE001 - alert evaluation records failures instead of hiding them.
                message = f"Metric evaluation failed: {exc}"
                details = {"metric_name": metric.name}

        event = MetricAlertEvent(
            alert_id=alert.id,
            metric_id=metric.id if metric else alert.metric_id,
            status=status,
            triggered=triggered,
            observed_value=observed_value,
            threshold_value=alert.threshold_value,
            message=message,
            evaluated_at=evaluated_at,
            details_json=details,
        )
        db.add(event)

        alert.last_status = status
        alert.last_value = observed_value
        alert.last_message = message
        alert.last_evaluated_at = evaluated_at
        return event

    def evaluate_enabled_metric_alerts(self, db: Session) -> list[MetricAlertEvent]:
        alerts = db.query(MetricAlert).filter(MetricAlert.enabled.is_(True)).order_by(MetricAlert.updated_at.desc()).all()
        return [self.evaluate_metric_alert(db, alert) for alert in alerts]

    def evaluate_metric_value(self, db: Session, metric: SemanticMetric) -> tuple[float, str]:
        dataset = db.query(SemanticDataset).filter(SemanticDataset.id == metric.dataset_id).one_or_none()
        if dataset is None:
            raise ValueError("Metric dataset not found")
        if dataset.source_type != "delta_table":
            raise ValueError("Metric alerts currently support Delta table semantic datasets")

        source_table = db.query(DeltaTable).filter(DeltaTable.name == dataset.source_ref).one_or_none()
        if source_table is None:
            raise ValueError("Metric source Delta table not found")

        expression = self.validate_metric_sql_fragment(metric.expression, "Metric expression")
        metric_filter = self.validate_metric_sql_fragment(metric.filter_sql, "Metric filter") if metric.filter_sql else None
        source_view = self._quote_identifier(slugify_identifier(dataset.source_ref))
        metric_alias = self._quote_identifier("metric_value")
        where_clause = f"WHERE ({metric_filter})" if metric_filter else ""
        sql = f"""
        SELECT {expression} AS {metric_alias}
        FROM {source_view}
        {where_clause}
        LIMIT 1
        """.strip()

        result = self.duckdb_service.execute_query(
            sql,
            uploaded_files=db.query(UploadedFile).all(),
            delta_tables=db.query(DeltaTable).all(),
            limit=None,
        )
        rows = result.get("rows") or []
        if not rows:
            raise ValueError("Metric query returned no rows")
        raw_value = rows[0].get("metric_value")
        if raw_value is None:
            raise ValueError("Metric query returned a null value")
        try:
            return float(raw_value), sql
        except (TypeError, ValueError) as exc:
            raise ValueError("Metric query returned a non-numeric value") from exc

    def _compare_metric_value(self, observed_value: float, comparison: str, threshold: float) -> bool:
        if comparison == "gt":
            return observed_value > threshold
        if comparison == "gte":
            return observed_value >= threshold
        if comparison == "lt":
            return observed_value < threshold
        if comparison == "lte":
            return observed_value <= threshold
        if comparison == "eq":
            return observed_value == threshold
        if comparison == "neq":
            return observed_value != threshold
        raise ValueError("Unsupported alert comparison")

    def _metric_alert_message(self, *, metric_label: str, observed_value: float, comparison: str, threshold: float, triggered: bool) -> str:
        comparison_labels = {
            "gt": ">",
            "gte": ">=",
            "lt": "<",
            "lte": "<=",
            "eq": "=",
            "neq": "!=",
        }
        outcome = "Triggered" if triggered else "OK"
        return f"{outcome}: {metric_label} is {observed_value:g}; rule is {comparison_labels.get(comparison, comparison)} {threshold:g}."

    def generate_chart_from_prompt(self, db: Session, *, prompt: str, dataset_id: str | None = None, limit: int = 12) -> dict:
        cleaned_prompt = " ".join(str(prompt or "").strip().split())
        if not cleaned_prompt:
            raise ValueError("Prompt is required")

        datasets = db.query(SemanticDataset).order_by(SemanticDataset.updated_at.desc()).all()
        if not datasets:
            raise ValueError("No semantic datasets are available for chart generation")

        dataset = self._choose_chart_dataset(db, cleaned_prompt, datasets, dataset_id)
        if dataset.source_type != "delta_table":
            raise ValueError("Natural-language chart generation currently supports Delta-backed semantic datasets")

        schema = dataset.schema_json or []
        metric = self._choose_chart_metric(db, cleaned_prompt, dataset, schema)
        dimension = self._choose_chart_dimension(cleaned_prompt, dataset, schema)
        chart_type = self._choose_chart_type(cleaned_prompt, dimension)
        if chart_type != "kpi" and dimension is None:
            dimension = self._first_dimension(schema)
            if dimension is None:
                chart_type = "kpi"

        safe_limit = limit if isinstance(limit, int) and limit > 0 else 12
        metric_alias = metric["alias"]
        sql = self._build_generated_chart_sql(
            dataset=dataset,
            chart_type=chart_type,
            dimension=dimension,
            metric_expression=metric["expression"],
            metric_alias=metric_alias,
            limit=safe_limit,
        )
        readable_metric = metric["label"].replace("_", " ")
        readable_dimension = (dimension or "").replace("_", " ")
        name = (
            f"{readable_metric} KPI"
            if chart_type == "kpi"
            else f"{readable_metric} by {readable_dimension}".strip()
        ).title()
        confidence = 0.55 + (0.15 if metric["matched"] else 0) + (0.15 if dimension else 0) + (0.1 if dataset_id else 0)
        confidence = min(confidence, 0.95)
        rationale = [
            f"Selected semantic dataset '{dataset.name}' from source '{dataset.source_ref}'.",
            f"Mapped the requested measure to {metric['label']}.",
        ]
        assumptions = []
        if chart_type == "kpi":
            rationale.append("No grouping dimension was required, so a KPI chart was generated.")
        else:
            rationale.append(f"Grouped by '{dimension}' based on the prompt and dataset schema.")
        if not metric["matched"]:
            assumptions.append("No exact metric phrase was found, so the first likely numeric measure was used.")
        if chart_type != "kpi" and not self._prompt_mentions_any(cleaned_prompt, [str(dimension)]):
            assumptions.append("The grouping dimension was inferred from dataset metadata.")

        return {
            "name": name,
            "chart_type": chart_type,
            "dataset_id": dataset.id,
            "dataset_name": dataset.name,
            "source_ref": dataset.source_ref,
            "query_sql": sql,
            "config_json": {
                "chartType": chart_type,
                "datasetName": dataset.name,
                "sourceRef": dataset.source_ref,
                "dimensionKey": None if chart_type == "kpi" else dimension,
                "metricKey": metric["key"],
                "metricAlias": metric_alias,
                "sortBy": "dimension" if chart_type in {"line", "timeseries"} else "value",
                "sortDirection": "asc" if chart_type in {"line", "timeseries"} else "desc",
                "rowLimit": safe_limit,
                "xAxisLabel": None if chart_type == "kpi" else dimension,
                "yAxisLabel": None if chart_type == "kpi" else metric_alias,
                "color": "#0b7285",
                "fillColor": "#d9f0f2",
                "numberFormat": metric.get("format") or self._infer_number_format(cleaned_prompt),
                "showLegend": chart_type in {"pie", "donut"},
                "kpiSubtitle": metric["label"] if chart_type == "kpi" else None,
                "generatedBy": "deterministic_nl_chart_planner",
                "naturalLanguagePrompt": cleaned_prompt,
            },
            "confidence": round(confidence, 2),
            "rationale": rationale,
            "assumptions": assumptions,
        }

    def _choose_chart_dataset(
        self,
        db: Session,
        prompt: str,
        datasets: list[SemanticDataset],
        dataset_id: str | None,
    ) -> SemanticDataset:
        if dataset_id:
            dataset = db.query(SemanticDataset).filter(SemanticDataset.id == dataset_id).one_or_none()
            if dataset is None:
                raise ValueError("Selected semantic dataset was not found")
            return dataset

        scored: list[tuple[int, SemanticDataset]] = []
        lowered = prompt.lower()
        for dataset in datasets:
            haystack_parts = [
                dataset.name,
                dataset.source_ref,
                dataset.description or "",
                " ".join(str(field.get("name", "")) for field in (dataset.schema_json or []) if isinstance(field, dict)),
                " ".join(str(item.get("name", item.get("label", ""))) for item in (dataset.metrics_json or []) if isinstance(item, dict)),
                " ".join(str(item.get("name", item.get("label", ""))) for item in (dataset.dimensions_json or []) if isinstance(item, dict)),
            ]
            haystack = " ".join(haystack_parts).lower()
            score = sum(1 for token in self._prompt_tokens(lowered) if token in haystack)
            scored.append((score, dataset))
        scored.sort(key=lambda item: (item[0], item[1].updated_at), reverse=True)
        return scored[0][1]

    def _choose_chart_metric(self, db: Session, prompt: str, dataset: SemanticDataset, schema: list[dict]) -> dict:
        prompt_lower = prompt.lower()
        registered_metrics = db.query(SemanticMetric).filter(SemanticMetric.dataset_id == dataset.id).order_by(SemanticMetric.updated_at.desc()).all()
        candidates: list[dict] = []
        for metric in registered_metrics:
            candidates.append(
                {
                    "key": f"governed:{metric.id}",
                    "label": metric.label or metric.name,
                    "expression": metric.expression,
                    "alias": self._safe_alias(metric.name),
                    "format": metric.format,
                    "matched": False,
                }
            )
        for metric in dataset.metrics_json or []:
            if isinstance(metric, dict):
                name = str(metric.get("name") or metric.get("label") or "metric_value")
                candidates.append(
                    {
                        "key": f"semantic:{name}",
                        "label": name,
                        "expression": str(metric.get("expression") or self._quote_identifier(name)),
                        "alias": self._safe_alias(name),
                        "format": str(metric.get("format") or self._infer_number_format(prompt)),
                        "matched": False,
                    }
                )

        numeric_fields = [field for field in schema if self._is_numeric_type(str(field.get("type", "")))]
        aggregate = "AVG" if any(word in prompt_lower for word in ["average", "avg", "mean"]) else "COUNT" if any(word in prompt_lower for word in ["count", "number of", "how many"]) else "SUM"
        for field in numeric_fields:
            column = str(field.get("name"))
            candidates.append(
                {
                    "key": f"{aggregate.lower()}:{column}",
                    "label": f"{aggregate.lower()}_{column}",
                    "expression": "COUNT(*)" if aggregate == "COUNT" else f"{aggregate}({self._quote_identifier(column)})",
                    "alias": self._safe_alias(f"{aggregate.lower()}_{column}"),
                    "format": self._infer_number_format(prompt),
                    "matched": False,
                }
            )
        if not candidates:
            candidates.append(
                {
                    "key": "count:rows",
                    "label": "row_count",
                    "expression": "COUNT(*)",
                    "alias": "row_count",
                    "format": "integer",
                    "matched": any(word in prompt_lower for word in ["count", "number", "rows"]),
                }
            )

        best_score = -1
        best = candidates[0]
        for candidate in candidates:
            terms = self._prompt_tokens(str(candidate["label"]).lower())
            score = sum(2 for term in terms if term in prompt_lower)
            if "revenue" in str(candidate["label"]).lower() and any(word in prompt_lower for word in ["sales", "revenue", "money"]):
                score += 2
            if score > best_score:
                best_score = score
                best = candidate
        best["matched"] = best_score > 0
        return best

    def _choose_chart_dimension(self, prompt: str, dataset: SemanticDataset, schema: list[dict]) -> str | None:
        prompt_lower = prompt.lower()
        dimensions = []
        for item in dataset.dimensions_json or []:
            if isinstance(item, dict) and item.get("name"):
                dimensions.append(str(item["name"]))
        dimensions.extend(str(field.get("name")) for field in schema if field.get("name") and not self._is_numeric_type(str(field.get("type", ""))))
        dimensions = list(dict.fromkeys(dimensions))
        if not dimensions:
            return None

        by_match = re.search(r"\bby\s+([a-zA-Z0-9_ ]+)", prompt_lower)
        if by_match:
            requested = by_match.group(1).strip()
            for dimension in dimensions:
                normalized = dimension.replace("_", " ").lower()
                if normalized in requested or requested in normalized:
                    return dimension

        if any(term in prompt_lower for term in ["over time", "trend", "daily", "monthly", "weekly", "date"]):
            temporal = self._first_temporal_dimension(schema, dimensions)
            if temporal:
                return temporal

        for dimension in dimensions:
            normalized = dimension.replace("_", " ").lower()
            if normalized in prompt_lower or any(token in prompt_lower for token in normalized.split()):
                return dimension
        return dimensions[0]

    def _choose_chart_type(self, prompt: str, dimension: str | None) -> str:
        lowered = prompt.lower()
        if any(word in lowered for word in ["kpi", "total", "single number", "scorecard"]) and not any(word in lowered for word in [" by ", "over time", "trend"]):
            return "kpi"
        if any(word in lowered for word in ["over time", "trend", "daily", "monthly", "weekly", "date"]):
            return "timeseries"
        if any(word in lowered for word in ["pie", "share", "split", "distribution"]):
            return "donut"
        if any(word in lowered for word in ["line"]):
            return "line"
        if any(word in lowered for word in ["area"]):
            return "area"
        return "bar" if dimension else "kpi"

    def _build_generated_chart_sql(
        self,
        *,
        dataset: SemanticDataset,
        chart_type: str,
        dimension: str | None,
        metric_expression: str,
        metric_alias: str,
        limit: int,
    ) -> str:
        source = self._quote_identifier(dataset.source_ref)
        alias = self._quote_identifier(metric_alias)
        if chart_type == "kpi":
            return f"SELECT {metric_expression} AS {alias}\nFROM {source}"

        order_by = "1 ASC" if chart_type in {"line", "timeseries"} else "2 DESC"
        return (
            f"SELECT {self._quote_identifier(str(dimension))} AS \"dimension\", {metric_expression} AS {alias}\n"
            f"FROM {source}\n"
            "GROUP BY 1\n"
            f"ORDER BY {order_by}\n"
            f"LIMIT {limit}"
        )

    def _prompt_tokens(self, value: str) -> list[str]:
        return [token for token in re.split(r"[^a-zA-Z0-9_]+", value.lower()) if len(token) >= 3]

    def _prompt_mentions_any(self, prompt: str, values: list[str]) -> bool:
        lowered = prompt.lower()
        return any(value and value.replace("_", " ").lower() in lowered for value in values)

    def _is_numeric_type(self, type_name: str) -> bool:
        return bool(re.search(r"(int|float|double|decimal|bigint|numeric|real)", type_name.lower()))

    def _first_dimension(self, schema: list[dict]) -> str | None:
        for field in schema:
            if field.get("name") and not self._is_numeric_type(str(field.get("type", ""))):
                return str(field["name"])
        return None

    def _first_temporal_dimension(self, schema: list[dict], dimensions: list[str]) -> str | None:
        for field in schema:
            name = str(field.get("name") or "")
            type_name = str(field.get("type") or "")
            if name in dimensions and (re.search(r"(date|time|timestamp)", type_name.lower()) or re.search(r"(date|time|month|year|day)", name.lower())):
                return name
        return None

    def _safe_alias(self, value: str) -> str:
        alias = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value).strip().lower()).strip("_")
        return alias or "metric_value"

    def _infer_number_format(self, prompt: str) -> str:
        lowered = prompt.lower()
        if any(word in lowered for word in ["revenue", "sales", "cost", "profit", "amount", "currency", "price"]):
            return "currency"
        if any(word in lowered for word in ["percent", "percentage", "rate", "ratio"]):
            return "percent"
        if any(word in lowered for word in ["count", "number of", "how many"]):
            return "integer"
        return "number"

    def build_metric_preview(self, db: Session, metric: SemanticMetric, *, dimensions: list[str], where_sql: str | None, limit: int) -> dict:
        dataset = db.query(SemanticDataset).filter(SemanticDataset.id == metric.dataset_id).one_or_none()
        if dataset is None:
            raise ValueError("Metric dataset not found")
        if dataset.source_type != "delta_table":
            raise ValueError("Metric previews currently support Delta table semantic datasets")

        source_table = db.query(DeltaTable).filter(DeltaTable.name == dataset.source_ref).one_or_none()
        if source_table is None:
            raise ValueError("Metric source Delta table not found")

        expression = self.validate_metric_sql_fragment(metric.expression, "Metric expression")
        metric_filter = self.validate_metric_sql_fragment(metric.filter_sql, "Metric filter") if metric.filter_sql else None
        request_filter = self.validate_metric_sql_fragment(where_sql, "Preview filter") if where_sql else None
        selected_dimensions = dimensions or (metric.dimensions_json or [])
        safe_dimensions = self.validate_metric_dimensions(dataset, selected_dimensions)

        source_view = self._quote_identifier(slugify_identifier(dataset.source_ref))
        metric_alias = self._quote_identifier("metric_value")
        select_parts = [self._quote_identifier(dimension) for dimension in safe_dimensions]
        select_parts.append(f"{expression} AS {metric_alias}")

        where_parts = [part for part in [metric_filter, request_filter] if part]
        where_clause = f"WHERE {' AND '.join(f'({part})' for part in where_parts)}" if where_parts else ""
        group_clause = f"GROUP BY {', '.join(str(index) for index in range(1, len(safe_dimensions) + 1))}" if safe_dimensions else ""
        order_clause = f"ORDER BY {metric_alias} DESC" if safe_dimensions else ""

        sql = f"""
        SELECT {', '.join(select_parts)}
        FROM {source_view}
        {where_clause}
        {group_clause}
        {order_clause}
        LIMIT {limit}
        """.strip()

        result = self.duckdb_service.execute_query(
            sql,
            uploaded_files=db.query(UploadedFile).all(),
            delta_tables=db.query(DeltaTable).all(),
            limit=None,
        )
        return {
            "metric": self.serialize_metric(db, metric),
            "sql": sql,
            "columns": result["columns"],
            "rows": result["rows"],
            "row_count": result["row_count"],
        }

    def _quote_identifier(self, value: str) -> str:
        return f'"{value.replace(chr(34), chr(34) * 2)}"'

    def validate_metric_sql_fragment(self, value: str | None, label: str) -> str:
        fragment = str(value or "").strip().rstrip(";")
        if not fragment:
            raise ValueError(f"{label} cannot be empty")
        lowered = fragment.lower()
        if any(token in lowered for token in [";", "--", "/*", "*/"]):
            raise ValueError(f"{label} cannot contain SQL statement separators or comments")
        if re.search(r"\b(alter|attach|copy|create|delete|detach|drop|insert|install|load|pragma|update)\b", lowered):
            raise ValueError(f"{label} can only contain a read-only SQL expression")
        return fragment

    def validate_metric_dimensions(self, dataset: SemanticDataset, dimensions: list[str]) -> list[str]:
        schema_columns = {str(column.get("name")) for column in (dataset.schema_json or []) if isinstance(column, dict) and column.get("name")}
        valid_dimensions = []
        for raw_dimension in dimensions:
            dimension = str(raw_dimension).strip()
            if not dimension:
                continue
            if dimension not in schema_columns:
                raise ValueError(f"Dimension '{dimension}' is not part of dataset {dataset.name}")
            valid_dimensions.append(dimension)
        return list(dict.fromkeys(valid_dimensions))

    def list_report_snapshots(self, db: Session, schedule_id: str | None = None) -> list[ReportSnapshot]:
        query = db.query(ReportSnapshot)
        if schedule_id is not None:
            query = query.filter(ReportSnapshot.schedule_id == schedule_id)
        return query.order_by(ReportSnapshot.created_at.desc()).all()

    def preview_delta_source(self, db: Session, *, table_id: str | None = None, table_name: str | None = None, limit: int = 20) -> dict:
        query = db.query(DeltaTable)
        if table_id is not None:
            table = query.filter(DeltaTable.id == table_id).one_or_none()
        else:
            table = query.filter(DeltaTable.name == table_name).one_or_none()
        if table is None:
            raise ValueError("Delta table not found for dataset preview")

        preview = self.duckdb_service.preview_delta(table, limit=limit)
        return {
            "columns": preview["columns"],
            "rows": preview["rows"],
            "row_count": preview["row_count"],
            "schema_json": preview["schema"],
        }

    def preview_notebook_snapshot_source(self, dataset: SemanticDataset, limit: int = 50) -> dict:
        config = dataset.source_config_json or {}
        rows = config.get("snapshot_rows") if isinstance(config, dict) else []
        columns = config.get("snapshot_columns") if isinstance(config, dict) else []
        schema_json = config.get("snapshot_schema") if isinstance(config, dict) else []

        safe_rows = rows if isinstance(rows, list) else []
        safe_columns = [str(item) for item in columns] if isinstance(columns, list) else []
        safe_schema = schema_json if isinstance(schema_json, list) else (dataset.schema_json or [])

        return {
            "columns": safe_columns,
            "rows": safe_rows[:limit],
            "row_count": len(safe_rows),
            "schema_json": safe_schema,
        }

    def preview_chart(self, db: Session, sql: str, limit: int = 200, access_context: dict | None = None) -> dict:
        result = self.duckdb_service.execute_query(
            sql,
            uploaded_files=db.query(UploadedFile).all(),
            delta_tables=db.query(DeltaTable).all(),
            limit=limit,
            access_context=access_context,
        )
        return {
            "columns": result["columns"],
            "rows": result["rows"],
            "row_count": result["row_count"],
        }

    def get_chart_traceability(self, db: Session, chart_id: str) -> dict:
        chart = db.query(Chart).filter(Chart.id == chart_id).one_or_none()
        if chart is None:
            raise ValueError("Chart not found")

        widgets = db.query(DashboardWidget).filter(DashboardWidget.chart_id == chart_id).order_by(DashboardWidget.created_at.asc()).all()
        dashboards = []
        dashboard_ids: list[str] = []
        for widget in widgets:
            dashboard = db.query(Dashboard).filter(Dashboard.id == widget.dashboard_id).one_or_none()
            if dashboard is None:
                continue
            dashboard_ids.append(dashboard.id)
            dashboards.append(
                {
                    "dashboard_id": dashboard.id,
                    "dashboard_name": dashboard.name,
                    "dashboard_description": dashboard.description,
                    "widget_id": widget.id,
                    "widget_title": widget.title,
                    "widget_type": widget.widget_type,
                    "updated_at": dashboard.updated_at.isoformat(),
                }
            )

        unique_dashboard_ids = list(dict.fromkeys(dashboard_ids))
        schedules = []
        if unique_dashboard_ids:
            for schedule in (
                db.query(ReportSchedule)
                .filter(ReportSchedule.dashboard_id.in_(unique_dashboard_ids))
                .order_by(ReportSchedule.updated_at.desc())
                .all()
            ):
                dashboard = next((item for item in dashboards if item["dashboard_id"] == schedule.dashboard_id), None)
                schedules.append(
                    {
                        "schedule_id": schedule.id,
                        "schedule_name": schedule.name,
                        "dashboard_id": schedule.dashboard_id,
                        "dashboard_name": dashboard["dashboard_name"] if dashboard else None,
                        "frequency": schedule.frequency,
                        "destination": schedule.destination,
                        "updated_at": schedule.updated_at.isoformat(),
                    }
                )

        return {
            "chart": chart,
            "widget_count": len(widgets),
            "dashboard_count": len(unique_dashboard_ids),
            "report_schedule_count": len(schedules),
            "dashboards": dashboards,
            "report_schedules": schedules,
        }

    def list_dashboard_widgets(self, db: Session, dashboard_id: str) -> list[DashboardWidget]:
        return db.query(DashboardWidget).filter(DashboardWidget.dashboard_id == dashboard_id).order_by(DashboardWidget.created_at.asc()).all()

    def build_dashboard_export(self, db: Session, dashboard: Dashboard) -> dict:
        widgets = self.list_dashboard_widgets(db, dashboard.id)
        chart_ids = [widget.chart_id for widget in widgets if widget.chart_id]
        charts = (
            db.query(Chart).filter(Chart.id.in_(chart_ids)).all()
            if chart_ids
            else []
        )
        chart_map = {chart.id: chart for chart in charts}

        return {
            "version": "1.0",
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "dashboard": {
                "name": dashboard.name,
                "description": dashboard.description,
                "layout_json": dashboard.layout_json or {},
                "filters_json": dashboard.filters_json or [],
                "visibility": self.normalize_dashboard_access(dashboard.visibility, dashboard.shared_roles_json)[0],
                "shared_roles_json": self.normalize_dashboard_access(dashboard.visibility, dashboard.shared_roles_json)[1],
            },
            "widgets": [
                {
                    "widget_type": widget.widget_type,
                    "title": widget.title,
                    "layout_json": widget.layout_json,
                    "config_json": widget.config_json or {},
                    "chart_source_id": widget.chart_id,
                }
                for widget in widgets
            ],
            "charts": [
                {
                    "source_chart_id": chart.id,
                    "name": chart.name,
                    "chart_type": chart.chart_type,
                    "dataset_id": chart.dataset_id if chart.dataset_id and db.query(SemanticDataset).filter(SemanticDataset.id == chart.dataset_id).one_or_none() else None,
                    "query_sql": chart.query_sql,
                    "config_json": chart.config_json or {},
                }
                for chart in charts
                if chart.id in chart_map
            ],
        }

    def import_dashboard_export(self, db: Session, payload: dict) -> tuple[Dashboard, list[DashboardWidget], list[Chart]]:
        config = payload["config"]
        imported_charts: list[Chart] = []
        chart_id_map: dict[str, str] = {}

        for chart_payload in config.get("charts", []):
            dataset_id = chart_payload.get("dataset_id")
            if dataset_id and db.query(SemanticDataset).filter(SemanticDataset.id == dataset_id).one_or_none() is None:
                dataset_id = None

            record = Chart(
                name=chart_payload["name"],
                chart_type=chart_payload["chart_type"],
                dataset_id=dataset_id,
                query_sql=chart_payload["query_sql"],
                config_json=chart_payload.get("config_json", {}),
            )
            db.add(record)
            db.flush()
            imported_charts.append(record)
            chart_id_map[str(chart_payload["source_chart_id"])] = record.id

        dashboard_payload = config["dashboard"]
        dashboard = Dashboard(
            name=self.resolve_dashboard_name(db, dashboard_payload["name"]),
            description=dashboard_payload.get("description"),
            layout_json=dashboard_payload.get("layout_json", {}),
            filters_json=dashboard_payload.get("filters_json"),
            owner_email=payload.get("owner_email"),
            visibility=self.normalize_dashboard_access(
                dashboard_payload.get("visibility"),
                dashboard_payload.get("shared_roles_json"),
            )[0],
            shared_roles_json=self.normalize_dashboard_access(
                dashboard_payload.get("visibility"),
                dashboard_payload.get("shared_roles_json"),
            )[1],
        )
        db.add(dashboard)
        db.commit()
        db.refresh(dashboard)

        widgets = self.replace_dashboard_widgets(
            db,
            dashboard,
            [
                {
                    "chart_id": chart_id_map.get(str(widget.get("chart_source_id"))) if widget.get("chart_source_id") else None,
                    "widget_type": widget["widget_type"],
                    "title": widget["title"],
                    "layout_json": widget.get("layout_json", {}),
                    "config_json": widget.get("config_json", {}),
                }
                for widget in config.get("widgets", [])
            ],
        )
        return dashboard, widgets, imported_charts

    def create_dashboard_snapshot_artifact(self, dashboard_name: str, requested_format: str, export_payload: dict) -> dict:
        exports_dir = Path(self.settings.temp_storage_path) / "dashboard_exports"
        exports_dir.mkdir(parents=True, exist_ok=True)
        safe_name = dashboard_name.strip().lower().replace(" ", "_") or "dashboard"
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        file_name = f"{safe_name}_{timestamp}.{requested_format}.mock.json"
        target = exports_dir / file_name
        target.write_text(
            json.dumps(
                {
                    "kind": "dashboard_snapshot_mock",
                    "requested_format": requested_format,
                    "dashboard_name": dashboard_name,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "note": "This is a demo snapshot manifest. A real renderer can later replace this with an actual PDF or PNG artifact.",
                    "dashboard_export": export_payload,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        return {
            "artifact_path": str(target),
            "artifact_file_name": file_name,
        }

    def execute_report_schedule(self, db: Session, schedule: ReportSchedule) -> ReportSnapshot:
        requested_format = str(schedule.config_json.get("format", "pdf"))
        dashboard = db.query(Dashboard).filter(Dashboard.id == schedule.dashboard_id).one_or_none() if schedule.dashboard_id else None
        snapshot = ReportSnapshot(
            schedule_id=schedule.id,
            dashboard_id=schedule.dashboard_id,
            schedule_name=schedule.name,
            dashboard_name=dashboard.name if dashboard else None,
            requested_format=requested_format,
            destination=schedule.destination,
            status="running",
            started_at=datetime.now(timezone.utc),
            summary_json={"delivery_note": schedule.config_json.get("deliveryNote")},
        )
        db.add(snapshot)
        db.commit()
        db.refresh(snapshot)

        try:
            if dashboard is None:
                raise ValueError("The linked dashboard could not be found for this schedule.")

            export_payload = self.build_dashboard_export(db, dashboard)
            artifact = self._generate_report_schedule_artifact(
                db=db,
                schedule=schedule,
                dashboard=dashboard,
                snapshot=snapshot,
                requested_format=requested_format,
                export_payload=export_payload,
            )
            finished_at = datetime.now(timezone.utc)
            snapshot.status = "success"
            snapshot.finished_at = finished_at
            snapshot.artifact_path = artifact["artifact_path"]
            snapshot.artifact_file_name = artifact["artifact_file_name"]
            snapshot.artifact_kind = artifact["artifact_kind"]
            snapshot.summary_json = {
                "delivery_note": schedule.config_json.get("deliveryNote"),
                "requested_format": requested_format,
                "artifact_kind": artifact["artifact_kind"],
                "chart_exports": artifact.get("chart_exports", []),
            }
            schedule.config_json = {
                **schedule.config_json,
                "lastRunAt": finished_at.isoformat(),
                "lastRunStatus": "success",
                "lastSnapshotId": snapshot.id,
                "lastArtifactPath": artifact["artifact_path"],
            }
            db.commit()
            db.refresh(snapshot)
            db.refresh(schedule)
            return snapshot
        except Exception as exc:
            finished_at = datetime.now(timezone.utc)
            snapshot.status = "failed"
            snapshot.finished_at = finished_at
            snapshot.error_message = str(exc)
            snapshot.summary_json = {
                "delivery_note": schedule.config_json.get("deliveryNote"),
                "requested_format": requested_format,
            }
            schedule.config_json = {
                **schedule.config_json,
                "lastRunAt": finished_at.isoformat(),
                "lastRunStatus": "failed",
                "lastError": str(exc),
                "lastSnapshotId": snapshot.id,
            }
            db.commit()
            db.refresh(snapshot)
            db.refresh(schedule)
            return snapshot

    def _generate_report_schedule_artifact(
        self,
        db: Session,
        schedule: ReportSchedule,
        dashboard: Dashboard,
        snapshot: ReportSnapshot,
        requested_format: str,
        export_payload: dict,
    ) -> dict:
        base_dir = Path(self.settings.temp_storage_path) / "report_snapshots"
        base_dir.mkdir(parents=True, exist_ok=True)
        safe_name = schedule.name.strip().lower().replace(" ", "_") or "report_schedule"
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        run_dir = base_dir / f"{safe_name}_{timestamp}"
        run_dir.mkdir(parents=True, exist_ok=True)

        chart_exports = []
        for chart_payload in export_payload.get("charts", []):
            result = self.duckdb_service.execute_query(
                chart_payload["query_sql"],
                uploaded_files=db.query(UploadedFile).all(),
                delta_tables=db.query(DeltaTable).all(),
                limit=None,
            )
            chart_exports.append(
                {
                    "chart_name": chart_payload["name"],
                    "chart_type": chart_payload["chart_type"],
                    "columns": result["columns"],
                    "rows": result["rows"],
                    "arrow_table": result["arrow_table"],
                }
            )

        (run_dir / "dashboard_export.json").write_text(json.dumps(export_payload, indent=2), encoding="utf-8")

        if requested_format in {"csv", "excel"}:
            bundle_name = f"{safe_name}_{timestamp}.{requested_format}_bundle.zip"
            bundle_path = run_dir / bundle_name
            with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("dashboard_export.json", json.dumps(export_payload, indent=2))
                archive.writestr(
                    "manifest.json",
                    json.dumps(
                        {
                            "schedule_name": schedule.name,
                            "dashboard_name": dashboard.name,
                            "requested_format": requested_format,
                            "generated_at": datetime.now(timezone.utc).isoformat(),
                            "note": "Excel exports are delivered as a zipped CSV bundle in this MVP build.",
                        },
                        indent=2,
                    ),
                )
                for index, chart_export in enumerate(chart_exports, start=1):
                    output = BytesIO()
                    pacsv.write_csv(chart_export["arrow_table"], output)
                    output.seek(0)
                    chart_slug = chart_export["chart_name"].strip().lower().replace(" ", "_") or f"chart_{index}"
                    archive.writestr(f"{index:02d}_{chart_slug}.csv", output.read())
            return {
                "artifact_path": str(bundle_path),
                "artifact_file_name": bundle_name,
                "artifact_kind": "zip_csv_bundle",
                "chart_exports": [{"chart_name": item["chart_name"], "row_count": len(item["rows"])} for item in chart_exports],
            }

        html_name = f"{safe_name}_{timestamp}.{requested_format}_report.html"
        html_path = run_dir / html_name
        html_path.write_text(self._build_html_report(schedule, dashboard, snapshot, export_payload, chart_exports, requested_format), encoding="utf-8")
        return {
            "artifact_path": str(html_path),
            "artifact_file_name": html_name,
            "artifact_kind": "html_report",
            "chart_exports": [{"chart_name": item["chart_name"], "row_count": len(item["rows"])} for item in chart_exports],
        }

    def _build_html_report(
        self,
        schedule: ReportSchedule,
        dashboard: Dashboard,
        snapshot: ReportSnapshot,
        export_payload: dict,
        chart_exports: list[dict],
        requested_format: str,
    ) -> str:
        sections = []
        for chart_export in chart_exports:
            headers = "".join(f"<th>{escape(str(column))}</th>" for column in chart_export["columns"])
            rows = "".join(
                "<tr>" + "".join(f"<td>{escape(str(value))}</td>" for value in row.values()) + "</tr>"
                for row in chart_export["rows"][:50]
            )
            sections.append(
                f"""
                <section style="margin-top:32px;">
                  <h2 style="font-size:20px;margin-bottom:8px;">{escape(chart_export['chart_name'])}</h2>
                  <p style="color:#475569;font-size:14px;">{escape(chart_export['chart_type'])} • {len(chart_export['rows'])} rows exported</p>
                  <div style="overflow:auto;border:1px solid #e2e8f0;border-radius:12px;margin-top:12px;">
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                      <thead style="background:#f8fafc;"><tr>{headers}</tr></thead>
                      <tbody>{rows}</tbody>
                    </table>
                  </div>
                </section>
                """
            )

        return f"""
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>{escape(schedule.name)} export</title>
          </head>
          <body style="font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:32px;">
            <div style="max-width:1200px;margin:0 auto;background:white;border:1px solid #e2e8f0;border-radius:24px;padding:32px;">
              <p style="font-size:12px;letter-spacing:0.24em;text-transform:uppercase;color:#64748b;">Scheduled Report Snapshot</p>
              <h1 style="font-size:36px;margin:12px 0 8px 0;">{escape(dashboard.name)}</h1>
              <p style="font-size:16px;color:#475569;line-height:1.6;">{escape(dashboard.description or 'No dashboard description provided.')}</p>
              <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:24px;">
                <div style="background:#f8fafc;border-radius:16px;padding:16px;"><strong>Requested Format</strong><div style="margin-top:8px;">{escape(requested_format)}</div></div>
                <div style="background:#f8fafc;border-radius:16px;padding:16px;"><strong>Generated At</strong><div style="margin-top:8px;">{escape(snapshot.started_at.isoformat() if snapshot.started_at else datetime.now(timezone.utc).isoformat())}</div></div>
                <div style="background:#f8fafc;border-radius:16px;padding:16px;"><strong>Delivery Note</strong><div style="margin-top:8px;">{escape(str(schedule.config_json.get('deliveryNote', 'None')))}</div></div>
              </div>
              <div style="margin-top:24px;padding:16px;border-radius:16px;background:#ecfeff;color:#155e75;">
                This MVP report export produces an HTML report artifact for requested {escape(requested_format).upper()} output so the schedule generates a usable stored file without needing a separate PDF/PNG renderer.
              </div>
              {''.join(sections)}
            </div>
          </body>
        </html>
        """

    def replace_dashboard_widgets(self, db: Session, dashboard: Dashboard, widgets: list[dict]) -> list[DashboardWidget]:
        db.query(DashboardWidget).filter(DashboardWidget.dashboard_id == dashboard.id).delete()
        db.commit()
        created: list[DashboardWidget] = []
        for widget in widgets:
            record = DashboardWidget(
                dashboard_id=dashboard.id,
                chart_id=widget.get("chart_id"),
                widget_type=widget["widget_type"],
                title=widget["title"],
                layout_json=widget["layout_json"],
                config_json=widget.get("config_json", {}),
            )
            db.add(record)
            created.append(record)
        db.commit()
        for widget in created:
            db.refresh(widget)
        return created

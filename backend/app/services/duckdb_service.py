from pathlib import Path
from time import perf_counter

import duckdb
import pyarrow as pa
from deltalake import DeltaTable
from fastapi.encoders import jsonable_encoder

from app.models.catalog import DeltaTable as DeltaTableModel
from app.models.catalog import UploadedFile
from app.services.catalog_access_policy_service import catalog_access_policy_service
from app.utils.naming import slugify_identifier


class DuckDBService:
    def _normalize_rows(self, rows: list[dict]) -> list[dict]:
        return jsonable_encoder(rows)

    def _quote_identifier(self, value: str) -> str:
        return f'"{value.replace(chr(34), chr(34) * 2)}"'

    def _type_family(self, type_name: str) -> str:
        normalized = type_name.lower()
        if any(token in normalized for token in ["int", "decimal", "double", "float", "real", "numeric", "hugeint"]):
            return "numeric"
        if any(token in normalized for token in ["date", "time", "timestamp"]):
            return "temporal"
        if "bool" in normalized:
            return "boolean"
        if any(token in normalized for token in ["char", "text", "string", "varchar", "uuid"]):
            return "string"
        return "other"

    def _build_quality_indicators(
        self,
        *,
        row_count: int,
        null_count: int,
        distinct_count: int,
        blank_count: int = 0,
    ) -> list[str]:
        indicators: list[str] = []
        if row_count <= 0:
            return ["empty sample"]
        if null_count == 0:
            indicators.append("complete")
        elif null_count / row_count >= 0.5:
            indicators.append("high missing values")
        else:
            indicators.append("has missing values")
        if blank_count > 0:
            indicators.append("blank strings")
        if distinct_count <= 1:
            indicators.append("constant values")
        elif distinct_count == row_count and row_count > 1:
            indicators.append("high cardinality")
        return indicators

    def _cardinality_band(self, *, row_count: int, distinct_count: int) -> str:
        if row_count <= 0 or distinct_count <= 0:
            return "empty"
        if distinct_count <= 1:
            return "constant"
        if distinct_count == row_count and row_count > 1:
            return "unique"
        ratio = distinct_count / row_count
        if ratio < 0.1:
            return "low"
        if ratio < 0.5:
            return "medium"
            return "high"

    def _looks_like_identifier(self, column_name: str) -> bool:
        normalized = column_name.lower()
        return normalized == "id" or normalized.endswith("_id") or normalized.endswith("id") or "key" in normalized or normalized.endswith("_code")

    def _looks_like_time_column(self, column_name: str) -> bool:
        normalized = column_name.lower()
        return any(token in normalized for token in ["date", "time", "timestamp", "_ts", "_dt", "created_at", "updated_at"])

    def _build_profile_recommendations(self, column_profiles: list[dict], profile_summary: dict) -> dict:
        join_keys: list[dict] = []
        dimensions: list[dict] = []
        metrics: list[dict] = []
        time_columns: list[dict] = []
        quality_actions: list[str] = []

        for profile in column_profiles:
            family = profile["profile_kind"]
            column_name = profile["name"]
            completeness_ratio = float(profile["completeness_ratio"] or 0.0)
            uniqueness_ratio = float(profile["uniqueness_ratio"] or 0.0)
            distinct_count = int(profile["distinct_count"] or 0)
            cardinality_band = profile["cardinality_band"]
            blank_count = int(profile["blank_count"] or 0)
            null_count = int(profile["null_count"] or 0)
            stddev_value = profile["stddev_value"]
            reasons: list[str] = []

            if family in {"string", "other"} and self._looks_like_identifier(column_name) and uniqueness_ratio >= 85 and completeness_ratio >= 90:
                reasons = [
                    "column name suggests an identifier",
                    f"{uniqueness_ratio:.1f}% of non-null values are distinct",
                    f"{completeness_ratio:.1f}% completeness makes it stable for joins",
                ]
                join_keys.append(
                    {
                        "column": column_name,
                        "label": "Likely join key",
                        "confidence": "high" if uniqueness_ratio >= 97 and null_count == 0 else "medium",
                        "reasons": reasons,
                    }
                )
            elif family == "numeric" and self._looks_like_identifier(column_name) and uniqueness_ratio >= 95 and completeness_ratio >= 95:
                join_keys.append(
                    {
                        "column": column_name,
                        "label": "Possible numeric key",
                        "confidence": "medium",
                        "reasons": [
                            "numeric field behaves like an identifier",
                            f"{uniqueness_ratio:.1f}% of non-null values are distinct",
                            f"{completeness_ratio:.1f}% completeness supports relational joins",
                        ],
                    }
                )

            if family in {"temporal"} or self._looks_like_time_column(column_name):
                time_columns.append(
                    {
                        "column": column_name,
                        "label": "Time axis candidate",
                        "confidence": "high" if family == "temporal" else "medium",
                        "reasons": [
                            "column type or name indicates a date/time field",
                            f"{completeness_ratio:.1f}% completeness supports trend analysis",
                            f"observed range spans {profile['min_value'] or 'N/A'} to {profile['max_value'] or 'N/A'}",
                        ],
                    }
                )

            if family in {"string", "boolean"} and completeness_ratio >= 70 and cardinality_band in {"low", "medium", "constant"}:
                dimension_reasons = [
                    f"{cardinality_band} cardinality is useful for grouping and filtering",
                    f"{completeness_ratio:.1f}% completeness supports slicing",
                ]
                if profile["top_values"]:
                    dimension_reasons.append("frequent repeated values suggest category behavior")
                dimensions.append(
                    {
                        "column": column_name,
                        "label": "Likely dimension",
                        "confidence": "high" if family == "boolean" or cardinality_band == "low" else "medium",
                        "reasons": dimension_reasons,
                    }
                )

            if family == "numeric" and distinct_count > 1 and not self._looks_like_identifier(column_name):
                metric_reasons = [
                    "numeric field can be aggregated in charts or semantic metrics",
                    f"{distinct_count} distinct values indicate variation",
                ]
                if stddev_value is not None:
                    metric_reasons.append(f"standard deviation of {stddev_value:.2f} shows distribution spread")
                metrics.append(
                    {
                        "column": column_name,
                        "label": "Likely metric",
                        "confidence": "high" if completeness_ratio >= 85 and cardinality_band in {"medium", "high"} else "medium",
                        "reasons": metric_reasons,
                    }
                )

            if null_count > 0 and completeness_ratio < 90:
                quality_actions.append(
                    f"Review missing values in {column_name}: only {completeness_ratio:.1f}% complete."
                )
            if blank_count > 0:
                quality_actions.append(
                    f"Trim or standardize blank strings in {column_name} before modeling."
                )
            if profile["quality_indicators"] and "constant values" in profile["quality_indicators"]:
                quality_actions.append(
                    f"{column_name} is constant across the file and may not add analytical value."
                )

        if profile_summary["duplicate_rows"] > 0:
            quality_actions.append(
                f"Deduplicate {profile_summary['duplicate_rows']} repeated rows before publishing curated outputs."
            )
        if not join_keys:
            quality_actions.append("No strong join key was detected automatically. Confirm relational keys before building joins.")
        if not time_columns:
            quality_actions.append("No clear time column was detected. Time-series dashboards may need a derived date field.")

        return {
            "join_keys": sorted(join_keys, key=lambda item: (item["confidence"] != "high", item["column"]))[:3],
            "dimensions": sorted(dimensions, key=lambda item: (item["confidence"] != "high", item["column"]))[:4],
            "metrics": sorted(metrics, key=lambda item: (item["confidence"] != "high", item["column"]))[:4],
            "time_columns": sorted(time_columns, key=lambda item: (item["confidence"] != "high", item["column"]))[:3],
            "quality_actions": list(dict.fromkeys(quality_actions))[:6],
        }

    def _profile_column(
        self,
        conn: duckdb.DuckDBPyConnection,
        *,
        view_name: str,
        column_name: str,
        column_type: str,
        row_count: int,
    ) -> dict:
        quoted_column = self._quote_identifier(column_name)
        family = self._type_family(column_type)
        base_stats = conn.execute(
            f"""
            SELECT
              SUM(CASE WHEN {quoted_column} IS NULL THEN 1 ELSE 0 END) AS null_count,
              COUNT(DISTINCT {quoted_column}) AS distinct_count
            FROM {view_name}
            """
        ).fetchone()
        null_count = int(base_stats[0] or 0)
        distinct_count = int(base_stats[1] or 0)

        blank_count = 0
        min_value = None
        max_value = None
        avg_value = None
        stddev_value = None
        true_count = None
        false_count = None

        if family == "string":
            blank_count = int(
                conn.execute(
                    f"""
                    SELECT SUM(CASE WHEN {quoted_column} IS NOT NULL AND TRIM(CAST({quoted_column} AS VARCHAR)) = '' THEN 1 ELSE 0 END)
                    FROM {view_name}
                    """
                ).fetchone()[0]
                or 0
            )

        if family in {"numeric", "temporal"}:
            min_max_stats = conn.execute(
                f"""
                SELECT
                  MIN({quoted_column})::VARCHAR AS min_value,
                  MAX({quoted_column})::VARCHAR AS max_value
                FROM {view_name}
                """
            ).fetchone()
            min_value = min_max_stats[0]
            max_value = min_max_stats[1]

        if family == "numeric":
            avg_result = conn.execute(
                f"""
                SELECT
                  AVG(TRY_CAST({quoted_column} AS DOUBLE)),
                  STDDEV_POP(TRY_CAST({quoted_column} AS DOUBLE))
                FROM {view_name}
                WHERE {quoted_column} IS NOT NULL
                """
            ).fetchone()
            avg_value = float(avg_result[0]) if avg_result and avg_result[0] is not None else None
            stddev_value = float(avg_result[1]) if avg_result and len(avg_result) > 1 and avg_result[1] is not None else None

        if family == "boolean":
            true_false_stats = conn.execute(
                f"""
                SELECT
                  SUM(CASE WHEN {quoted_column} = TRUE THEN 1 ELSE 0 END) AS true_count,
                  SUM(CASE WHEN {quoted_column} = FALSE THEN 1 ELSE 0 END) AS false_count
                FROM {view_name}
                """
            ).fetchone()
            true_count = int(true_false_stats[0] or 0)
            false_count = int(true_false_stats[1] or 0)

        sample_values = [
            item[0]
            for item in conn.execute(
                f"""
                SELECT DISTINCT CAST({quoted_column} AS VARCHAR) AS value
                FROM {view_name}
                WHERE {quoted_column} IS NOT NULL
                LIMIT 3
                """
            ).fetchall()
            if item and item[0] is not None
        ]

        top_values = [
            {"value": item[0], "count": int(item[1] or 0)}
            for item in conn.execute(
                f"""
                SELECT CAST({quoted_column} AS VARCHAR) AS value, COUNT(*) AS value_count
                FROM {view_name}
                WHERE {quoted_column} IS NOT NULL
                GROUP BY 1
                ORDER BY value_count DESC, value ASC
                LIMIT 3
                """
            ).fetchall()
            if item and item[0] is not None
        ]

        non_null_count = max(row_count - null_count, 0)
        completeness_ratio = round(((row_count - null_count) / row_count) * 100, 1) if row_count else 0.0
        uniqueness_ratio = round((distinct_count / non_null_count) * 100, 1) if non_null_count else 0.0
        return {
            "name": column_name,
            "type": column_type,
            "profile_kind": family,
            "null_count": null_count,
            "non_null_count": non_null_count,
            "distinct_count": distinct_count,
            "blank_count": blank_count,
            "completeness_ratio": completeness_ratio,
            "uniqueness_ratio": uniqueness_ratio,
            "cardinality_band": self._cardinality_band(row_count=non_null_count or row_count, distinct_count=distinct_count),
            "sample_values": sample_values,
            "top_values": top_values,
            "min_value": min_value,
            "max_value": max_value,
            "avg_value": avg_value,
            "stddev_value": stddev_value,
            "true_count": true_count,
            "false_count": false_count,
            "quality_indicators": self._build_quality_indicators(
                row_count=row_count,
                null_count=null_count,
                distinct_count=distinct_count,
                blank_count=blank_count,
            ),
        }

    def connect(self) -> duckdb.DuckDBPyConnection:
        return duckdb.connect(database=":memory:")

    def register_uploaded_file(self, conn: duckdb.DuckDBPyConnection, file_record: UploadedFile, alias: str | None = None) -> str:
        view_name = alias or f"raw_{slugify_identifier(Path(file_record.name).stem)}"
        storage_path = file_record.storage_path.replace("'", "''")
        if file_record.file_type == "csv":
            sql = f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_csv_auto('{storage_path}', union_by_name=true)"
        elif file_record.file_type == "json":
            sql = f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_json_auto('{storage_path}')"
        elif file_record.file_type == "parquet":
            sql = f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM parquet_scan('{storage_path}')"
        else:
            raise ValueError(f"Unsupported file type: {file_record.file_type}")
        conn.execute(sql)
        return view_name

    def register_delta_table(
        self,
        conn: duckdb.DuckDBPyConnection,
        table_record: DeltaTableModel,
        alias: str | None = None,
        access_context: dict | None = None,
    ) -> str:
        view_name = alias or slugify_identifier(table_record.name)
        arrow_table = DeltaTable(table_record.storage_path).to_pyarrow_table()
        policy_source_view = f"__datawizz_source_{view_name}"
        policy_sql = catalog_access_policy_service.compile_policy_view_sql(
            table_record,
            source_view=policy_source_view,
            public_view=view_name,
            access_context=access_context,
        )
        if policy_sql:
            conn.register(policy_source_view, arrow_table)
            conn.execute(policy_sql)
        else:
            conn.register(view_name, arrow_table)
        return view_name

    def execute_query(
        self,
        sql: str,
        uploaded_files: list[UploadedFile],
        delta_tables: list[DeltaTableModel],
        limit: int | None = None,
        access_context: dict | None = None,
    ) -> dict:
        conn = self.connect()
        try:
            registered_views = {"raw": {}, "curated": {}}
            for file_record in uploaded_files:
                view_name = self.register_uploaded_file(conn, file_record)
                registered_views["raw"][file_record.id] = view_name
            for table_record in delta_tables:
                view_name = self.register_delta_table(conn, table_record, access_context=access_context)
                registered_views["curated"][table_record.id] = view_name

            effective_sql = sql.strip().rstrip(";")
            if limit:
                effective_sql = f"SELECT * FROM ({effective_sql}) AS q LIMIT {limit}"

            started = perf_counter()
            relation = conn.execute(effective_sql)
            arrow_table = relation.fetch_arrow_table()
            execution_ms = int((perf_counter() - started) * 1000)
            rows = self._normalize_rows(arrow_table.to_pylist())
            return {
                "columns": arrow_table.column_names,
                "rows": rows,
                "row_count": len(rows),
                "execution_ms": execution_ms,
                "arrow_table": arrow_table,
                "registered_views": registered_views,
            }
        finally:
            conn.close()

    def preview_file(self, file_record: UploadedFile, limit: int = 20) -> dict:
        conn = self.connect()
        try:
            view_name = self.register_uploaded_file(conn, file_record, alias="preview_source")
            preview = conn.execute(f"SELECT * FROM {view_name} LIMIT {limit}").fetch_arrow_table()
            count = conn.execute(f"SELECT COUNT(*) AS total FROM {view_name}").fetchone()[0]
            schema = [{"name": field.name, "type": str(field.type)} for field in preview.schema]
            row_count = int(count)
            distinct_rows = int(
                conn.execute(f"SELECT COUNT(*) FROM (SELECT DISTINCT * FROM {view_name})").fetchone()[0]
                or 0
            ) if row_count else 0
            column_profiles = [
                self._profile_column(
                    conn,
                    view_name=view_name,
                    column_name=field["name"],
                    column_type=field["type"],
                    row_count=row_count,
                )
                for field in schema
            ]
            total_null_cells = sum(item["null_count"] for item in column_profiles)
            total_blank_cells = sum(item["blank_count"] for item in column_profiles)
            columns_with_nulls = sum(1 for item in column_profiles if item["null_count"] > 0)
            columns_with_blank_values = sum(1 for item in column_profiles if item["blank_count"] > 0)
            duplicate_rows = max(row_count - distinct_rows, 0)
            duplicate_ratio = round((duplicate_rows / row_count) * 100, 1) if row_count else 0.0
            total_cells = row_count * len(schema)
            completeness_ratio = round(((total_cells - total_null_cells) / total_cells) * 100, 1) if total_cells else 0.0
            quality_indicators: list[str] = []
            if row_count == 0:
                quality_indicators.append("empty file")
            if columns_with_nulls == 0 and row_count > 0:
                quality_indicators.append("no missing values")
            if columns_with_blank_values > 0:
                quality_indicators.append("blank strings detected")
            if any(item["distinct_count"] <= 1 for item in column_profiles if row_count > 1):
                quality_indicators.append("constant columns present")
            if any(item["distinct_count"] == row_count for item in column_profiles if row_count > 1):
                quality_indicators.append("high-cardinality fields present")
            if duplicate_rows > 0:
                quality_indicators.append("duplicate rows detected")
            recommendations = self._build_profile_recommendations(
                column_profiles=column_profiles,
                profile_summary={
                    "total_rows": row_count,
                    "distinct_rows": distinct_rows,
                    "duplicate_rows": duplicate_rows,
                    "duplicate_ratio": duplicate_ratio,
                    "total_columns": len(schema),
                    "total_blank_cells": total_blank_cells,
                    "null_cells": total_null_cells,
                    "completeness_ratio": completeness_ratio,
                    "columns_with_nulls": columns_with_nulls,
                    "columns_with_blank_values": columns_with_blank_values,
                    "quality_indicators": quality_indicators,
                },
            )
            return {
                "columns": preview.column_names,
                "rows": self._normalize_rows(preview.to_pylist()),
                "row_count": row_count,
                "schema": schema,
                "profile_summary": {
                    "total_rows": row_count,
                    "distinct_rows": distinct_rows,
                    "duplicate_rows": duplicate_rows,
                    "duplicate_ratio": duplicate_ratio,
                    "total_columns": len(schema),
                    "total_blank_cells": total_blank_cells,
                    "null_cells": total_null_cells,
                    "completeness_ratio": completeness_ratio,
                    "columns_with_nulls": columns_with_nulls,
                    "columns_with_blank_values": columns_with_blank_values,
                    "quality_indicators": quality_indicators,
                },
                "column_profiles": column_profiles,
                "recommendations": recommendations,
            }
        finally:
            conn.close()

    def preview_delta(self, table_record: DeltaTableModel, limit: int = 20, access_context: dict | None = None) -> dict:
        conn = self.connect()
        try:
            view_name = self.register_delta_table(conn, table_record, alias="preview_source", access_context=access_context)
            preview = conn.execute(f"SELECT * FROM {view_name} LIMIT {limit}").fetch_arrow_table()
            count = conn.execute(f"SELECT COUNT(*) AS total FROM {view_name}").fetchone()[0]
            return {
                "columns": preview.column_names,
                "rows": self._normalize_rows(preview.to_pylist()),
                "row_count": int(count or 0),
                "schema": [{"name": field.name, "type": str(field.type)} for field in preview.schema],
            }
        finally:
            conn.close()

    def register_arrow(self, conn: duckdb.DuckDBPyConnection, name: str, table: pa.Table) -> None:
        conn.register(name, table)

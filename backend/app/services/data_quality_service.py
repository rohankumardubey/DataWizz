from __future__ import annotations

from datetime import datetime, timezone

import duckdb
from deltalake import DeltaTable as DeltaLakeTable

from app.models.catalog import DeltaTable


class DataQualityService:
    def run(self, table: DeltaTable, expectations: list[dict], *, suite_name: str | None = None) -> dict:
        arrow_table = DeltaLakeTable(table.storage_path).to_pyarrow_table()
        columns = set(arrow_table.column_names)
        connection = duckdb.connect(database=":memory:")
        connection.register("quality_source", arrow_table)
        try:
            row_count = int(connection.execute("SELECT COUNT(*) FROM quality_source").fetchone()[0])
            results = [
                self._evaluate_expectation(connection, expectation, columns=columns, row_count=row_count)
                for expectation in expectations
                if expectation.get("enabled", True)
            ]
        finally:
            connection.close()

        failed = [result for result in results if not result["success"]]
        blocking = [result for result in failed if result["severity"] == "error"]
        status = "failed" if blocking else "warning" if failed else "passed"
        summary = (
            f"{len(results) - len(failed)} of {len(results)} expectations passed."
            if results
            else "No enabled expectations were configured."
        )
        return {
            "table_id": table.id,
            "suite_name": suite_name or f"{table.schema_name}.{table.name} baseline",
            "status": status,
            "success": not blocking,
            "row_count": row_count,
            "expectation_count": len(results),
            "passed_count": len(results) - len(failed),
            "failed_count": len(failed),
            "summary": summary,
            "run_at": datetime.now(timezone.utc).isoformat(),
            "results": results,
        }

    def _evaluate_expectation(
        self,
        connection: duckdb.DuckDBPyConnection,
        expectation: dict,
        *,
        columns: set[str],
        row_count: int,
    ) -> dict:
        expectation_type = expectation["expectation_type"]
        column = expectation.get("column")
        severity = expectation.get("severity", "error")
        result = {
            "id": expectation["id"],
            "expectation_type": expectation_type,
            "column": column,
            "severity": severity,
            "success": False,
            "observed_value": None,
            "unexpected_count": 0,
            "unexpected_percent": 0.0,
            "detail": "",
        }

        if expectation_type == "row_count_between":
            minimum = expectation.get("min_value")
            maximum = expectation.get("max_value")
            success = (minimum is None or row_count >= minimum) and (maximum is None or row_count <= maximum)
            result.update(
                success=success,
                observed_value=row_count,
                unexpected_count=0 if success else 1,
                unexpected_percent=0.0 if success else 100.0,
                detail=f"Observed {row_count} rows; expected between {minimum if minimum is not None else 'any'} and {maximum if maximum is not None else 'any'}.",
            )
            return result

        if not column or column not in columns:
            result.update(
                unexpected_count=row_count,
                unexpected_percent=100.0 if row_count else 0.0,
                detail=f"Column {column or '(missing)'} does not exist in the table.",
            )
            return result

        quoted_column = self._quote_identifier(column)
        if expectation_type == "not_null":
            unexpected = int(
                connection.execute(
                    f"SELECT COUNT(*) FROM quality_source WHERE {quoted_column} IS NULL"
                ).fetchone()[0]
            )
            result["observed_value"] = row_count - unexpected
            result["detail"] = f"{unexpected} null values found."
        elif expectation_type == "unique":
            non_null, distinct = connection.execute(
                f"SELECT COUNT({quoted_column}), COUNT(DISTINCT {quoted_column}) FROM quality_source"
            ).fetchone()
            unexpected = max(int(non_null) - int(distinct), 0)
            result["observed_value"] = int(distinct)
            result["detail"] = f"{unexpected} duplicate non-null values found."
        elif expectation_type == "accepted_values":
            accepted_values = list(expectation.get("accepted_values") or [])
            if not accepted_values:
                unexpected = row_count
                result["detail"] = "No accepted values were configured."
            else:
                placeholders = ", ".join("?" for _ in accepted_values)
                unexpected = int(
                    connection.execute(
                        f"""
                        SELECT COUNT(*)
                        FROM quality_source
                        WHERE {quoted_column} IS NOT NULL
                          AND CAST({quoted_column} AS VARCHAR) NOT IN ({placeholders})
                        """,
                        accepted_values,
                    ).fetchone()[0]
                )
                result["detail"] = f"{unexpected} values fell outside the accepted set."
            result["observed_value"] = accepted_values
        else:
            unexpected = row_count
            result["detail"] = f"Unsupported expectation type: {expectation_type}."

        result["unexpected_count"] = unexpected
        result["unexpected_percent"] = round((unexpected / row_count * 100) if row_count else 0.0, 2)
        result["success"] = unexpected == 0
        return result

    def _quote_identifier(self, value: str) -> str:
        return f'"{value.replace(chr(34), chr(34) * 2)}"'


data_quality_service = DataQualityService()

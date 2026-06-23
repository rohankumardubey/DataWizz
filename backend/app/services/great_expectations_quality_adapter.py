from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version
from typing import Any

from deltalake import DeltaTable as DeltaLakeTable

from app.models.catalog import DeltaTable
from app.utils.naming import slugify_identifier


class GreatExpectationsQualityAdapter:
    engine_name = "great_expectations"

    def get_status(self) -> dict[str, Any]:
        try:
            installed_version = version("great-expectations")
        except PackageNotFoundError:
            return {
                "name": self.engine_name,
                "label": "Great Expectations",
                "available": False,
                "version": None,
                "detail": "The great-expectations package is not installed.",
            }
        return {
            "name": self.engine_name,
            "label": "Great Expectations",
            "available": True,
            "version": installed_version,
            "detail": "GX Core validates the current Delta snapshot through an ephemeral pandas Data Source.",
        }

    def run(self, table: DeltaTable, expectations: list[dict], *, suite_name: str | None = None) -> dict:
        try:
            import great_expectations as gx
        except ImportError as exc:
            raise RuntimeError(
                "Great Expectations is selected but unavailable. Install backend dependencies or select the native engine."
            ) from exc

        dataframe = DeltaLakeTable(table.storage_path).to_pyarrow_table().to_pandas()
        columns = set(dataframe.columns)
        row_count = len(dataframe.index)
        context = gx.get_context(mode="ephemeral")
        context.variables.progress_bars = {"globally": False}
        identifier = slugify_identifier(f"{table.schema_name}_{table.name}_{table.id}")
        data_source = context.data_sources.add_pandas(name=f"datawizz_{identifier}")
        data_asset = data_source.add_dataframe_asset(name=f"delta_{identifier}")
        batch_definition = data_asset.add_batch_definition_whole_dataframe("current_snapshot")
        batch = batch_definition.get_batch(batch_parameters={"dataframe": dataframe})

        results = []
        for expectation in expectations:
            if not expectation.get("enabled", True):
                continue
            results.append(
                self._evaluate_expectation(
                    gx,
                    batch,
                    expectation,
                    columns=columns,
                    row_count=row_count,
                )
            )

        failed = [result for result in results if not result["success"]]
        blocking = [result for result in failed if result["severity"] == "error"]
        status = "failed" if blocking else "warning" if failed else "passed"
        summary = (
            f"{len(results) - len(failed)} of {len(results)} expectations passed with Great Expectations."
            if results
            else "No enabled expectations were configured."
        )
        return {
            "table_id": table.id,
            "suite_name": suite_name or f"{table.schema_name}.{table.name} baseline",
            "engine": self.engine_name,
            "status": status,
            "success": not blocking,
            "row_count": row_count,
            "expectation_count": len(results),
            "passed_count": len(results) - len(failed),
            "failed_count": len(failed),
            "summary": summary,
            "results": results,
        }

    def _evaluate_expectation(
        self,
        gx: Any,
        batch: Any,
        expectation: dict,
        *,
        columns: set[str],
        row_count: int,
    ) -> dict:
        expectation_type = expectation["expectation_type"]
        column = expectation.get("column")
        severity = expectation.get("severity", "error")
        base_result = {
            "id": expectation["id"],
            "expectation_type": expectation_type,
            "column": column,
            "severity": severity,
            "success": False,
            "observed_value": None,
            "unexpected_count": 0,
            "unexpected_percent": 0.0,
            "detail": "",
            "engine": self.engine_name,
        }

        if expectation_type != "row_count_between" and (not column or column not in columns):
            base_result.update(
                unexpected_count=row_count,
                unexpected_percent=100.0 if row_count else 0.0,
                detail=f"Column {column or '(missing)'} does not exist in the table.",
            )
            return base_result

        gx_expectation = self._build_expectation(gx, expectation)
        validation = batch.validate(gx_expectation)
        payload = validation.to_json_dict()
        evidence = payload.get("result") or {}
        success = bool(payload.get("success"))
        observed_value = evidence.get("observed_value")
        unexpected_count = int(evidence.get("unexpected_count") or (0 if success else 1))
        unexpected_percent = float(evidence.get("unexpected_percent") or (0.0 if success else 100.0))
        base_result.update(
            success=success,
            observed_value=observed_value,
            unexpected_count=unexpected_count,
            unexpected_percent=round(unexpected_percent, 2),
            detail=self._detail(expectation, evidence, row_count),
            framework_expectation=payload.get("expectation_config", {}).get("type"),
        )
        return base_result

    def _build_expectation(self, gx: Any, expectation: dict) -> Any:
        expectation_type = expectation["expectation_type"]
        if expectation_type == "row_count_between":
            return gx.expectations.ExpectTableRowCountToBeBetween(
                min_value=expectation.get("min_value"),
                max_value=expectation.get("max_value"),
            )
        if expectation_type == "not_null":
            return gx.expectations.ExpectColumnValuesToNotBeNull(
                column=expectation["column"],
                result_format="COMPLETE",
            )
        if expectation_type == "unique":
            return gx.expectations.ExpectColumnValuesToBeUnique(
                column=expectation["column"],
                result_format="COMPLETE",
            )
        if expectation_type == "accepted_values":
            return gx.expectations.ExpectColumnValuesToBeInSet(
                column=expectation["column"],
                value_set=list(expectation.get("accepted_values") or []),
                result_format="COMPLETE",
            )
        raise ValueError(f"Unsupported expectation type: {expectation_type}")

    def _detail(self, expectation: dict, evidence: dict, row_count: int) -> str:
        expectation_type = expectation["expectation_type"]
        unexpected = int(evidence.get("unexpected_count") or 0)
        if expectation_type == "row_count_between":
            observed = evidence.get("observed_value", row_count)
            return (
                f"GX observed {observed} rows; expected between "
                f"{expectation.get('min_value') if expectation.get('min_value') is not None else 'any'} and "
                f"{expectation.get('max_value') if expectation.get('max_value') is not None else 'any'}."
            )
        if expectation_type == "not_null":
            return f"GX found {unexpected} null values."
        if expectation_type == "unique":
            return f"GX found {unexpected} rows participating in duplicate values."
        if expectation_type == "accepted_values":
            return f"GX found {unexpected} non-null values outside the accepted set."
        return "Great Expectations completed the check."


great_expectations_quality_adapter = GreatExpectationsQualityAdapter()

from __future__ import annotations

import importlib.util
import os
import re
import shutil
import subprocess
from contextlib import redirect_stdout
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from time import perf_counter
from typing import Any

import pandas as pd
import pyarrow as pa
from deltalake import DeltaTable as DeltaLakeTable
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.catalog import DeltaTable as DeltaTableModel
from app.models.catalog import UploadedFile
from app.models.notebook import NotebookDocument, NotebookRun
from app.services.delta_service import DeltaService
from app.services.duckdb_service import DuckDBService
from app.services.openlineage_service import openlineage_service
from app.utils.naming import slugify_identifier


class ExecutionEngineService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.duckdb_service = DuckDBService()
        self.delta_service = DeltaService()
        self._spark_session: Any | None = None

    def list_engines(self) -> list[dict[str, Any]]:
        return [
            self._build_duckdb_descriptor(),
            self._build_spark_descriptor(),
            self._build_datafusion_descriptor(),
        ]

    def get_engine(self, engine_id: str) -> dict[str, Any]:
        engine = next((item for item in self.list_engines() if item["id"] == engine_id), None)
        if engine is None:
            raise ValueError(f"Unknown execution engine '{engine_id}'")
        return engine

    def execute_notebook(
        self,
        engine_id: str,
        code: str,
        uploaded_files: list[UploadedFile],
        delta_tables: list[DeltaTableModel],
        db: Session | None = None,
        limit: int = 200,
    ) -> dict[str, Any]:
        engine = self.get_engine(engine_id)
        if not engine["available"]:
            raise ValueError(engine["availability_reason"] or f"{engine['label']} is not available in this environment.")

        context = self._build_source_context(uploaded_files, delta_tables)

        if engine_id == "duckdb":
            runtime = self._build_duckdb_runtime(engine, uploaded_files, delta_tables, context)
            result = self._execute_runtime_cell(runtime, code, db, limit)
            return {"engine": engine, "result": result}

        if engine_id == "spark":
            runtime = self._build_spark_runtime(engine, uploaded_files, delta_tables, db, context)
            result = self._execute_runtime_cell(runtime, code, db, limit)
            return {"engine": engine, "result": result}

        if engine_id == "datafusion":
            runtime = self._build_datafusion_runtime(engine, uploaded_files, delta_tables, db, context)
            result = self._execute_runtime_cell(runtime, code, db, limit)
            return {"engine": engine, "result": result}

        raise ValueError(f"Execution for engine '{engine_id}' is not implemented.")

    def execute_saved_notebook(
        self,
        notebook: NotebookDocument,
        *,
        db: Session,
        uploaded_files: list[UploadedFile],
        delta_tables: list[DeltaTableModel],
        limit: int = 200,
    ) -> tuple[NotebookRun, list[dict[str, Any]]]:
        return self.execute_saved_notebook_range(
            notebook,
            db=db,
            uploaded_files=uploaded_files,
            delta_tables=delta_tables,
            limit=limit,
        )

    def execute_saved_notebook_range(
        self,
        notebook: NotebookDocument,
        *,
        db: Session,
        uploaded_files: list[UploadedFile],
        delta_tables: list[DeltaTableModel],
        start_cell_id: str | None = None,
        end_cell_id: str | None = None,
        limit: int = 200,
    ) -> tuple[NotebookRun, list[dict[str, Any]]]:
        engine = self.get_engine(notebook.engine_id)
        if not engine["available"]:
            raise ValueError(engine["availability_reason"] or f"{engine['label']} is not available in this environment.")

        cells = notebook.cells_json or []
        if not cells:
            raise ValueError("This notebook has no cells to execute.")

        start_index = 0
        if start_cell_id:
            matches = [index for index, cell in enumerate(cells) if cell.get("id") == start_cell_id]
            if not matches:
                raise ValueError(f"Notebook cell '{start_cell_id}' was not found.")
            start_index = matches[0]

        end_index = len(cells) - 1
        if end_cell_id:
            matches = [index for index, cell in enumerate(cells) if cell.get("id") == end_cell_id]
            if not matches:
                raise ValueError(f"Notebook cell '{end_cell_id}' was not found.")
            end_index = matches[0]
            if end_index < start_index:
                raise ValueError("Notebook execution range is invalid because the end cell appears before the start cell.")

        context = self._build_source_context(uploaded_files, delta_tables)
        runtime = self._build_runtime(
            notebook.engine_id,
            engine=engine,
            uploaded_files=uploaded_files,
            delta_tables=delta_tables,
            db=db,
            context=context,
        )

        run = NotebookRun(
            notebook_id=notebook.id,
            engine_id=notebook.engine_id,
            status="running",
            started_at=datetime.now(timezone.utc),
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        lineage_job_name = f"notebook.{slugify_identifier(notebook.name)}"
        lineage_run_facets = {
            "datawizz": {
                "notebookId": notebook.id,
                "engineId": notebook.engine_id,
                "startCellId": start_cell_id,
                "endCellId": end_cell_id,
            }
        }
        openlineage_service.emit(
            event_type="START",
            job_name=lineage_job_name,
            run_id=run.id,
            run_facets=lineage_run_facets,
            job_facets={
                "datawizz": {
                    "jobKind": "notebook",
                    "notebookId": notebook.id,
                    "engineId": notebook.engine_id,
                }
            },
        )

        cell_results: list[dict[str, Any]] = []
        run_started = perf_counter()
        run_error: str | None = None

        try:
            for cell in cells[:start_index]:
                if cell.get("kind") == "markdown" or not cell.get("code"):
                    continue
                self._execute_runtime_cell(runtime, cell["code"], db, limit)

            for index, cell in enumerate(cells[start_index : end_index + 1], start=start_index + 1):
                if cell.get("kind") == "markdown" or not cell.get("code"):
                    continue
                result = self._execute_runtime_cell(runtime, cell["code"], db, limit)
                cell_results.append(
                    {
                        "cell_id": cell["id"],
                        "title": cell.get("title") or f"Cell {index}",
                        "status": result["status"],
                        "execution_ms": result["execution_ms"],
                        "columns": result["columns"],
                        "rows": result["rows"],
                        "row_count": result["row_count"],
                        "stdout": result["stdout"],
                        "message": result["message"],
                        "warnings": result["warnings"],
                    }
                )
            run.status = "success"
        except Exception as exc:  # noqa: BLE001
            run.status = "failed"
            run_error = str(exc)
            run.error_message = run_error
            raise
        finally:
            duration_ms = int((perf_counter() - run_started) * 1000)
            notebook.last_run_at = datetime.now(timezone.utc)
            notebook.latest_cell_results_json = self._merge_notebook_cell_results(
                notebook.latest_cell_results_json or [],
                cell_results,
                valid_cell_ids=[cell.get("id") for cell in cells if cell.get("id")],
            )
            run.finished_at = datetime.now(timezone.utc)
            run.duration_ms = duration_ms
            run.run_summary = {
                "notebook_name": notebook.name,
                "engine_id": notebook.engine_id,
                "cell_count": len(cells),
                "completed_cells": len(cell_results),
                "primed_cells": start_index,
                "start_cell_id": cells[start_index]["id"],
                "end_cell_id": cells[end_index]["id"],
                "cell_results": cell_results,
            }
            if run_error:
                run.run_summary["error"] = run_error
            db.commit()
            db.refresh(run)
            db.refresh(notebook)
            openlineage_service.emit(
                event_type="FAIL" if run_error else "COMPLETE",
                job_name=lineage_job_name,
                run_id=run.id,
                run_facets={
                    "datawizz": {
                        **lineage_run_facets["datawizz"],
                        "status": run.status,
                        "durationMs": run.duration_ms,
                        "completedCells": len(cell_results),
                        "error": run_error,
                    }
                },
                job_facets={
                    "datawizz": {
                        "jobKind": "notebook",
                        "notebookId": notebook.id,
                        "engineId": notebook.engine_id,
                    }
                },
            )

        return run, cell_results

    def materialize_saved_notebook_cell(
        self,
        notebook: NotebookDocument,
        *,
        db: Session,
        uploaded_files: list[UploadedFile],
        delta_tables: list[DeltaTableModel],
        cell_id: str,
    ) -> dict[str, Any]:
        engine = self.get_engine(notebook.engine_id)
        if not engine["available"]:
            raise ValueError(engine["availability_reason"] or f"{engine['label']} is not available in this environment.")

        cells = notebook.cells_json or []
        if not cells:
            raise ValueError("This notebook has no cells to execute.")

        matches = [index for index, cell in enumerate(cells) if cell.get("id") == cell_id]
        if not matches:
            raise ValueError(f"Notebook cell '{cell_id}' was not found.")
        target_index = matches[0]
        target_cell = cells[target_index]

        context = self._build_source_context(uploaded_files, delta_tables)
        runtime = self._build_runtime(
            notebook.engine_id,
            engine=engine,
            uploaded_files=uploaded_files,
            delta_tables=delta_tables,
            db=db,
            context=context,
        )

        for cell in cells[:target_index]:
            if cell.get("kind") == "markdown" or not cell.get("code"):
                continue
            self._execute_runtime_cell(runtime, cell["code"], db, 200)

        if target_cell.get("kind") == "markdown":
            raise ValueError("Markdown cells cannot be executed or exported. Choose a code cell instead.")
        if not target_cell.get("code"):
            raise ValueError("This notebook cell is empty and cannot be exported.")

        if runtime["type"] == "duckdb":
            conn = self.duckdb_service.connect()
            try:
                for file_record in uploaded_files:
                    self.duckdb_service.register_uploaded_file(conn, file_record)
                for table_record in delta_tables:
                    self.duckdb_service.register_delta_table(conn, table_record)
                effective_sql = target_cell["code"].strip().rstrip(";")
                if not effective_sql:
                    raise ValueError("This notebook cell is empty and cannot be exported.")
                arrow_table = conn.execute(effective_sql).fetch_arrow_table()
            finally:
                conn.close()
            return {
                "engine": engine,
                "cell": target_cell,
                "arrow_table": arrow_table,
                "row_count": arrow_table.num_rows,
                "columns": arrow_table.column_names,
            }

        materialized = self._execute_python_notebook_materialized(engine, target_cell["code"], runtime["namespace"])
        if materialized["result"] is None:
            raise ValueError("This notebook cell did not produce an exportable result. Assign a dataframe-like object to `result` first.")
        arrow_table = self._to_arrow_table(materialized["result"])
        return {
            "engine": engine,
            "cell": target_cell,
            "arrow_table": arrow_table,
            "row_count": arrow_table.num_rows,
            "columns": arrow_table.column_names,
            "stdout": materialized["stdout"],
            "execution_ms": materialized["execution_ms"],
        }

    def _merge_notebook_cell_results(
        self,
        existing_results: list[dict[str, Any]],
        next_results: list[dict[str, Any]],
        *,
        valid_cell_ids: list[str],
    ) -> list[dict[str, Any]]:
        merged: dict[str, dict[str, Any]] = {}
        valid_ids = set(valid_cell_ids)

        for item in existing_results:
            cell_id = item.get("cell_id")
            if cell_id in valid_ids:
                merged[cell_id] = item

        for item in next_results:
            cell_id = item.get("cell_id")
            if cell_id:
                merged[cell_id] = item

        ordered_results: list[dict[str, Any]] = []
        for cell_id in valid_cell_ids:
            if cell_id in merged:
                ordered_results.append(merged[cell_id])
        return ordered_results

    def _build_runtime(
        self,
        engine_id: str,
        *,
        engine: dict[str, Any],
        uploaded_files: list[UploadedFile],
        delta_tables: list[DeltaTableModel],
        db: Session | None,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        if engine_id == "duckdb":
            return self._build_duckdb_runtime(engine, uploaded_files, delta_tables, context)
        if engine_id == "spark":
            return self._build_spark_runtime(engine, uploaded_files, delta_tables, db, context)
        if engine_id == "datafusion":
            return self._build_datafusion_runtime(engine, uploaded_files, delta_tables, db, context)
        raise ValueError(f"Execution for engine '{engine_id}' is not implemented.")

    def _build_duckdb_runtime(
        self,
        engine: dict[str, Any],
        uploaded_files: list[UploadedFile],
        delta_tables: list[DeltaTableModel],
        context: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "engine": engine,
            "type": "duckdb",
            "uploaded_files": uploaded_files,
            "delta_tables": delta_tables,
            "context": context,
            "warnings": [],
        }

    def _build_spark_runtime(
        self,
        engine: dict[str, Any],
        uploaded_files: list[UploadedFile],
        delta_tables: list[DeltaTableModel],
        db: Session | None,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        from pyspark.sql import SparkSession

        spark = self._get_or_create_spark_session(SparkSession)
        warnings: list[str] = []

        for file_record in uploaded_files:
            view_name = f"raw_{slugify_identifier(Path(file_record.name).stem)}"
            dataframe = self._read_file_with_spark(spark, file_record)
            dataframe.createOrReplaceTempView(view_name)

        for table_record in delta_tables:
            view_name = slugify_identifier(table_record.name)
            arrow_table = DeltaLakeTable(table_record.storage_path).to_pyarrow_table()
            dataframe = spark.createDataFrame(arrow_table.to_pandas())
            dataframe.createOrReplaceTempView(view_name)

        namespace = {
            "spark": spark,
            "source_catalog": context,
            "raw_views": context["raw_views"],
            "curated_views": context["curated_views"],
            "result": None,
        }
        namespace["write_delta"] = self._build_write_delta_helper(db, namespace, engine_id=engine["id"])
        return {
            "engine": engine,
            "type": "python",
            "namespace": namespace,
            "context": context,
            "warnings": warnings,
        }

    def _build_datafusion_runtime(
        self,
        engine: dict[str, Any],
        uploaded_files: list[UploadedFile],
        delta_tables: list[DeltaTableModel],
        db: Session | None,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        from datafusion import SessionContext

        ctx = SessionContext()
        warnings: list[str] = []

        for file_record in uploaded_files:
            view_name = f"raw_{slugify_identifier(Path(file_record.name).stem)}"
            path = file_record.storage_path
            if file_record.file_type == "csv":
                ctx.register_csv(view_name, path)
            elif file_record.file_type == "json":
                ctx.register_json(view_name, path)
            elif file_record.file_type == "parquet":
                ctx.register_parquet(view_name, path)
            else:
                warnings.append(
                    f"DataFusion auto-registration currently skips {file_record.file_type.upper()} source '{file_record.name}'."
                )

        for table_record in delta_tables:
            view_name = slugify_identifier(table_record.name)
            arrow_table = DeltaLakeTable(table_record.storage_path).to_pyarrow_table()
            ctx.register_record_batches(view_name, [arrow_table.to_batches()])

        namespace = {
            "ctx": ctx,
            "source_catalog": context,
            "raw_views": context["raw_views"],
            "curated_views": context["curated_views"],
            "result": None,
        }
        namespace["write_delta"] = self._build_write_delta_helper(db, namespace, engine_id=engine["id"])
        return {
            "engine": engine,
            "type": "python",
            "namespace": namespace,
            "context": context,
            "warnings": warnings,
        }

    def _execute_runtime_cell(
        self,
        runtime: dict[str, Any],
        code: str,
        db: Session | None,
        limit: int,
    ) -> dict[str, Any]:
        engine = runtime["engine"]
        context = runtime["context"]
        warnings = list(runtime.get("warnings", []))

        if runtime["type"] == "duckdb":
            result = self.duckdb_service.execute_query(
                code,
                uploaded_files=runtime["uploaded_files"],
                delta_tables=runtime["delta_tables"],
                limit=limit,
            )
            return {
                "engine_id": engine["id"],
                "engine_label": engine["label"],
                "status": "success",
                "language": engine["runtime_language"],
                "execution_ms": result["execution_ms"],
                "columns": result["columns"],
                "rows": result["rows"],
                "row_count": result["row_count"],
                "stdout": None,
                "message": f"Executed DuckDB SQL successfully with {len(context['raw_views'])} raw view(s) and {len(context['curated_views'])} curated table(s) registered.",
                "warnings": warnings,
                "metadata": {
                    **context,
                    "registered_views": result["registered_views"],
                },
            }

        return self._execute_python_notebook(engine, code, runtime["namespace"], db, limit, context, warnings)["result"]

    def _build_duckdb_descriptor(self) -> dict[str, Any]:
        return {
            "id": "duckdb",
            "label": "DuckDB",
            "vendor": "DuckDB Labs",
            "runtime_language": "sql",
            "available": True,
            "status": "available",
            "summary": "Fast local SQL execution over files and Delta Lake tables.",
            "description": "Primary demo-ready engine for ad hoc SQL, file previewing, query exports, and Delta table publication.",
            "availability_reason": None,
            "supports_sql": True,
            "supports_python": False,
            "supports_delta_read": True,
            "supports_delta_write": True,
            "supports_local_files": True,
            "notebook_ready": True,
            "sample_code": "SELECT *\nFROM raw_sales\nLIMIT 25",
        }

    def _build_spark_descriptor(self) -> dict[str, Any]:
        pyspark_installed = self._module_available("pyspark")
        java_runtime = self._resolve_spark_java_runtime()
        java_available = java_runtime["available"]
        spark_ready = pyspark_installed and java_available
        reason = None
        if not pyspark_installed:
            reason = "PySpark is not installed in this local environment yet. Install pyspark to enable live Spark notebook execution."
        elif not java_available:
            reason = java_runtime["reason"]
        return {
            "id": "spark",
            "label": "Spark Notebook",
            "vendor": "Apache Spark",
            "runtime_language": "python",
            "available": spark_ready,
            "status": "available" if spark_ready else "not_installed" if not pyspark_installed else "runtime_missing",
            "summary": "PySpark-style notebook execution for distributed transformation logic.",
            "description": "Use Python notebook cells with Spark SQL or DataFrame APIs, similar to a Databricks Spark notebook workflow. Raw sources and curated Delta tables are registered automatically for local execution.",
            "availability_reason": reason,
            "supports_sql": True,
            "supports_python": True,
            "supports_delta_read": spark_ready,
            "supports_delta_write": spark_ready,
            "supports_local_files": True,
            "notebook_ready": spark_ready,
            "sample_code": (
                "result = spark.sql(\"\"\"\n"
                "SELECT region, SUM(revenue) AS total_revenue\n"
                "FROM raw_sales\n"
                "GROUP BY region\n"
                "ORDER BY total_revenue DESC\n"
                "\"\"\")\n"
                "print('Spark query complete')"
            ),
        }

    def _build_datafusion_descriptor(self) -> dict[str, Any]:
        datafusion_installed = self._module_available("datafusion")
        return {
            "id": "datafusion",
            "label": "DataFusion Notebook",
            "vendor": "Apache Arrow DataFusion",
            "runtime_language": "python",
            "available": datafusion_installed,
            "status": "available" if datafusion_installed else "not_installed",
            "summary": "Arrow-native Python notebook runtime for SQL and dataframe experiments.",
            "description": "Arrow-native notebook runtime for SQL and dataframe workflows. Raw sources and curated Delta tables are registered automatically for local execution.",
            "availability_reason": None if datafusion_installed else "The Python DataFusion runtime is not installed. Install the datafusion package to enable live notebook execution.",
            "supports_sql": True,
            "supports_python": True,
            "supports_delta_read": datafusion_installed,
            "supports_delta_write": datafusion_installed,
            "supports_local_files": True,
            "notebook_ready": datafusion_installed,
            "sample_code": (
                "result = ctx.sql(\"\"\"\n"
                "SELECT product_category, SUM(revenue) AS total_revenue\n"
                "FROM raw_sales\n"
                "GROUP BY product_category\n"
                "ORDER BY total_revenue DESC\n"
                "\"\"\")\n"
                "print('DataFusion query complete')"
            ),
        }

    def _build_source_context(
        self,
        uploaded_files: list[UploadedFile],
        delta_tables: list[DeltaTableModel],
    ) -> dict[str, Any]:
        raw_views = [f"raw_{slugify_identifier(Path(file_record.name).stem)}" for file_record in uploaded_files]
        curated_views = [slugify_identifier(table_record.name) for table_record in delta_tables]
        return {
            "raw_views": raw_views,
            "curated_views": curated_views,
            "raw_sources": [
                {
                    "id": file_record.id,
                    "name": file_record.name,
                    "view_name": f"raw_{slugify_identifier(Path(file_record.name).stem)}",
                    "path": file_record.storage_path,
                    "file_type": file_record.file_type,
                }
                for file_record in uploaded_files
            ],
            "curated_sources": [
                {
                    "id": table_record.id,
                    "name": table_record.name,
                    "view_name": slugify_identifier(table_record.name),
                    "path": table_record.storage_path,
                    "schema_name": table_record.schema_name,
                }
                for table_record in delta_tables
            ],
        }

    def _execute_python_notebook(
        self,
        engine: dict[str, Any],
        code: str,
        namespace: dict[str, Any],
        db: Session | None,
        limit: int,
        context: dict[str, Any],
        warnings: list[str],
    ) -> dict[str, Any]:
        stdout_buffer = StringIO()
        started = perf_counter()
        with redirect_stdout(stdout_buffer):
            exec(compile(code, f"{engine['id']}_notebook.py", "exec"), namespace, namespace)
        execution_ms = int((perf_counter() - started) * 1000)

        normalized = self._normalize_python_result(namespace.get("result"), limit)
        return {
            "engine": engine,
            "result": {
                "engine_id": engine["id"],
                "engine_label": engine["label"],
                "status": "success",
                "language": engine["runtime_language"],
                "execution_ms": execution_ms,
                "columns": normalized["columns"],
                "rows": normalized["rows"],
                "row_count": normalized["row_count"],
                "stdout": stdout_buffer.getvalue().strip() or None,
                "message": normalized["message"] or "Notebook cell executed successfully.",
                "warnings": warnings,
                "metadata": context,
            },
        }

    def _execute_python_notebook_materialized(
        self,
        engine: dict[str, Any],
        code: str,
        namespace: dict[str, Any],
    ) -> dict[str, Any]:
        stdout_buffer = StringIO()
        started = perf_counter()
        with redirect_stdout(stdout_buffer):
            exec(compile(code, f"{engine['id']}_notebook.py", "exec"), namespace, namespace)
        execution_ms = int((perf_counter() - started) * 1000)
        return {
            "result": namespace.get("result"),
            "stdout": stdout_buffer.getvalue().strip() or None,
            "execution_ms": execution_ms,
        }

    def _build_write_delta_helper(self, db: Session | None, namespace: dict[str, Any], *, engine_id: str):
        def write_delta(
            result: Any | None = None,
            *,
            table_name: str,
            mode: str = "overwrite",
            schema_name: str = "analytics",
            description: str | None = None,
        ) -> dict[str, Any]:
            if db is None:
                raise ValueError("Notebook Delta writes require a database session, but none was provided.")
            materialized = result if result is not None else namespace.get("result")
            if materialized is None:
                raise ValueError("No notebook result is available to write. Assign a dataframe-like object to `result` or pass one into write_delta(...).")
            arrow_table = self._to_arrow_table(materialized)
            table = self.delta_service.write_table(
                db,
                table_name=table_name,
                arrow_table=arrow_table,
                mode=mode,
                schema_name=schema_name,
                description=description,
                source_query=f"Notebook runtime write via {engine_id}",
            )
            return {
                "table_id": table.id,
                "table_name": table.name,
                "schema_name": table.schema_name,
                "row_count": table.row_count,
            }

        return write_delta

    def _normalize_python_result(self, result: Any, limit: int) -> dict[str, Any]:
        if result is None:
            return {
                "columns": [],
                "rows": [],
                "row_count": 0,
                "message": "Execution completed. Assign a table-like object to `result` to preview rows in the notebook output.",
            }

        if isinstance(result, pa.Table):
            sliced = result.slice(0, limit)
            rows = jsonable_encoder(sliced.to_pylist())
            return {
                "columns": sliced.column_names,
                "rows": rows,
                "row_count": result.num_rows,
                "message": f"Previewing {len(rows)} of {result.num_rows} row(s) returned by the notebook cell.",
            }

        if isinstance(result, pd.DataFrame):
            preview = result.head(limit)
            rows = jsonable_encoder(preview.to_dict(orient="records"))
            return {
                "columns": list(preview.columns),
                "rows": rows,
                "row_count": len(result.index),
                "message": f"Previewing {len(rows)} of {len(result.index)} row(s) returned by the notebook cell.",
            }

        if hasattr(result, "limit") and hasattr(result, "toPandas"):
            preview_df = result.limit(limit).toPandas()
            try:
                row_count = int(result.count())
            except Exception:  # noqa: BLE001
                row_count = len(preview_df.index)
            rows = jsonable_encoder(preview_df.to_dict(orient="records"))
            return {
                "columns": list(preview_df.columns),
                "rows": rows,
                "row_count": row_count,
                "message": f"Previewing Spark result rows ({len(rows)} shown).",
            }

        if hasattr(result, "to_pandas"):
            preview_df = result.to_pandas()
            if hasattr(preview_df, "head"):
                preview_df = preview_df.head(limit)
                rows = jsonable_encoder(preview_df.to_dict(orient="records"))
                return {
                    "columns": list(preview_df.columns),
                    "rows": rows,
                    "row_count": len(rows),
                    "message": f"Previewing DataFusion result rows ({len(rows)} shown).",
                }

        if isinstance(result, list):
            if result and isinstance(result[0], dict):
                rows = jsonable_encoder(result[:limit])
                return {
                    "columns": list(rows[0].keys()) if rows else [],
                    "rows": rows,
                    "row_count": len(result),
                    "message": f"Previewing {len(rows)} of {len(result)} row(s) returned by the notebook cell.",
                }
            rows = jsonable_encoder([{"value": item} for item in result[:limit]])
            return {
                "columns": ["value"],
                "rows": rows,
                "row_count": len(result),
                "message": f"Previewing {len(rows)} of {len(result)} list item(s) returned by the notebook cell.",
            }

        if isinstance(result, dict):
            row = jsonable_encoder(result)
            return {
                "columns": list(row.keys()),
                "rows": [row],
                "row_count": 1,
                "message": "Previewing a single dictionary result from the notebook cell.",
            }

        return {
            "columns": [],
            "rows": [],
            "row_count": 0,
            "message": f"Notebook cell returned a {type(result).__name__}. Inspect stdout or assign a dataframe-like object to `result` for row previews.",
        }

    def _get_or_create_spark_session(self, spark_session_class: Any) -> Any:
        if self._spark_session is None:
            java_runtime = self._resolve_spark_java_runtime()
            if not java_runtime["available"]:
                raise ValueError(java_runtime["reason"])
            if java_runtime["java_home"]:
                os.environ["JAVA_HOME"] = str(java_runtime["java_home"])
                os.environ["PATH"] = f"{java_runtime['java_home']}/bin:{os.environ.get('PATH', '')}"
            os.environ.setdefault("SPARK_LOCAL_IP", "127.0.0.1")
            os.environ.setdefault("SPARK_LOCAL_HOSTNAME", "localhost")
            warehouse_dir = Path(self.settings.temp_storage_path) / "spark-warehouse"
            warehouse_dir.mkdir(parents=True, exist_ok=True)
            self._spark_session = (
                spark_session_class.builder.master("local[*]")
                .appName("DataWizz Engine Lab")
                .config("spark.driver.host", "127.0.0.1")
                .config("spark.driver.bindAddress", "127.0.0.1")
                .config("spark.ui.enabled", "false")
                .config("spark.sql.warehouse.dir", str(warehouse_dir))
                .config("spark.sql.shuffle.partitions", "4")
                .getOrCreate()
            )
            self._spark_session.sparkContext.setLogLevel("WARN")
        return self._spark_session

    def _read_file_with_spark(self, spark: Any, file_record: UploadedFile) -> Any:
        path = file_record.storage_path
        if file_record.file_type == "csv":
            return spark.read.option("header", True).option("inferSchema", True).csv(path)
        if file_record.file_type == "json":
            return spark.read.json(path)
        if file_record.file_type == "parquet":
            return spark.read.parquet(path)
        raise ValueError(f"Spark does not support auto-registering file type '{file_record.file_type}'.")

    def _module_available(self, module_name: str) -> bool:
        return importlib.util.find_spec(module_name) is not None

    def _java_available(self) -> bool:
        return shutil.which("java") is not None

    def _resolve_spark_java_runtime(self) -> dict[str, Any]:
        current_version = self._detect_java_major_version()
        if current_version is not None and 11 <= current_version <= 21:
            return {
                "available": True,
                "java_home": os.environ.get("JAVA_HOME"),
                "version": current_version,
                "reason": None,
            }

        fallback_home = self._find_supported_java_home()
        if fallback_home:
            fallback_version = self._detect_java_major_version(Path(fallback_home) / "bin" / "java")
            return {
                "available": True,
                "java_home": fallback_home,
                "version": fallback_version,
                "reason": None,
            }

        if not self._java_available():
            return {
                "available": False,
                "java_home": None,
                "version": None,
                "reason": "Java is not available on PATH, so Spark cannot start. Install a compatible local JRE/JDK (11, 17, or 21) or use the Docker backend image.",
            }

        return {
            "available": False,
            "java_home": None,
            "version": current_version,
            "reason": "The detected Java runtime is not compatible with local Spark execution. Install or select Java 11, 17, or 21, or use the Docker backend image.",
        }

    def _find_supported_java_home(self) -> str | None:
        java_home_helper = Path("/usr/libexec/java_home")
        if java_home_helper.exists():
            for version in ("21", "17", "11"):
                try:
                    resolved = subprocess.check_output([str(java_home_helper), "-v", version], text=True).strip()
                    if resolved:
                        return resolved
                except Exception:  # noqa: BLE001
                    continue
        java_home = os.environ.get("JAVA_HOME")
        if java_home:
            version = self._detect_java_major_version(Path(java_home) / "bin" / "java")
            if version is not None and 11 <= version <= 21:
                return java_home
        return None

    def _detect_java_major_version(self, java_bin: str | Path = "java") -> int | None:
        try:
            output = subprocess.check_output([str(java_bin), "-version"], stderr=subprocess.STDOUT, text=True)
        except Exception:  # noqa: BLE001
            return None
        match = re.search(r'version "(?P<version>\d+)(?:\.(?P<minor>\d+))?', output)
        if not match:
            return None
        major = int(match.group("version"))
        if major == 1 and match.group("minor"):
            return int(match.group("minor"))
        return major

    def _to_arrow_table(self, result: Any) -> pa.Table:
        if isinstance(result, pa.Table):
            return result
        if isinstance(result, pd.DataFrame):
            return pa.Table.from_pandas(result, preserve_index=False)
        if hasattr(result, "toPandas"):
            return pa.Table.from_pandas(result.toPandas(), preserve_index=False)
        if hasattr(result, "to_pandas"):
            return pa.Table.from_pandas(result.to_pandas(), preserve_index=False)
        if isinstance(result, list):
            return pa.Table.from_pylist(result)
        if isinstance(result, dict):
            return pa.Table.from_pylist([result])
        raise ValueError(f"Cannot convert notebook result of type {type(result).__name__} into an Arrow table for Delta writing.")


execution_engine_service = ExecutionEngineService()

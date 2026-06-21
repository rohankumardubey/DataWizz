from collections import defaultdict
from datetime import datetime, timezone
from time import perf_counter

import networkx as nx
from sqlalchemy.orm import Session

from app.models.catalog import DeltaTable, UploadedFile
from app.models.pipeline import JobLog, Pipeline, PipelineRun
from app.services.delta_service import DeltaService
from app.services.duckdb_service import DuckDBService
from app.services.openlineage_service import openlineage_service
from app.services.data_quality_service import DataQualityService
from app.utils.naming import slugify_identifier


class PipelineService:
    def __init__(self) -> None:
        self.duckdb_service = DuckDBService()
        self.delta_service = DeltaService()
        self.data_quality_service = DataQualityService()
        self.supported_join_types = {"inner", "left", "right", "full"}
        self.supported_aggregations = {"sum", "avg", "count", "min", "max"}

    def _pipeline_input_datasets(
        self,
        pipeline: Pipeline,
        uploaded_files: dict[str, UploadedFile],
        delta_tables: dict[str, DeltaTable],
    ) -> list[dict]:
        datasets: list[dict] = []
        for node in pipeline.definition_json.get("nodes", []):
            config = self._node_config(node)
            if node.get("type") == "fileSource":
                record = uploaded_files.get(str(config.get("fileId") or ""))
                if record is not None:
                    datasets.append(
                        openlineage_service.dataset(
                            namespace="file://localhost",
                            name=record.storage_path,
                            fields=record.schema_json or [],
                            facets={
                                "datawizz": {
                                    "assetKind": "uploaded_file",
                                    "assetId": record.id,
                                    "fileType": record.file_type,
                                }
                            },
                        )
                    )
            elif node.get("type") == "deltaSource":
                record = delta_tables.get(str(config.get("tableId") or ""))
                if record is not None:
                    datasets.append(self._delta_dataset(record))
        return self._deduplicate_datasets(datasets)

    def _delta_dataset(self, table: DeltaTable) -> dict:
        return openlineage_service.dataset(
            namespace=f"datawizz://delta/{table.schema_name}",
            name=table.name,
            fields=table.schema_json or [],
            facets={
                "datawizz": {
                    "assetKind": "delta_table",
                    "assetId": table.id,
                    "storagePath": table.storage_path,
                }
            },
        )

    def _deduplicate_datasets(self, datasets: list[dict]) -> list[dict]:
        seen: set[tuple[str, str]] = set()
        unique: list[dict] = []
        for dataset in datasets:
            key = (str(dataset.get("namespace")), str(dataset.get("name")))
            if key in seen:
                continue
            seen.add(key)
            unique.append(dataset)
        return unique

    def _require_config(self, data: dict, key: str, node_id: str, node_type: str) -> str:
        value = data.get(key)
        if value in (None, "", []):
            raise ValueError(
                f"Node {node_id} ({node_type}) is missing required config `{key}`. Open the pipeline builder and complete this field."
            )
        return str(value)

    def _node_config(self, node: dict) -> dict:
        data = node.get("data", {})
        if isinstance(data, dict):
            config = data.get("config", data)
            return config if isinstance(config, dict) else {}
        return {}

    def validate_definition(
        self,
        definition: dict,
        *,
        uploaded_files: dict[str, UploadedFile] | None = None,
        delta_tables: dict[str, DeltaTable] | None = None,
    ) -> tuple[bool, list[str], list[str]]:
        graph = nx.DiGraph()
        issues: list[str] = []
        node_ids = [node["id"] for node in definition.get("nodes", [])]
        if len(node_ids) != len(set(node_ids)):
            issues.append("Pipeline graph contains duplicate node IDs. Remove the duplicate node and try again.")

        for node in definition.get("nodes", []):
            graph.add_node(node["id"], **node)
        for edge in definition.get("edges", []):
            graph.add_edge(edge["source"], edge["target"])

        if not nx.is_directed_acyclic_graph(graph):
            issues.append("Pipeline graph must be a directed acyclic graph.")
            return False, [], issues

        for node in definition.get("nodes", []):
            node_id = node["id"]
            node_type = node["type"]
            incoming = list(graph.predecessors(node_id))
            outgoing = list(graph.successors(node_id))
            config = self._node_config(node)

            if node_type in {"filter", "select", "validate", "writeDelta"} and len(incoming) != 1:
                issues.append(f"Node {node_id} ({node_type}) requires exactly one upstream input.")

            if node_type == "fileSource":
                file_id = str(config.get("fileId") or "").strip()
                if incoming:
                    issues.append(f"Node {node_id} (fileSource) cannot accept upstream inputs.")
                if not file_id:
                    issues.append(f"Node {node_id} (fileSource) is missing an uploaded file selection.")
                elif uploaded_files is not None and file_id not in uploaded_files:
                    issues.append(f"Node {node_id} (fileSource) references a file that no longer exists.")

            elif node_type == "deltaSource":
                table_id = str(config.get("tableId") or "").strip()
                if incoming:
                    issues.append(f"Node {node_id} (deltaSource) cannot accept upstream inputs.")
                if not table_id:
                    issues.append(f"Node {node_id} (deltaSource) is missing a Delta table selection.")
                elif delta_tables is not None and table_id not in delta_tables:
                    issues.append(f"Node {node_id} (deltaSource) references a Delta table that no longer exists.")

            elif node_type == "filter":
                condition = str(config.get("condition") or "").strip()
                if not condition:
                    issues.append(f"Node {node_id} (filter) needs a SQL filter condition.")

            elif node_type == "select":
                columns = config.get("columns") or []
                if isinstance(columns, list) and not [column for column in columns if str(column).strip()]:
                    issues.append(f"Node {node_id} (select) needs at least one selected column or `*`.")

            elif node_type == "join":
                join_type = str(config.get("joinType") or "inner").lower().strip()
                left_key = str(config.get("leftKey") or "").strip()
                right_key = str(config.get("rightKey") or "").strip()
                left_source_id = str(config.get("leftSourceId") or "").strip()
                right_source_id = str(config.get("rightSourceId") or "").strip()
                if len(incoming) != 2:
                    issues.append(f"Node {node_id} (join) requires exactly two upstream datasets.")
                if join_type not in self.supported_join_types:
                    issues.append(f"Node {node_id} (join) uses unsupported join type `{join_type}`.")
                if not left_key:
                    issues.append(f"Node {node_id} (join) is missing the left join key.")
                if not right_key:
                    issues.append(f"Node {node_id} (join) is missing the right join key.")
                if left_source_id and left_source_id not in incoming:
                    issues.append(f"Node {node_id} (join) left input must be one of the connected upstream nodes.")
                if right_source_id and right_source_id not in incoming:
                    issues.append(f"Node {node_id} (join) right input must be one of the connected upstream nodes.")
                if left_source_id and right_source_id and left_source_id == right_source_id:
                    issues.append(f"Node {node_id} (join) cannot use the same upstream node for both left and right inputs.")

            elif node_type == "aggregate":
                if len(incoming) != 1:
                    issues.append(f"Node {node_id} (aggregate) requires exactly one upstream dataset.")
                metrics = config.get("metrics") or []
                if not isinstance(metrics, list) or not metrics:
                    issues.append(f"Node {node_id} (aggregate) needs at least one metric definition.")
                else:
                    aliases: set[str] = set()
                    for index, metric in enumerate(metrics, start=1):
                        if not isinstance(metric, dict):
                            issues.append(f"Node {node_id} (aggregate) metric {index} is malformed.")
                            continue
                        agg = str(metric.get("agg") or "").lower().strip()
                        column = str(metric.get("column") or "").strip()
                        alias = str(metric.get("alias") or "").strip()
                        if agg not in self.supported_aggregations:
                            issues.append(
                                f"Node {node_id} (aggregate) metric {index} uses unsupported aggregation `{agg}`."
                            )
                        if not column:
                            issues.append(f"Node {node_id} (aggregate) metric {index} is missing a source column.")
                        if not alias:
                            issues.append(f"Node {node_id} (aggregate) metric {index} is missing an alias.")
                        elif alias in aliases:
                            issues.append(f"Node {node_id} (aggregate) metric alias `{alias}` is duplicated.")
                        else:
                            aliases.add(alias)

            elif node_type == "sql":
                sql = str(config.get("sql") or "").strip()
                if not incoming:
                    issues.append(f"Node {node_id} (sql) requires at least one upstream input.")
                if not sql:
                    issues.append(f"Node {node_id} (sql) needs a SQL statement.")
                if len(incoming) > 1 and sql:
                    for index in range(1, len(incoming) + 1):
                        if f"{{{{input_{index}}}}}" not in sql:
                            issues.append(
                                f"Node {node_id} (sql) should reference each upstream dataset with placeholders like `{{{{input_{index}}}}}`."
                            )

            elif node_type == "validate":
                min_rows = int(config.get("minRows", 1) or 1)
                if min_rows < 1:
                    issues.append(f"Node {node_id} (validate) minimum rows must be at least 1.")

            elif node_type == "writeDelta":
                table_name = str(config.get("tableName") or "").strip()
                mode = str(config.get("mode") or "overwrite").strip()
                quality_gate = str(config.get("qualityGate") or "off").strip().lower()
                if not table_name:
                    issues.append(f"Node {node_id} (writeDelta) needs a target table name.")
                if mode not in {"overwrite", "append"}:
                    issues.append(f"Node {node_id} (writeDelta) must use either overwrite or append mode.")
                if quality_gate not in {"off", "warn", "block"}:
                    issues.append(f"Node {node_id} (writeDelta) quality gate must be off, warn, or block.")

            elif node_type == "schedule":
                cron = str(config.get("cron") or "").strip()
                if incoming or outgoing:
                    issues.append(f"Node {node_id} (schedule) is metadata only and should not be wired into the DAG.")
                if not cron:
                    issues.append(f"Node {node_id} (schedule) needs a cron expression.")

            if node_type != "schedule" and not incoming and node_type not in {"fileSource", "deltaSource"}:
                issues.append(f"Node {node_id} ({node_type}) requires an upstream input.")
        return len(issues) == 0, list(nx.topological_sort(graph)), issues

    def create_log(
        self,
        db: Session,
        *,
        run_id: str | None,
        level: str,
        source: str,
        message: str,
        status: str | None = None,
        context_json: dict | None = None,
    ) -> JobLog:
        log = JobLog(
            pipeline_run_id=run_id,
            level=level,
            source=source,
            message=message,
            status=status,
            context_json=context_json,
        )
        db.add(log)
        db.commit()
        db.refresh(log)
        return log

    def execute_pipeline(
        self,
        db: Session,
        pipeline: Pipeline,
        *,
        trigger_type: str = "manual",
        retry_of_run_id: str | None = None,
    ) -> PipelineRun:
        uploaded_files = {record.id: record for record in db.query(UploadedFile).all()}
        delta_tables = {record.id: record for record in db.query(DeltaTable).all()}
        valid, ordered_nodes, issues = self.validate_definition(
            pipeline.definition_json,
            uploaded_files=uploaded_files,
            delta_tables=delta_tables,
        )
        run = PipelineRun(
            pipeline_id=pipeline.id,
            status="pending",
            started_at=datetime.now(timezone.utc),
            trigger_type=trigger_type,
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        lineage_inputs = self._pipeline_input_datasets(pipeline, uploaded_files, delta_tables)
        lineage_outputs: list[dict] = []
        lineage_job_name = f"pipeline.{slugify_identifier(pipeline.name)}"
        lineage_run_facets = {
            "datawizz": {
                "pipelineId": pipeline.id,
                "triggerType": trigger_type,
                "retryOfRunId": retry_of_run_id,
            }
        }
        openlineage_service.emit(
            event_type="START",
            job_name=lineage_job_name,
            run_id=run.id,
            inputs=lineage_inputs,
            run_facets=lineage_run_facets,
            job_facets={"datawizz": {"jobKind": "pipeline", "pipelineId": pipeline.id}},
        )

        if not valid:
            run.status = "failed"
            run.error_message = "; ".join(issues)
            run.finished_at = datetime.now(timezone.utc)
            run.run_summary = {"ordered_nodes": ordered_nodes, "issues": issues, "retry_of_run_id": retry_of_run_id}
            db.commit()
            self.create_log(db, run_id=run.id, level="ERROR", source="pipeline", message=run.error_message, status="failed")
            openlineage_service.emit(
                event_type="FAIL",
                job_name=lineage_job_name,
                run_id=run.id,
                inputs=lineage_inputs,
                run_facets={
                    "datawizz": {
                        **lineage_run_facets["datawizz"],
                        "status": "failed",
                        "error": run.error_message,
                        "issues": issues,
                    }
                },
                job_facets={"datawizz": {"jobKind": "pipeline", "pipelineId": pipeline.id}},
            )
            return run

        conn = self.duckdb_service.connect()
        started = perf_counter()
        run.status = "running"
        db.commit()

        graph_inputs: dict[str, list[str]] = defaultdict(list)
        for edge in pipeline.definition_json.get("edges", []):
            graph_inputs[edge["target"]].append(edge["source"])

        view_names: dict[str, str] = {}
        quality_run_summaries: list[dict] = []
        current_node_id: str | None = None
        current_node_type: str | None = None

        try:
            for node_id in ordered_nodes:
                node = next(item for item in pipeline.definition_json["nodes"] if item["id"] == node_id)
                node_type = node["type"]
                current_node_id = node_id
                current_node_type = node_type
                data = node.get("data", {})
                config = data.get("config", data) if isinstance(data, dict) else {}
                view_name = slugify_identifier(f"node_{node_id}")

                if node_type == "fileSource":
                    file_id = self._require_config(config, "fileId", node_id, node_type)
                    file_record = uploaded_files.get(file_id)
                    if file_record is None:
                        raise ValueError(f"Node {node_id} ({node_type}) references file `{file_id}`, but it no longer exists.")
                    self.duckdb_service.register_uploaded_file(conn, file_record, alias=view_name)
                    view_names[node_id] = view_name
                    self.create_log(
                        db,
                        run_id=run.id,
                        level="INFO",
                        source=node_type,
                        message=f"Loaded file {file_record.name}",
                        status="success",
                        context_json={"node_id": node_id, "view_name": view_name, "file_id": file_id},
                    )
                    continue

                if node_type == "deltaSource":
                    table_id = self._require_config(config, "tableId", node_id, node_type)
                    table_record = delta_tables.get(table_id)
                    if table_record is None:
                        raise ValueError(f"Node {node_id} ({node_type}) references Delta table `{table_id}`, but it no longer exists.")
                    self.duckdb_service.register_delta_table(conn, table_record, alias=view_name)
                    view_names[node_id] = view_name
                    self.create_log(
                        db,
                        run_id=run.id,
                        level="INFO",
                        source=node_type,
                        message=f"Loaded delta table {table_record.name}",
                        status="success",
                        context_json={"node_id": node_id, "view_name": view_name, "table_id": table_id},
                    )
                    continue

                input_nodes = graph_inputs[node_id]
                input_views = [view_names[source_node] for source_node in input_nodes if source_node in view_names]
                if not input_views and node_type not in {"schedule"}:
                    raise ValueError(f"Node {node_id} has no available inputs.")

                if node_type == "filter":
                    condition = config.get("condition", "1=1")
                    conn.execute(f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM {input_views[0]} WHERE {condition}")
                elif node_type == "select":
                    columns = config.get("columns") or ["*"]
                    projection = ", ".join(columns)
                    conn.execute(f"CREATE OR REPLACE VIEW {view_name} AS SELECT {projection} FROM {input_views[0]}")
                elif node_type == "join":
                    if len(input_views) < 2:
                        raise ValueError("Join node requires two upstream datasets.")
                    join_type = str(config.get("joinType", "inner")).lower()
                    left_key = self._require_config(config, "leftKey", node_id, node_type)
                    right_key = self._require_config(config, "rightKey", node_id, node_type)
                    left_source_id = str(config.get("leftSourceId") or input_nodes[0]).strip()
                    right_source_id = str(config.get("rightSourceId") or input_nodes[1]).strip()
                    if left_source_id == right_source_id:
                        raise ValueError(f"Join node {node_id} cannot use the same upstream input on both sides.")
                    if left_source_id not in view_names or right_source_id not in view_names:
                        raise ValueError(f"Join node {node_id} must map both left and right inputs to connected upstream nodes.")
                    left_view = view_names[left_source_id]
                    right_view = view_names[right_source_id]
                    conn.execute(
                        f"""
                        CREATE OR REPLACE VIEW {view_name} AS
                        SELECT *
                        FROM {left_view} AS left_side
                        {join_type.upper()} JOIN {right_view} AS right_side
                        ON left_side.{left_key} = right_side.{right_key}
                        """
                    )
                elif node_type == "aggregate":
                    if len(input_views) != 1:
                        raise ValueError(f"Aggregate node {node_id} requires exactly one upstream dataset.")
                    group_by = config.get("groupBy") or []
                    metrics = config.get("metrics") or [{"agg": "count", "column": "*", "alias": "row_count"}]
                    metrics_sql = ", ".join(
                        f"{metric['agg'].upper()}({metric['column']}) AS {metric['alias']}" for metric in metrics
                    )
                    group_sql = ", ".join(group_by)
                    if group_sql:
                        sql = f"CREATE OR REPLACE VIEW {view_name} AS SELECT {group_sql}, {metrics_sql} FROM {input_views[0]} GROUP BY {group_sql}"
                    else:
                        sql = f"CREATE OR REPLACE VIEW {view_name} AS SELECT {metrics_sql} FROM {input_views[0]}"
                    conn.execute(sql)
                elif node_type == "sql":
                    sql = config.get("sql", "SELECT * FROM input_1")
                    for index, input_view in enumerate(input_views, start=1):
                        sql = sql.replace(f"{{{{input_{index}}}}}", input_view)
                    conn.execute(f"CREATE OR REPLACE VIEW {view_name} AS {sql}")
                elif node_type == "validate":
                    min_rows = int(config.get("minRows", 1))
                    count = conn.execute(f"SELECT COUNT(*) FROM {input_views[0]}").fetchone()[0]
                    if count < min_rows:
                        raise ValueError(f"Validation failed for {node_id}: expected at least {min_rows} rows, got {count}.")
                    conn.execute(f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM {input_views[0]}")
                elif node_type == "writeDelta":
                    final_view = input_views[0]
                    table_name = self._require_config(config, "tableName", node_id, node_type)
                    mode = config.get("mode", "overwrite")
                    arrow_table = conn.execute(f"SELECT * FROM {final_view}").fetch_arrow_table()
                    written = self.delta_service.write_table(
                        db,
                        table_name=table_name,
                        arrow_table=arrow_table,
                        mode=mode,
                        schema_name=config.get("schemaName", "analytics"),
                        description=config.get("description"),
                        source_query=f"Pipeline {pipeline.name} node {node_id}",
                    )
                    lineage_outputs.append(self._delta_dataset(written))
                    quality_gate = str(config.get("qualityGate") or "off").strip().lower()
                    if quality_gate != "off":
                        quality_run = self.data_quality_service.execute(
                            db,
                            written,
                            trigger_type="pipeline_gate",
                            pipeline_run_id=run.id,
                            node_id=node_id,
                        )
                        quality_summary = {
                            "quality_run_id": quality_run.id,
                            "node_id": node_id,
                            "table_id": written.id,
                            "table_name": f"{written.schema_name}.{written.name}",
                            "gate_mode": quality_gate,
                            "status": quality_run.status,
                            "success": quality_run.success,
                            "summary": quality_run.summary,
                        }
                        quality_run_summaries.append(quality_summary)
                        self.create_log(
                            db,
                            run_id=run.id,
                            level="INFO" if quality_run.success else "ERROR",
                            source="qualityGate",
                            message=f"Quality gate {quality_run.status} for {written.schema_name}.{written.name}: {quality_run.summary}",
                            status="success" if quality_run.success else "failed",
                            context_json=quality_summary,
                        )
                        if quality_gate == "block" and not quality_run.success:
                            raise ValueError(
                                f"Quality gate blocked downstream execution for {written.schema_name}.{written.name}: {quality_run.summary}"
                            )
                    conn.execute(f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM {final_view}")
                    self.create_log(
                        db,
                        run_id=run.id,
                        level="INFO",
                        source=node_type,
                        message=f"Wrote Delta table {written.name}",
                        status="success",
                        context_json={"node_id": node_id, "table_name": written.name, "view_name": view_name},
                    )
                elif node_type == "schedule":
                    self.create_log(
                        db,
                        run_id=run.id,
                        level="INFO",
                        source=node_type,
                        message="Schedule metadata captured",
                        status="success",
                        context_json={"node_id": node_id, "cron": config.get("cron")},
                    )
                    continue
                else:
                    raise ValueError(f"Unsupported node type: {node_type}")

                view_names[node_id] = view_name
                self.create_log(
                    db,
                    run_id=run.id,
                    level="INFO",
                    source=node_type,
                    message=f"Executed node {node_id}",
                    status="success",
                    context_json={"node_id": node_id, "view_name": view_name},
                )

            run.status = "success"
            run.finished_at = datetime.now(timezone.utc)
            run.duration_ms = int((perf_counter() - started) * 1000)
            run.run_summary = {
                "ordered_nodes": ordered_nodes,
                "completed_nodes": list(view_names.keys()),
                "retry_of_run_id": retry_of_run_id,
                "quality_runs": quality_run_summaries,
            }
            db.commit()
            openlineage_service.emit(
                event_type="COMPLETE",
                job_name=lineage_job_name,
                run_id=run.id,
                inputs=lineage_inputs,
                outputs=self._deduplicate_datasets(lineage_outputs),
                run_facets={
                    "datawizz": {
                        **lineage_run_facets["datawizz"],
                        "status": "success",
                        "durationMs": run.duration_ms,
                        "completedNodes": list(view_names.keys()),
                    }
                },
                job_facets={"datawizz": {"jobKind": "pipeline", "pipelineId": pipeline.id}},
            )
            return run
        except Exception as exc:
            run.status = "failed"
            run.error_message = str(exc)
            run.finished_at = datetime.now(timezone.utc)
            run.duration_ms = int((perf_counter() - started) * 1000)
            run.run_summary = {
                "ordered_nodes": ordered_nodes,
                "completed_nodes": list(view_names.keys()),
                "retry_of_run_id": retry_of_run_id,
                "quality_runs": quality_run_summaries,
            }
            db.commit()
            self.create_log(
                db,
                run_id=run.id,
                level="ERROR",
                source=current_node_type or "pipeline",
                message=str(exc),
                status="failed",
                context_json={"node_id": current_node_id} if current_node_id else None,
            )
            openlineage_service.emit(
                event_type="FAIL",
                job_name=lineage_job_name,
                run_id=run.id,
                inputs=lineage_inputs,
                outputs=self._deduplicate_datasets(lineage_outputs),
                run_facets={
                    "datawizz": {
                        **lineage_run_facets["datawizz"],
                        "status": "failed",
                        "durationMs": run.duration_ms,
                        "error": str(exc),
                        "failedNodeId": current_node_id,
                        "failedNodeType": current_node_type,
                    }
                },
                job_facets={"datawizz": {"jobKind": "pipeline", "pipelineId": pipeline.id}},
            )
            return run
        finally:
            conn.close()

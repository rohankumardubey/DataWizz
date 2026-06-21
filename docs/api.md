# API Documentation

Base URL: `http://localhost:8000/api`

## Health and System

- `GET /health`
- `GET /api/system/dashboard-metrics`
- `GET /api/system/settings`
- `GET /api/system/openlineage/status`
- `GET /api/system/openlineage/events`

OpenLineage event filters:

```text
?event_type=COMPLETE&job_name=pipeline.sales_curated&run_id=<uuid>&limit=100
```

## File Management

- `GET /api/files`
- `POST /api/files/upload`
  - multipart form field: `file`
- `GET /api/files/{file_id}/preview`
- `DELETE /api/files/{file_id}`

## SQL and Delta Lake

- `GET /api/queries/history`
- `POST /api/queries/execute`

Example:

```json
{
  "sql": "SELECT * FROM raw_sales LIMIT 25",
  "name": "Preview sales",
  "limit": 200
}
```

- `POST /api/queries/write-delta`

Example:

```json
{
  "table_name": "sales_curated",
  "sql": "SELECT region, SUM(revenue) AS total_revenue FROM raw_sales GROUP BY region",
  "mode": "overwrite",
  "schema_name": "analytics",
  "description": "Regional revenue summary"
}
```

## Catalog

- `GET /api/tables`
- `GET /api/tables/{table_id}/preview`
- `PUT /api/tables/{table_id}/quality-suite`
- `POST /api/tables/{table_id}/quality-runs`
- `GET /api/tables/{table_id}/quality-runs`
- `PUT /api/tables/{table_id}/quality-schedule`
- `GET /api/tables/quality-scheduler/status`
- `POST /api/tables/quality-scheduler/run-due`

Quality suite example:

```json
{
  "name": "Orders baseline",
  "expectations": [
    {
      "id": "has-rows",
      "expectation_type": "row_count_between",
      "min_value": 1,
      "enabled": true,
      "severity": "error"
    },
    {
      "id": "order-id-unique",
      "expectation_type": "unique",
      "column": "order_id",
      "enabled": true,
      "severity": "warning"
    }
  ]
}
```

Quality schedule example:

```json
{
  "cron": "0 7 * * *",
  "enabled": true
}
```

Pipeline `writeDelta` nodes accept `qualityGate` values of `off`, `warn`, or `block`. Both `warn` and `block` execute the saved quality suite after publishing the Delta table. `block` fails the pipeline when an error-severity expectation fails; the published Delta version is retained.

## Pipelines

- `GET /api/pipelines`
- `POST /api/pipelines`
- `GET /api/pipelines/{pipeline_id}`
- `PUT /api/pipelines/{pipeline_id}`
- `POST /api/pipelines/{pipeline_id}/validate`
- `POST /api/pipelines/{pipeline_id}/run`
- `GET /api/pipelines/runs/all`
- `GET /api/pipelines/logs/all`
- `GET /api/pipelines/{pipeline_id}/airflow-dag`

Pipeline payload shape:

```json
{
  "name": "Sales Curated Pipeline",
  "description": "Join sales and customers into a curated table",
  "status": "draft",
  "definition": {
    "nodes": [
      {
        "id": "fileSource_1",
        "type": "fileSource",
        "position": { "x": 40, "y": 120 },
        "data": {
          "label": "Sales Source",
          "config": { "fileId": "..." }
        }
      }
    ],
    "edges": []
  }
}
```

## BI and Reporting

- `GET /api/bi/datasets`
- `POST /api/bi/datasets`
- `GET /api/bi/charts`
- `POST /api/bi/charts`
- `POST /api/bi/charts/preview`
- `GET /api/bi/dashboards`
- `POST /api/bi/dashboards`
- `GET /api/bi/dashboards/{dashboard_id}`
- `POST /api/bi/report-schedules`

## Notes

- Uploaded files become queryable through generated DuckDB view names such as `raw_sales`, `raw_customers`, and `raw_orders`.
- Curated Delta tables become queryable through view names based on the table name, such as `sales_curated`.
- FastAPI Swagger UI is available at `/docs`.

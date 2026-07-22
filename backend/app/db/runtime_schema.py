from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def ensure_runtime_schema(db_engine: Engine) -> None:
    inspector = inspect(db_engine)
    table_names = inspector.get_table_names()

    if "notebooks" in table_names:
        notebook_columns = {column["name"] for column in inspector.get_columns("notebooks")}
        if "latest_cell_results_json" not in notebook_columns:
            with db_engine.begin() as connection:
                connection.execute(text("ALTER TABLE notebooks ADD COLUMN latest_cell_results_json JSON"))

    if "semantic_datasets" in table_names:
        dataset_columns = {column["name"] for column in inspector.get_columns("semantic_datasets")}
        if "source_config_json" not in dataset_columns:
            with db_engine.begin() as connection:
                connection.execute(text("ALTER TABLE semantic_datasets ADD COLUMN source_config_json JSON"))

    if "dashboards" in table_names:
        dashboard_columns = {column["name"] for column in inspector.get_columns("dashboards")}
        with db_engine.begin() as connection:
            if "owner_email" not in dashboard_columns:
                connection.execute(text("ALTER TABLE dashboards ADD COLUMN owner_email VARCHAR(255)"))
            if "visibility" not in dashboard_columns:
                connection.execute(text("ALTER TABLE dashboards ADD COLUMN visibility VARCHAR(32)"))
            if "shared_roles_json" not in dashboard_columns:
                connection.execute(text("ALTER TABLE dashboards ADD COLUMN shared_roles_json JSON"))
            connection.execute(text("UPDATE dashboards SET visibility = 'workspace' WHERE visibility IS NULL OR TRIM(visibility) = ''"))

    if "semantic_metrics" not in table_names:
        with db_engine.begin() as connection:
            connection.execute(
                text(
                    """
                    CREATE TABLE semantic_metrics (
                        id VARCHAR PRIMARY KEY,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        name VARCHAR(255) NOT NULL UNIQUE,
                        label VARCHAR(255) NOT NULL,
                        description TEXT,
                        dataset_id VARCHAR NOT NULL,
                        expression TEXT NOT NULL,
                        filter_sql TEXT,
                        dimensions_json JSON,
                        format VARCHAR(64) NOT NULL DEFAULT 'number',
                        owner_email VARCHAR(255),
                        is_certified BOOLEAN NOT NULL DEFAULT 0,
                        FOREIGN KEY(dataset_id) REFERENCES semantic_datasets(id) ON DELETE CASCADE
                    )
                    """
                )
            )

    if "metric_alerts" not in table_names:
        with db_engine.begin() as connection:
            connection.execute(
                text(
                    """
                    CREATE TABLE metric_alerts (
                        id VARCHAR PRIMARY KEY,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        name VARCHAR(255) NOT NULL UNIQUE,
                        metric_id VARCHAR NOT NULL,
                        comparison VARCHAR(16) NOT NULL,
                        threshold_value FLOAT NOT NULL,
                        severity VARCHAR(32) NOT NULL DEFAULT 'warning',
                        enabled BOOLEAN NOT NULL DEFAULT 1,
                        owner_email VARCHAR(255),
                        notification_channel VARCHAR(64) NOT NULL DEFAULT 'local',
                        destination VARCHAR(255),
                        last_status VARCHAR(32) NOT NULL DEFAULT 'not_evaluated',
                        last_value FLOAT,
                        last_message TEXT,
                        last_evaluated_at DATETIME,
                        schedule_cron VARCHAR(128),
                        schedule_enabled BOOLEAN NOT NULL DEFAULT 0,
                        schedule_updated_at DATETIME,
                        FOREIGN KEY(metric_id) REFERENCES semantic_metrics(id) ON DELETE CASCADE
                    )
                    """
                )
            )
    else:
        metric_alert_columns = {column["name"] for column in inspector.get_columns("metric_alerts")}
        with db_engine.begin() as connection:
            if "schedule_cron" not in metric_alert_columns:
                connection.execute(text("ALTER TABLE metric_alerts ADD COLUMN schedule_cron VARCHAR(128)"))
            if "schedule_enabled" not in metric_alert_columns:
                connection.execute(text("ALTER TABLE metric_alerts ADD COLUMN schedule_enabled BOOLEAN NOT NULL DEFAULT 0"))
            if "schedule_updated_at" not in metric_alert_columns:
                connection.execute(text("ALTER TABLE metric_alerts ADD COLUMN schedule_updated_at DATETIME"))

    if "metric_alert_events" not in table_names:
        with db_engine.begin() as connection:
            connection.execute(
                text(
                    """
                    CREATE TABLE metric_alert_events (
                        id VARCHAR PRIMARY KEY,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        alert_id VARCHAR NOT NULL,
                        metric_id VARCHAR,
                        status VARCHAR(32) NOT NULL,
                        trigger_type VARCHAR(32) NOT NULL DEFAULT 'manual',
                        triggered BOOLEAN NOT NULL DEFAULT 0,
                        observed_value FLOAT,
                        threshold_value FLOAT NOT NULL,
                        message TEXT NOT NULL,
                        evaluated_at DATETIME NOT NULL,
                        details_json JSON,
                        delivery_status VARCHAR(32) NOT NULL DEFAULT 'not_attempted',
                        delivery_channel VARCHAR(64),
                        delivery_attempted_at DATETIME,
                        delivery_response_code INTEGER,
                        delivery_error TEXT,
                        FOREIGN KEY(alert_id) REFERENCES metric_alerts(id) ON DELETE CASCADE,
                        FOREIGN KEY(metric_id) REFERENCES semantic_metrics(id) ON DELETE SET NULL
                    )
                    """
                )
            )
    else:
        metric_alert_event_columns = {column["name"] for column in inspector.get_columns("metric_alert_events")}
        if "trigger_type" not in metric_alert_event_columns:
            with db_engine.begin() as connection:
                connection.execute(text("ALTER TABLE metric_alert_events ADD COLUMN trigger_type VARCHAR(32) NOT NULL DEFAULT 'manual'"))
        with db_engine.begin() as connection:
            if "delivery_status" not in metric_alert_event_columns:
                connection.execute(text("ALTER TABLE metric_alert_events ADD COLUMN delivery_status VARCHAR(32) NOT NULL DEFAULT 'not_attempted'"))
            if "delivery_channel" not in metric_alert_event_columns:
                connection.execute(text("ALTER TABLE metric_alert_events ADD COLUMN delivery_channel VARCHAR(64)"))
            if "delivery_attempted_at" not in metric_alert_event_columns:
                connection.execute(text("ALTER TABLE metric_alert_events ADD COLUMN delivery_attempted_at DATETIME"))
            if "delivery_response_code" not in metric_alert_event_columns:
                connection.execute(text("ALTER TABLE metric_alert_events ADD COLUMN delivery_response_code INTEGER"))
            if "delivery_error" not in metric_alert_event_columns:
                connection.execute(text("ALTER TABLE metric_alert_events ADD COLUMN delivery_error TEXT"))

    if "metric_alert_incidents" not in table_names:
        with db_engine.begin() as connection:
            connection.execute(
                text(
                    """
                    CREATE TABLE metric_alert_incidents (
                        id VARCHAR PRIMARY KEY,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        alert_id VARCHAR NOT NULL,
                        opened_by_event_id VARCHAR,
                        latest_event_id VARCHAR,
                        title VARCHAR(255) NOT NULL,
                        status VARCHAR(32) NOT NULL DEFAULT 'open',
                        severity VARCHAR(32) NOT NULL DEFAULT 'warning',
                        assignee_email VARCHAR(255),
                        trigger_count INTEGER NOT NULL DEFAULT 1,
                        latest_observed_value FLOAT,
                        latest_message TEXT,
                        opened_at DATETIME NOT NULL,
                        last_triggered_at DATETIME NOT NULL,
                        acknowledged_at DATETIME,
                        acknowledged_by_email VARCHAR(255),
                        resolved_at DATETIME,
                        resolved_by_email VARCHAR(255),
                        resolution_note TEXT,
                        FOREIGN KEY(alert_id) REFERENCES metric_alerts(id) ON DELETE CASCADE,
                        FOREIGN KEY(opened_by_event_id) REFERENCES metric_alert_events(id) ON DELETE SET NULL,
                        FOREIGN KEY(latest_event_id) REFERENCES metric_alert_events(id) ON DELETE SET NULL
                    )
                    """
                )
            )
            connection.execute(text("CREATE INDEX ix_metric_alert_incidents_status_last_triggered_at ON metric_alert_incidents(status, last_triggered_at)"))
            connection.execute(text("CREATE INDEX ix_metric_alert_incidents_alert_id_status ON metric_alert_incidents(alert_id, status)"))
            connection.execute(text("CREATE UNIQUE INDEX uq_metric_alert_incidents_active_alert ON metric_alert_incidents(alert_id) WHERE status IN ('open', 'acknowledged')"))
    else:
        metric_alert_incident_indexes = {index["name"] for index in inspector.get_indexes("metric_alert_incidents")}
        if "uq_metric_alert_incidents_active_alert" not in metric_alert_incident_indexes:
            with db_engine.begin() as connection:
                connection.execute(text("CREATE UNIQUE INDEX uq_metric_alert_incidents_active_alert ON metric_alert_incidents(alert_id) WHERE status IN ('open', 'acknowledged')"))

    if "metric_alert_incident_notes" not in table_names:
        with db_engine.begin() as connection:
            connection.execute(
                text(
                    """
                    CREATE TABLE metric_alert_incident_notes (
                        id VARCHAR PRIMARY KEY,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        incident_id VARCHAR NOT NULL,
                        author_email VARCHAR(255) NOT NULL,
                        body TEXT NOT NULL,
                        FOREIGN KEY(incident_id) REFERENCES metric_alert_incidents(id) ON DELETE CASCADE
                    )
                    """
                )
            )
            connection.execute(text("CREATE INDEX ix_metric_alert_incident_notes_incident_id_created_at ON metric_alert_incident_notes(incident_id, created_at)"))

    if "quality_runs" in table_names:
        quality_run_columns = {column["name"] for column in inspector.get_columns("quality_runs")}
        if "execution_engine" not in quality_run_columns:
            with db_engine.begin() as connection:
                connection.execute(
                    text("ALTER TABLE quality_runs ADD COLUMN execution_engine VARCHAR(64) NOT NULL DEFAULT 'native'")
                )
                connection.execute(
                    text("UPDATE quality_runs SET execution_engine = 'native' WHERE execution_engine IS NULL")
                )

    if "notebook_snippets" not in table_names:
        with db_engine.begin() as connection:
            connection.execute(
                text(
                    """
                    CREATE TABLE notebook_snippets (
                        id VARCHAR(36) PRIMARY KEY,
                        created_at DATETIME,
                        updated_at DATETIME,
                        name VARCHAR(255) NOT NULL UNIQUE,
                        description TEXT,
                        category VARCHAR(64) NOT NULL DEFAULT 'general',
                        engine_scope VARCHAR(64) NOT NULL DEFAULT 'all',
                        cell_kind VARCHAR(32) NOT NULL DEFAULT 'code',
                        code TEXT NOT NULL,
                        is_template BOOLEAN NOT NULL DEFAULT 0
                    )
                    """
                )
            )

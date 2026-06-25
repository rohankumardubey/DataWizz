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

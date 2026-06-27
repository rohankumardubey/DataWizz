import re

from app.models.catalog import DeltaTable
from app.services.catalog_metadata_service import CatalogMetadataService


class CatalogAccessPolicyService:
    def __init__(self) -> None:
        self.catalog_metadata_service = CatalogMetadataService()

    def normalize_policy(
        self,
        *,
        policy_mode: str | None,
        row_filters: list[dict] | None,
        column_masks: list[dict] | None,
    ) -> dict:
        mode = (policy_mode or "off").strip().lower()
        if mode not in {"off", "warn", "enforce"}:
            mode = "off"

        normalized_filters = []
        for index, rule in enumerate(row_filters or [], start=1):
            if not isinstance(rule, dict):
                continue
            expression = self.validate_filter_expression(rule.get("expression"), f"Row filter {index}")
            role = self._normalize_role(rule.get("role"))
            normalized_filters.append(
                {
                    "id": str(rule.get("id") or f"row-filter-{index}"),
                    "role": role,
                    "expression": expression,
                    "enabled": bool(rule.get("enabled", True)),
                }
            )

        normalized_masks = []
        for index, rule in enumerate(column_masks or [], start=1):
            if not isinstance(rule, dict):
                continue
            column = str(rule.get("column") or "").strip()
            if not column:
                continue
            mask_type = str(rule.get("mask_type") or "null").strip().lower()
            if mask_type not in {"null", "fixed", "hash", "partial"}:
                mask_type = "null"
            normalized_masks.append(
                {
                    "id": str(rule.get("id") or f"column-mask-{index}"),
                    "role": self._normalize_role(rule.get("role")),
                    "column": column,
                    "mask_type": mask_type,
                    "replacement": str(rule.get("replacement") or "***MASKED***"),
                    "enabled": bool(rule.get("enabled", True)),
                }
            )

        return {
            "access_policy_mode": mode,
            "row_filters": normalized_filters,
            "column_masks": normalized_masks,
        }

    def validate_filter_expression(self, value: str | None, label: str) -> str:
        expression = str(value or "").strip().rstrip(";")
        if not expression:
            raise ValueError(f"{label} cannot be empty")
        lowered = expression.lower()
        if any(token in lowered for token in [";", "--", "/*", "*/"]):
            raise ValueError(f"{label} cannot contain SQL statement separators or comments")
        if re.search(r"\b(alter|attach|copy|create|delete|detach|drop|insert|install|load|pragma|update)\b", lowered):
            raise ValueError(f"{label} must be a read-only SQL predicate")
        return expression

    def compile_policy_view_sql(
        self,
        table: DeltaTable,
        *,
        source_view: str,
        public_view: str,
        access_context: dict | None,
    ) -> str | None:
        policy = self.catalog_metadata_service.get_access_policy(table)
        if policy.get("access_policy_mode") != "enforce":
            return None

        role = str((access_context or {}).get("role") or "").strip().lower()
        if not role:
            return None

        row_filters = [
            rule
            for rule in policy.get("row_filters", [])
            if rule.get("enabled", True) and self._role_matches(rule.get("role"), role)
        ]
        masks_by_column = {
            str(rule.get("column")): rule
            for rule in policy.get("column_masks", [])
            if rule.get("enabled", True) and self._role_matches(rule.get("role"), role)
        }

        if not row_filters and not masks_by_column:
            return None

        schema = table.schema_json or []
        if schema:
            select_parts = []
            for field in schema:
                column = str(field.get("name") or "").strip()
                if not column:
                    continue
                if column in masks_by_column:
                    select_parts.append(f"{self._mask_expression(column, masks_by_column[column])} AS {self._quote_identifier(column)}")
                else:
                    select_parts.append(self._quote_identifier(column))
            select_sql = ", ".join(select_parts) if select_parts else "*"
        else:
            select_sql = "*"

        where_sql = ""
        if row_filters:
            predicates = [self.validate_filter_expression(rule.get("expression"), "Row filter") for rule in row_filters]
            where_sql = f"WHERE {' AND '.join(f'({predicate})' for predicate in predicates)}"

        return f"CREATE OR REPLACE VIEW {self._quote_identifier(public_view)} AS SELECT {select_sql} FROM {self._quote_identifier(source_view)} {where_sql}"

    def _mask_expression(self, column: str, rule: dict) -> str:
        quoted_column = self._quote_identifier(column)
        mask_type = str(rule.get("mask_type") or "null").lower()
        replacement = self._quote_literal(str(rule.get("replacement") or "***MASKED***"))

        if mask_type == "fixed":
            return replacement
        if mask_type == "hash":
            return f"md5(CAST({quoted_column} AS VARCHAR))"
        if mask_type == "partial":
            return (
                f"CASE WHEN {quoted_column} IS NULL THEN NULL "
                f"WHEN LENGTH(CAST({quoted_column} AS VARCHAR)) <= 4 THEN {replacement} "
                f"ELSE CONCAT(LEFT(CAST({quoted_column} AS VARCHAR), 2), '…', RIGHT(CAST({quoted_column} AS VARCHAR), 2)) END"
            )
        return "NULL"

    def _normalize_role(self, value: object) -> str:
        role = str(value or "viewer").strip().lower()
        return role if role in {"all", "admin", "analyst", "viewer"} else "viewer"

    def _role_matches(self, rule_role: object, current_role: str) -> bool:
        normalized = self._normalize_role(rule_role)
        return normalized == "all" or normalized == current_role

    def _quote_identifier(self, value: str) -> str:
        return f'"{value.replace(chr(34), chr(34) * 2)}"'

    def _quote_literal(self, value: str) -> str:
        return f"'{value.replace(chr(39), chr(39) * 2)}'"


catalog_access_policy_service = CatalogAccessPolicyService()

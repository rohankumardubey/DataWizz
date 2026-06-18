import json
import os
import re
import secrets
import subprocess
import time
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urljoin, urlparse
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen

from app.core.config import ROOT_DIR, get_settings
from app.services.superset_catalog_service import superset_catalog_service


class SupersetRuntimeService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.runtime_state_path = ROOT_DIR / ".runtime" / "superset-runtime.json"
        self.native_venv_dir = ROOT_DIR / ".superset-venv"
        self.native_superset_bin = self.native_venv_dir / "bin" / "superset"
        self.superset_config_path = ROOT_DIR / "docker" / "superset" / "superset_config.py"
        self.superset_native_home = ROOT_DIR / "storage" / "temp" / "superset" / "home"
        self.superset_native_db = ROOT_DIR / "storage" / "temp" / "superset" / "superset.db"
        self.connection_name = "DataWizz Serving Catalog"
        self._embed_tickets: dict[str, dict[str, str | float]] = {}

    def _native_superset_command(self) -> list[str] | None:
        if self.native_superset_bin.exists():
            return [str(self.native_superset_bin)]

        native_python = self.native_venv_dir / "bin" / "python"
        if native_python.exists():
            return [str(native_python), "-m", "superset"]

        return None

    def read_runtime_state(self) -> dict:
        if not self.runtime_state_path.exists():
            return {"mode": "unknown"}
        try:
            return json.loads(self.runtime_state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {"mode": "unknown"}

    def is_healthy(self, timeout: float = 2) -> bool:
        try:
            with urlopen(f"{self.settings.superset_url.rstrip('/')}/health", timeout=timeout) as response:
                return 200 <= response.status < 400
        except Exception:  # noqa: BLE001
            return False

    def create_embed_ticket(self, *, user_id: str, next_path: str | None = None) -> str:
        ticket = secrets.token_urlsafe(32)
        self._prune_embed_tickets()
        self._embed_tickets[ticket] = {
            "user_id": user_id,
            "next_path": self.resolve_next_target(next_path),
            "expires_at": time.time() + 900,
        }
        return ticket

    def consume_embed_ticket(self, ticket: str) -> dict | None:
        self._prune_embed_tickets()
        record = self._embed_tickets.pop(ticket, None)
        if record is None:
            return None
        if float(record.get("expires_at", 0)) <= time.time():
            return None
        return record

    def resolve_next_target(self, next_path: str | None) -> str:
        default_target = f"{self.settings.superset_url.rstrip('/')}/superset/welcome/"
        if not next_path:
            return default_target

        candidate = next_path.strip()
        if not candidate:
            return default_target

        if candidate.startswith("/"):
            return f"{self.settings.superset_url.rstrip('/')}{candidate}"

        parsed_candidate = urlparse(candidate)
        parsed_base = urlparse(self.settings.superset_url.rstrip("/"))
        if parsed_candidate.scheme in {"http", "https"} and parsed_candidate.netloc == parsed_base.netloc:
            return candidate

        return default_target

    def login_browser_session(self, *, next_path: str | None = None) -> tuple[str, list[dict]]:
        if not self.is_healthy():
            raise RuntimeError(
                "Superset is not running. Start DataWizz with ./run.sh and wait for the launcher to report that Superset is healthy."
            )
        resolved_target = self.resolve_next_target(next_path)
        login_page_url = f"{self.settings.superset_url.rstrip('/')}/login/?next={quote(urlparse(resolved_target).path or '/superset/welcome/', safe='/%?=&')}"
        cookie_jar = CookieJar()
        opener = build_opener(HTTPCookieProcessor(cookie_jar))

        with opener.open(Request(login_page_url, method="GET"), timeout=10) as response:
            login_page_html = response.read().decode("utf-8")

        csrf_match = re.search(r'name="csrf_token"[^>]*value="([^"]+)"', login_page_html)
        action_match = re.search(r"<form[^>]*action=\"([^\"]+)\"", login_page_html)
        if csrf_match is None:
            raise RuntimeError("Could not extract Superset CSRF token from the login page.")

        action_url = urljoin(self.settings.superset_url.rstrip("/") + "/", action_match.group(1) if action_match else "/login/")
        form_payload = urlencode(
            {
                "username": self.settings.superset_username,
                "password": self.settings.superset_password,
                "csrf_token": csrf_match.group(1),
                "next": urlparse(resolved_target).path or "/superset/welcome/",
            }
        ).encode("utf-8")

        form_request = Request(
            action_url,
            data=form_payload,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": login_page_url,
            },
            method="POST",
        )
        with opener.open(form_request, timeout=10):
            pass

        parsed_host = urlparse(self.settings.superset_url.rstrip("/")).hostname or "localhost"
        allowed_domains = {"", parsed_host, f".{parsed_host}", f"{parsed_host}.local", f".{parsed_host}.local"}
        cookies = [
            {
                "name": cookie.name,
                "value": cookie.value,
                "path": cookie.path or "/",
                "secure": cookie.secure,
                "httponly": "httponly" in {key.lower() for key in cookie._rest.keys()},
            }
            for cookie in cookie_jar
            if cookie.domain in allowed_domains
        ]
        if not cookies:
            raise RuntimeError("Superset login completed but no session cookies were returned.")
        return resolved_target, cookies

    def _prune_embed_tickets(self) -> None:
        now = time.time()
        expired = [ticket for ticket, payload in self._embed_tickets.items() if float(payload.get("expires_at", 0)) <= now]
        for ticket in expired:
            self._embed_tickets.pop(ticket, None)

    def _request_json(self, path: str, *, method: str = "GET", token: str | None = None, payload: dict | None = None) -> dict:
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = Request(f"{self.settings.superset_url.rstrip('/')}{path}", data=data, headers=headers, method=method)
        with urlopen(request, timeout=10) as response:
            body = response.read().decode("utf-8")
        return json.loads(body) if body else {}

    def _login_token(self) -> str | None:
        try:
            payload = {
                "username": self.settings.superset_username,
                "password": self.settings.superset_password,
                "provider": "db",
                "refresh": True,
            }
            response = self._request_json("/api/v1/security/login", method="POST", payload=payload)
            return response.get("access_token")
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, Exception):  # noqa: BLE001
            return None

    def list_databases(self) -> list[dict]:
        token = self._login_token()
        if not token:
            return []
        try:
            query = quote("(page:0,page_size:200)")
            payload = self._request_json(f"/api/v1/database/?q={query}", token=token)
            results = payload.get("result", [])
            return results if isinstance(results, list) else []
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, Exception):  # noqa: BLE001
            return []

    def get_connection_target(self) -> dict:
        runtime_state = self.read_runtime_state()
        serving_catalog = superset_catalog_service.get_status()
        mode = runtime_state.get("mode", "unknown")
        sqlalchemy_uri = (
            serving_catalog["container_sqlalchemy_uri"]
            if mode == "docker"
            else serving_catalog["host_sqlalchemy_uri"]
        )
        return {
            "name": self.connection_name,
            "runtime_mode": mode,
            "sqlalchemy_uri": sqlalchemy_uri,
            "database_path": serving_catalog.get("database_path"),
        }

    def get_connection_status(self) -> dict:
        target = self.get_connection_target()
        databases = self.list_databases()
        matching = next((item for item in databases if item.get("database_name") == target["name"]), None)
        return {
            "name": target["name"],
            "runtime_mode": target["runtime_mode"],
            "expected_sqlalchemy_uri": target["sqlalchemy_uri"],
            "database_path": target["database_path"],
            "provisioned": matching is not None,
            "database_id": matching.get("id") if matching else None,
            "found_sqlalchemy_uri": matching.get("sqlalchemy_uri") if matching else None,
            "backend": matching.get("backend") if matching else None,
            "expose_in_sqllab": matching.get("expose_in_sqllab") if matching else None,
        }

    def provision_serving_catalog_connection(self) -> dict:
        target = self.get_connection_target()
        mode = target["runtime_mode"]
        sqlalchemy_uri = target["sqlalchemy_uri"]

        if mode == "docker":
            command = [
                "docker",
                "compose",
                "exec",
                "-T",
                "superset",
                "superset",
                "set-database-uri",
                "-d",
                self.connection_name,
                "-u",
                sqlalchemy_uri,
            ]
            result = subprocess.run(  # noqa: S603
                command,
                cwd=ROOT_DIR,
                capture_output=True,
                text=True,
                check=False,
            )
        else:
            command_prefix = self._native_superset_command()
            if not command_prefix:
                status = self.get_connection_status()
                status["command_succeeded"] = False
                status["stdout"] = ""
                status["stderr"] = "Native Superset runtime is not installed yet. Start DataWizz again and wait for Superset bootstrap to finish."
                return status
            env = os.environ.copy()
            env["SUPERSET_CONFIG_PATH"] = str(self.superset_config_path)
            env["SUPERSET_SECRET_KEY"] = "datawizz-local-superset-demo-secret-2026"
            env["SUPERSET_HOME"] = str(self.superset_native_home)
            env["SUPERSET_NATIVE_DATABASE_URI"] = f"sqlite:///{self.superset_native_db}"
            command = command_prefix + [
                "set-database-uri",
                "-d",
                self.connection_name,
                "-u",
                sqlalchemy_uri,
            ]
            result = subprocess.run(  # noqa: S603
                command,
                cwd=ROOT_DIR,
                capture_output=True,
                text=True,
                check=False,
                env=env,
            )

        status = self.get_connection_status()
        status["command_succeeded"] = result.returncode == 0
        status["stdout"] = result.stdout.strip()
        status["stderr"] = result.stderr.strip()
        return status


superset_runtime_service = SupersetRuntimeService()

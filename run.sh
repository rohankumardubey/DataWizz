#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
RUNTIME_DIR="$ROOT_DIR/.runtime"
DATAWIZZ_CACHE_DIR="${DATAWIZZ_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/datawizz}"
LOCAL_DATABASE_PATH="${DATAWIZZ_LOCAL_DATABASE_PATH:-$DATAWIZZ_CACHE_DIR/local/metadata.db}"
SUPERSET_VENV_DIR="${SUPERSET_VENV_DIR:-$DATAWIZZ_CACHE_DIR/superset/6.1.0/venv}"
SUPERSET_NATIVE_HOME="$ROOT_DIR/storage/temp/superset/home"
SUPERSET_NATIVE_DB="$ROOT_DIR/storage/temp/superset/superset.db"
SUPERSET_CONFIG_FILE="$ROOT_DIR/docker/superset/superset_config.py"
SUPERSET_RUNTIME_STATE_FILE="$RUNTIME_DIR/superset-runtime.json"
SUPERSET_NATIVE_PID_FILE="$RUNTIME_DIR/superset-native.pid"
SUPERSET_PROVISION_PID_FILE="$RUNTIME_DIR/superset-provision.pid"
SUPERSET_PREPARED_MARKER="$SUPERSET_NATIVE_HOME/.datawizz-prepared"
SUPERSET_URL="http://localhost:8088"
SUPERSET_HEALTH_URL="$SUPERSET_URL/health"
SUPERSET_PIP_SPEC="${SUPERSET_PIP_SPEC:-apache-superset==6.1.0}"
SUPERSET_SUPPLEMENTAL_PACKAGES="${SUPERSET_SUPPLEMENTAL_PACKAGES:-cachetools==7.1.4 duckdb==1.5.4 duckdb-engine==0.17.0}"
SUPERSET_BOOTSTRAP_VERSION="2"
SUPERSET_SECRET_KEY_VALUE="datawizz-local-superset-demo-secret-2026"
SUPERSET_DEFAULT_USERNAME="admin"
SUPERSET_DEFAULT_PASSWORD="admin"
SUPERSET_DEFAULT_EMAIL="admin@example.com"
SUPERSET_DEFAULT_FIRSTNAME="Internal"
SUPERSET_DEFAULT_LASTNAME="Admin"

MODE="${1:-auto}"
ARGS=("$@")

mkdir -p "$RUNTIME_DIR"

log() {
  printf '[run.sh] %s\n' "$1"
}

write_superset_runtime_state() {
  local mode="$1"
  local status="${2:-starting}"
  cat >"$SUPERSET_RUNTIME_STATE_FILE" <<EOF
{
  "mode": "$mode",
  "status": "$status",
  "superset_url": "$SUPERSET_URL",
  "native_venv": "$SUPERSET_VENV_DIR",
  "updated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
}

clear_superset_runtime_state() {
  rm -f "$SUPERSET_RUNTIME_STATE_FILE"
}

stop_pid_from_file() {
  local pid_file="$1"
  local label="$2"
  local pid
  local command_line

  [[ -f "$pid_file" ]] || return 0
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ -n "$pid" ]] || {
    rm -f "$pid_file"
    return 0
  }

  if pid_is_running "$pid"; then
    command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ -z "$command_line" || ( "$command_line" != *"$ROOT_DIR"* && "$command_line" != *"superset"* ) ]]; then
      log "Ignoring stale $label PID file because pid $pid is owned by another process"
      rm -f "$pid_file"
      return 0
    fi
    log "Stopping $label (pid $pid)"
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if pid_is_running "$pid"; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  fi

  rm -f "$pid_file"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "Missing required command: $1"
    exit 1
  fi
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

pick_backend_python() {
  local requested="${DATAWIZZ_PYTHON_BIN:-}"
  local candidate

  for candidate in "$requested" python3.13 python3.12 python3.11 python3; do
    [[ -n "$candidate" ]] || continue
    command_exists "$candidate" || continue
    if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  return 1
}

backend_venv_is_compatible() {
  [[ -x "$BACKEND_DIR/.venv/bin/python" ]] || return 1
  "$BACKEND_DIR/.venv/bin/python" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1
}

pid_is_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

print_port_owner() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN || true
}

http_ready() {
  local url="$1"
  curl --fail --silent --show-error --max-time 1 --output /dev/null "$url" >/dev/null 2>&1
}

backend_ready() {
  http_ready "http://localhost:8000/health/ready"
}

wait_for_http_ready() {
  local url="$1"
  local attempts="${2:-30}"
  local delay="${3:-1}"

  for _ in $(seq 1 "$attempts"); do
    if http_ready "$url"; then
      return 0
    fi
    sleep "$delay"
  done

  return 1
}

wait_for_process_http_ready() {
  local url="$1"
  local pid_file="$2"
  local attempts="${3:-60}"
  local delay="${4:-1}"
  local pid

  for _ in $(seq 1 "$attempts"); do
    if http_ready "$url"; then
      return 0
    fi

    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -z "$pid" ]] || ! pid_is_running "$pid"; then
      return 2
    fi
    sleep "$delay"
  done

  return 1
}

docker_ready() {
  command_exists docker && docker info >/dev/null 2>&1
}

should_force_restart() {
  for arg in "${ARGS[@]:1}"; do
    [[ "$arg" == "--restart" ]] && return 0
  done
  return 1
}

wants_superset() {
  for arg in "${ARGS[@]:1}"; do
    [[ "$arg" == "--no-superset" || "$arg" == "nosuperset" ]] && return 1
  done
  for arg in "${ARGS[@]:1}"; do
    [[ "$arg" == "superset" ]] && return 0
  done
  return 0
}

wants_native_superset() {
  [[ "${SUPERSET_RUNTIME:-}" == "native" ]] && return 0
  for arg in "${ARGS[@]:1}"; do
    [[ "$arg" == "native" ]] && return 0
  done
  return 1
}

release_port() {
  local port="$1"
  local pids
  local -a pid_list

  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN | tr '\n' ' ' | xargs 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  log "Port $port is in use. Stopping existing process(es): $pids"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN || true
  read -r -a pid_list <<<"$pids"
  kill "${pid_list[@]}" >/dev/null 2>&1 || true
  sleep 1

  if port_in_use "$port"; then
    log "Force stopping remaining process(es) on port $port"
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN | tr '\n' ' ' | xargs 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      read -r -a pid_list <<<"$pids"
      kill -9 "${pid_list[@]}" >/dev/null 2>&1 || true
      sleep 1
    fi
  fi

  if port_in_use "$port"; then
    log "Unable to free port $port"
    print_port_owner "$port"
    exit 1
  fi
}

start_docker() {
  require_cmd docker
  log "Starting Docker stack from $ROOT_DIR"
  if wants_superset; then
    write_superset_runtime_state "docker"
    docker compose --profile superset up --build
  else
    clear_superset_runtime_state
    docker compose up --build
  fi
}

pick_superset_python() {
  local requested="${SUPERSET_PYTHON_BIN:-}"
  local candidate version

  for candidate in "$requested" python3.13 python3.12 python3.11 python3; do
    [[ -n "$candidate" ]] || continue
    command_exists "$candidate" || continue
    version="$("$candidate" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || true)"
    [[ -n "$version" ]] || continue
    if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  return 1
}

with_superset_env() {
  export SUPERSET_CONFIG_PATH="$SUPERSET_CONFIG_FILE"
  export SUPERSET_SECRET_KEY="$SUPERSET_SECRET_KEY_VALUE"
  export SUPERSET_HOME="$SUPERSET_NATIVE_HOME"
  export SUPERSET_NATIVE_DATABASE_URI="sqlite:///$SUPERSET_NATIVE_DB"
}

superset_venv_matches_workspace() {
  [[ -x "$SUPERSET_VENV_DIR/bin/python" ]] || return 1
  "$SUPERSET_VENV_DIR/bin/python" -c \
    'import pathlib, sys; raise SystemExit(0 if pathlib.Path(sys.prefix).resolve() == pathlib.Path(sys.argv[1]).resolve() else 1)' \
    "$SUPERSET_VENV_DIR"
}

superset_packages_ready() {
  [[ -x "$SUPERSET_VENV_DIR/bin/python" ]] || return 1
  "$SUPERSET_VENV_DIR/bin/python" - "$SUPERSET_PIP_SPEC" "$SUPERSET_SUPPLEMENTAL_PACKAGES" <<'PY' >/dev/null 2>&1
import re
import sys
from importlib.metadata import PackageNotFoundError, version

requirements = [sys.argv[1], *sys.argv[2].split()]
for requirement in requirements:
    match = re.fullmatch(r"([A-Za-z0-9_.-]+)==([^; ]+)", requirement)
    if match is None:
        raise SystemExit(1)
    try:
        installed = version(match.group(1))
    except PackageNotFoundError:
        raise SystemExit(1)
    if installed != match.group(2):
        raise SystemExit(1)
PY
}

superset_admin_exists() {
  "$SUPERSET_VENV_DIR/bin/superset" fab list-users 2>/dev/null | grep -q "^username:${SUPERSET_DEFAULT_USERNAME}\\b"
}

superset_runtime_spec() {
  printf '%s|%s' "$SUPERSET_PIP_SPEC" "$SUPERSET_SUPPLEMENTAL_PACKAGES"
}

superset_bootstrap_spec() {
  printf '%s|bootstrap=%s' "$(superset_runtime_spec)" "$SUPERSET_BOOTSTRAP_VERSION"
}

superset_metadata_ready() {
  [[ -s "$SUPERSET_NATIVE_DB" ]] || return 1
  [[ -f "$SUPERSET_PREPARED_MARKER" ]] || return 1
  [[ "$(cat "$SUPERSET_PREPARED_MARKER" 2>/dev/null || true)" == "$(superset_bootstrap_spec)" ]]
}

install_native_superset_packages() {
  local install_log="$1"
  local -a supplemental_package_list

  read -r -a supplemental_package_list <<<"$SUPERSET_SUPPLEMENTAL_PACKAGES"
  if command_exists uv; then
    log "Installing the cached Superset runtime with uv"
    uv pip install \
      --python "$SUPERSET_VENV_DIR/bin/python" \
      "$SUPERSET_PIP_SPEC" \
      "${supplemental_package_list[@]}" 2>&1 | tee "$install_log"
  else
    log "Installing the cached Superset runtime with pip"
    (
      "$SUPERSET_VENV_DIR/bin/python" -m pip install --upgrade pip setuptools wheel
      "$SUPERSET_VENV_DIR/bin/python" -m pip install \
        "$SUPERSET_PIP_SPEC" \
        "${supplemental_package_list[@]}"
    ) 2>&1 | tee "$install_log"
  fi
}

ensure_native_superset() {
  local superset_python
  local deps_marker="$SUPERSET_VENV_DIR/.deps-installed"
  local version_marker="$SUPERSET_VENV_DIR/.superset-version"
  local runtime_spec
  local bootstrap_spec
  local admin_marker="$RUNTIME_DIR/.superset-admin-created"
  local install_log="$RUNTIME_DIR/superset-install.log"
  local init_log="$RUNTIME_DIR/superset-init.log"

  runtime_spec="$(superset_runtime_spec)"
  bootstrap_spec="$(superset_bootstrap_spec)"
  superset_python="$(pick_superset_python)" || {
    log "Superset native mode requires Python 3.11+ on PATH. Set SUPERSET_PYTHON_BIN if you want to force a specific interpreter."
    exit 1
  }

  mkdir -p "$SUPERSET_NATIVE_HOME" "$(dirname "$SUPERSET_NATIVE_DB")" "$(dirname "$SUPERSET_VENV_DIR")"

  if [[ -d "$SUPERSET_VENV_DIR" ]] && ! superset_venv_matches_workspace; then
    log "Rebuilding an invalid cached Superset virtual environment"
    rm -rf "$SUPERSET_VENV_DIR"
  fi

  if [[ ! -d "$SUPERSET_VENV_DIR" ]]; then
    log "Creating a machine-local Superset cache outside the synced repository"
    if command_exists uv; then
      uv venv --python "$superset_python" "$SUPERSET_VENV_DIR" >"$install_log" 2>&1
    else
      "$superset_python" -m venv "$SUPERSET_VENV_DIR"
    fi
  fi

  if ! superset_packages_ready || [[ "$(cat "$version_marker" 2>/dev/null || true)" != "$runtime_spec" ]]; then
    log "Preparing native Superset packages ($SUPERSET_PIP_SPEC)"
    install_native_superset_packages "$install_log" || {
      log "Native Superset installation failed. See $install_log"
      exit 1
    }
    printf '%s' "$runtime_spec" >"$version_marker"
    touch "$deps_marker"
  fi

  if superset_metadata_ready && [[ "${SUPERSET_REINITIALIZE:-0}" != "1" ]]; then
    log "Superset is already prepared; skipping migrations and admin bootstrap"
    return 0
  fi

  if [[ ! -f "$SUPERSET_PREPARED_MARKER" && -s "$SUPERSET_NATIVE_DB" && -f "$admin_marker" && "${SUPERSET_REINITIALIZE:-0}" != "1" ]]; then
    log "Adopting the existing initialized Superset metadata"
    printf '%s' "$bootstrap_spec" >"$SUPERSET_PREPARED_MARKER"
    return 0
  fi

  log "Running one-time Superset metadata and admin bootstrap"
  (
    with_superset_env
    "$SUPERSET_VENV_DIR/bin/superset" db upgrade
    if ! superset_admin_exists; then
      "$SUPERSET_VENV_DIR/bin/superset" fab create-admin \
        --username "$SUPERSET_DEFAULT_USERNAME" \
        --firstname "$SUPERSET_DEFAULT_FIRSTNAME" \
        --lastname "$SUPERSET_DEFAULT_LASTNAME" \
        --email "$SUPERSET_DEFAULT_EMAIL" \
        --password "$SUPERSET_DEFAULT_PASSWORD"
    else
      "$SUPERSET_VENV_DIR/bin/superset" fab reset-password \
        --username "$SUPERSET_DEFAULT_USERNAME" \
        --password "$SUPERSET_DEFAULT_PASSWORD"
    fi
    touch "$admin_marker"
    "$SUPERSET_VENV_DIR/bin/superset" init
    printf '%s' "$bootstrap_spec" >"$SUPERSET_PREPARED_MARKER"
  ) >"$init_log" 2>&1 || {
    log "Native Superset initialization failed. See $init_log"
    exit 1
  }
}

start_superset_sidecar() {
  local superset_log="$RUNTIME_DIR/superset-bootstrap.log"
  write_superset_runtime_state "docker"

  if http_ready "$SUPERSET_HEALTH_URL"; then
    log "Superset already reachable at $SUPERSET_URL. Reusing existing runtime."
    return 0
  fi

  log "Launching Superset Docker sidecar in the background on $SUPERSET_URL"
  (
    cd "$ROOT_DIR"
    docker compose --profile superset up -d postgres superset
  ) >"$superset_log" 2>&1 &
  log "Superset bootstrap log: $superset_log"
}

start_native_superset() {
  local superset_log="$RUNTIME_DIR/superset-native.log"
  local ready_status
  write_superset_runtime_state "native" "preparing"

  if http_ready "$SUPERSET_HEALTH_URL"; then
    log "Superset already reachable at $SUPERSET_URL. Reusing existing runtime."
    write_superset_runtime_state "native" "healthy"
    return 0
  fi

  if [[ -f "$SUPERSET_NATIVE_PID_FILE" ]]; then
    stop_pid_from_file "$SUPERSET_NATIVE_PID_FILE" "stale native Superset bootstrap"
  fi

  ensure_native_superset

  log "Launching native Superset on $SUPERSET_URL"
  : >"$superset_log"
  (
    with_superset_env
    exec "$SUPERSET_VENV_DIR/bin/gunicorn" \
      --bind 0.0.0.0:8088 \
      --workers 1 \
      --threads 4 \
      --timeout 120 \
      --access-logfile - \
      --error-logfile - \
      "superset.app:create_app()"
  ) >"$superset_log" 2>&1 &
  echo $! >"$SUPERSET_NATIVE_PID_FILE"
  write_superset_runtime_state "native" "starting"
  log "Native Superset log: $superset_log"

  if wait_for_process_http_ready "$SUPERSET_HEALTH_URL" "$SUPERSET_NATIVE_PID_FILE" 60 1; then
    ready_status=0
  else
    ready_status=$?
  fi
  if [[ "$ready_status" -eq 0 ]]; then
    write_superset_runtime_state "native" "healthy"
    log "Superset is healthy at $SUPERSET_URL"
    return 0
  fi

  write_superset_runtime_state "native" "failed"
  if [[ "$ready_status" -eq 2 ]]; then
    log "Superset exited before becoming healthy. Last log lines:"
  else
    log "Superset did not become healthy within 60 seconds. Last log lines:"
  fi
  tail -40 "$superset_log" || true
  stop_pid_from_file "$SUPERSET_NATIVE_PID_FILE" "failed native Superset"
  return 1
}

start_managed_superset() {
  if wants_native_superset; then
    start_native_superset
    return 0
  fi

  if docker_ready; then
    start_superset_sidecar
    return 0
  fi

  log "Docker is unavailable or not running. Falling back to native Superset runtime."
  start_native_superset
}

background_provision_superset_connection() {
  local provision_log="$RUNTIME_DIR/superset-provision.log"

  (
    for _ in $(seq 1 90); do
      if http_ready "$SUPERSET_HEALTH_URL"; then
        break
      fi
      sleep 2
    done

    if ! http_ready "$SUPERSET_HEALTH_URL"; then
      echo "Superset did not become healthy in time for automatic connection provisioning."
      exit 1
    fi

    cd "$BACKEND_DIR"
    # shellcheck disable=SC1091
    source .venv/bin/activate
python - <<'PY'
from app.services.superset_runtime_service import superset_runtime_service

result = superset_runtime_service.get_connection_status()
if not result.get("provisioned"):
    result = superset_runtime_service.provision_serving_catalog_connection()
print(result)
if not result.get("provisioned"):
    raise SystemExit(1)
PY
  ) >"$provision_log" 2>&1 &
  echo $! >"$SUPERSET_PROVISION_PID_FILE"

  log "Superset connection bootstrap log: $provision_log"
}

stop_managed_superset() {
  local runtime_mode

  stop_pid_from_file "$SUPERSET_PROVISION_PID_FILE" "Superset connection bootstrap"

  runtime_mode="$(ROOT_DIR="$ROOT_DIR" python3 - <<'PY'
import os
import json
from pathlib import Path

path = Path(os.environ["ROOT_DIR"]) / ".runtime" / "superset-runtime.json"
if not path.exists():
    print("unknown")
else:
    try:
        print(json.loads(path.read_text(encoding="utf-8")).get("mode", "unknown"))
    except Exception:
        print("unknown")
PY
)"

  case "$runtime_mode" in
    native)
      stop_pid_from_file "$SUPERSET_NATIVE_PID_FILE" "native Superset"
      ;;
    docker)
      if docker_ready; then
        log "Stopping managed Superset containers"
        (
          cd "$ROOT_DIR"
          docker compose --profile superset stop superset postgres
        ) >/dev/null 2>&1 || true
      fi
      ;;
  esac

  clear_superset_runtime_state
}

ensure_backend_env() {
  local deps_marker="$BACKEND_DIR/.venv/.deps-installed"
  local backend_python

  backend_python="$(pick_backend_python)" || {
    log "DataWizz requires Python 3.11 or newer. Install Python 3.11+ or set DATAWIZZ_PYTHON_BIN to a compatible interpreter."
    exit 1
  }

  if [[ -d "$BACKEND_DIR/.venv" ]] && ! backend_venv_is_compatible; then
    log "Rebuilding backend virtual environment because it does not use Python 3.11+"
    rm -rf "$BACKEND_DIR/.venv"
  fi

  if [[ ! -d "$BACKEND_DIR/.venv" ]]; then
    log "Creating backend virtual environment with $backend_python"
    "$backend_python" -m venv "$BACKEND_DIR/.venv"
  fi

  if [[ ! -f "$deps_marker" || "$BACKEND_DIR/pyproject.toml" -nt "$deps_marker" ]]; then
    log "Installing backend dependencies"
    (
      cd "$BACKEND_DIR"
      # shellcheck disable=SC1091
      source .venv/bin/activate
      pip install -e '.[dev]'
      touch .venv/.deps-installed
    )
  fi

  if [[ ! -f "$BACKEND_DIR/.env" && -f "$BACKEND_DIR/.env.example" ]]; then
    log "Creating backend .env from template"
    cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
  fi
}

ensure_frontend_env() {
  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    log "Installing frontend dependencies"
    (
      cd "$FRONTEND_DIR"
      npm install
    )
  fi

  if [[ ! -f "$FRONTEND_DIR/.env" && -f "$FRONTEND_DIR/.env.example" ]]; then
    log "Creating frontend .env from template"
    cp "$FRONTEND_DIR/.env.example" "$FRONTEND_DIR/.env"
  fi
}

ensure_local_database() {
  local database_dir

  database_dir="$(dirname "$LOCAL_DATABASE_PATH")"
  mkdir -p "$database_dir"
  chmod u+rwx "$database_dir"

  if [[ ! -f "$LOCAL_DATABASE_PATH" && -f "$BACKEND_DIR/local.db" ]]; then
    log "Seeding machine-local SQLite metadata from backend/local.db"
    cp "$BACKEND_DIR/local.db" "$LOCAL_DATABASE_PATH"
  fi

  if [[ -f "$LOCAL_DATABASE_PATH" ]]; then
    chmod u+rw "$LOCAL_DATABASE_PATH"
  fi
}

start_local() {
  require_cmd python3
  require_cmd npm
  require_cmd lsof
  require_cmd curl

  ensure_backend_env
  ensure_frontend_env
  ensure_local_database

  local backend_log="$RUNTIME_DIR/backend.log"
  local frontend_log="$RUNTIME_DIR/frontend.log"
  local backend_pid_file="$RUNTIME_DIR/backend.pid"
  local frontend_pid_file="$RUNTIME_DIR/frontend.pid"
  local backend_port=8000
  local frontend_port=5173
  local backend_url="http://localhost:$backend_port/docs"
  local frontend_url="http://localhost:$frontend_port"
  local backend_started=false
  local frontend_started=false
  local cleanup_ran=false

  cleanup() {
    if [[ "${cleanup_ran:-false}" == true ]]; then
      return 0
    fi
    cleanup_ran=true
    log "Stopping local services"
    if [[ "${backend_started:-false}" == true && -f "$backend_pid_file" ]]; then
      kill "$(cat "$backend_pid_file")" >/dev/null 2>&1 || true
      rm -f "$backend_pid_file"
    fi
    if [[ "${frontend_started:-false}" == true && -f "$frontend_pid_file" ]]; then
      kill "$(cat "$frontend_pid_file")" >/dev/null 2>&1 || true
      rm -f "$frontend_pid_file"
    fi
    if wants_superset; then
      stop_managed_superset
    fi
  }

  trap cleanup EXIT
  trap 'exit 130' INT TERM

  if should_force_restart; then
    log "Force restart requested. Releasing local ports before launch."
    release_port "$backend_port"
    release_port "$frontend_port"
  fi

  if port_in_use "$backend_port"; then
    if backend_ready; then
      log "Backend already running and database-write ready at $backend_url. Reusing existing process."
    else
      log "Backend port $backend_port is occupied but not database-write ready. Restarting backend."
      release_port "$backend_port"
    fi
  fi

  if port_in_use "$frontend_port"; then
    if http_ready "$frontend_url"; then
      log "Frontend already running at $frontend_url. Reusing existing process."
    else
      log "Frontend port $frontend_port is occupied but not healthy. Restarting frontend."
      release_port "$frontend_port"
    fi
  fi

  if ! port_in_use "$backend_port"; then
    log "Starting backend on http://localhost:$backend_port using SQLite for local demo mode"
    (
      cd "$BACKEND_DIR"
      # shellcheck disable=SC1091
      source .venv/bin/activate
      DATABASE_URL="sqlite:///$LOCAL_DATABASE_PATH" \
        uvicorn app.main:app --reload --reload-dir app --reload-dir alembic --host 0.0.0.0 --port "$backend_port"
    ) >"$backend_log" 2>&1 &
    echo $! >"$backend_pid_file"
    backend_started=true
  fi

  if ! wait_for_http_ready "http://localhost:$backend_port/health/ready" 30 1; then
    log "Backend failed its database-write readiness check. Last log lines:"
    tail -40 "$backend_log" || true
    return 1
  fi

  if ! port_in_use "$frontend_port"; then
    log "Starting frontend on http://localhost:$frontend_port"
    (
      cd "$FRONTEND_DIR"
      npm run dev -- --host 0.0.0.0 --port "$frontend_port" --strictPort
    ) >"$frontend_log" 2>&1 &
    echo $! >"$frontend_pid_file"
    frontend_started=true
  fi

  if wants_superset; then
    start_managed_superset
    background_provision_superset_connection
    if ! http_ready "$SUPERSET_HEALTH_URL" && ! wait_for_http_ready "$SUPERSET_HEALTH_URL" 120 1; then
      log "Superset failed to become healthy. See $RUNTIME_DIR/superset-native.log and $RUNTIME_DIR/superset-init.log."
      return 1
    fi
  else
    clear_superset_runtime_state
  fi

  log "Local platform is launching"
  log "Frontend: http://localhost:$frontend_port"
  log "Backend:  http://localhost:$backend_port"
  log "API Docs:  http://localhost:$backend_port/docs"
  if wants_superset; then
    log "Superset: $SUPERSET_URL"
    log "Embedded BI surface: http://localhost:$frontend_port/bi/superset"
  fi
  log "Backend log:  $backend_log"
  log "Frontend log: $frontend_log"
  if [[ "$backend_started" == false && "$frontend_started" == false ]]; then
    log "Both services were already healthy. Nothing was restarted."
  fi
  if [[ "$backend_started" == false || "$frontend_started" == false ]]; then
    log "Use ./run.sh local --restart if you want to force a full restart."
  fi
  log "Press Ctrl+C to stop local services, including Superset"

  while true; do
    sleep 3600
  done
}

print_usage() {
  cat <<'EOF'
Usage:
  ./run.sh
  ./run.sh auto
  ./run.sh auto nosuperset
  ./run.sh docker
  ./run.sh docker nosuperset
  ./run.sh local
  ./run.sh local nosuperset
  ./run.sh local superset native
  ./run.sh local --restart
  ./run.sh local --restart --no-superset

Modes:
  auto    Use Docker if available, otherwise run local demo mode
  docker  Start the Docker Compose stack
  local   Start backend + frontend locally with SQLite

Superset:
  Superset starts automatically with ./run.sh by default.
  Add "nosuperset" or "--no-superset" to skip it.
  Add "native" to force a local Python Superset runtime without Docker.
EOF
}

case "$MODE" in
  auto)
    if docker_ready; then
      start_docker
    else
      start_local
    fi
    ;;
  docker)
    start_docker
    ;;
  local)
    start_local
    ;;
  help|-h|--help)
    print_usage
    ;;
  *)
    log "Unknown mode: $MODE"
    print_usage
    exit 1
    ;;
esac

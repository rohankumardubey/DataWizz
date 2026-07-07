#!/usr/bin/env python3
"""Tiny local webhook receiver for DataWizz metric-alert delivery demos."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Receive DataWizz webhook POSTs and retain them as JSONL.")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind. Defaults to 127.0.0.1.")
    parser.add_argument("--port", type=int, default=9009, help="Port to listen on. Defaults to 9009.")
    parser.add_argument("--path", default="/datawizz-alerts", help="Webhook path to accept. Defaults to /datawizz-alerts.")
    parser.add_argument(
        "--log-file",
        default=".runtime/webhook-inbox.jsonl",
        help="JSONL file for retained payloads. Defaults to .runtime/webhook-inbox.jsonl.",
    )
    return parser.parse_args()


def build_handler(expected_path: str, log_file: Path) -> type[BaseHTTPRequestHandler]:
    normalized_path = expected_path if expected_path.startswith("/") else f"/{expected_path}"
    log_file.parent.mkdir(parents=True, exist_ok=True)

    class WebhookReceiver(BaseHTTPRequestHandler):
        server_version = "DataWizzWebhookReceiver/1.0"

        def do_GET(self) -> None:  # noqa: N802 - required BaseHTTPRequestHandler hook.
            if self.path not in {"/", "/health", normalized_path}:
                self._send_json(404, {"status": "not_found", "expected_path": normalized_path})
                return
            self._send_json(
                200,
                {
                    "status": "ok",
                    "message": "DataWizz local webhook receiver is running.",
                    "webhook_path": normalized_path,
                    "log_file": str(log_file),
                },
            )

        def do_POST(self) -> None:  # noqa: N802 - required BaseHTTPRequestHandler hook.
            if self.path != normalized_path:
                self._send_json(404, {"status": "not_found", "expected_path": normalized_path})
                return

            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)
            try:
                payload: Any = json.loads(raw_body.decode("utf-8") or "{}")
            except json.JSONDecodeError as exc:
                self._send_json(400, {"status": "invalid_json", "error": str(exc)})
                return

            envelope = {
                "received_at": datetime.now(timezone.utc).isoformat(),
                "client": self.client_address[0],
                "path": self.path,
                "payload": payload,
            }
            with log_file.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(envelope, sort_keys=True) + "\n")

            event_type = payload.get("type") if isinstance(payload, dict) else None
            print(f"[webhook-receiver] received {event_type or 'payload'} -> {log_file}", flush=True)
            self._send_json(202, {"status": "accepted", "received_at": envelope["received_at"]})

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002 - BaseHTTPRequestHandler signature.
            return

        def _send_json(self, status_code: int, payload: dict) -> None:
            body = json.dumps(payload, indent=2).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return WebhookReceiver


def main() -> None:
    args = parse_args()
    log_file = Path(args.log_file).expanduser().resolve()
    handler = build_handler(args.path, log_file)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(
        "[webhook-receiver] listening on "
        f"http://{args.host}:{args.port}{args.path} and writing payloads to {log_file}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[webhook-receiver] stopping", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

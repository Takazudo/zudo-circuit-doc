#!/usr/bin/env python3
"""Validate a project's component evidence against contract v1.

Usage: python3 -B circuit_validate.py --config <resolved.json | -> [--online | --refresh-source ID ...] [--json]
Exit 0 = PASS, 1 = FAIL (any error, never a traceback), 2 = usage error.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from circuit_evidence.errors import ContractError  # noqa: E402
from circuit_evidence.orchestrator import Report, validate  # noqa: E402


def parse_args(argv):
    parser = argparse.ArgumentParser(prog="circuit_validate.py", description="Validate component evidence against contract v1.")
    parser.add_argument("--config", required=True, metavar="PATH", help="resolved-config JSON file, or - to read it from stdin")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--online", action="store_true", help="opt in to re-downloading every AVAILABLE source and checking its hash")
    mode.add_argument("--refresh-source", action="append", default=[], metavar="SOURCE_ID", help="opt in to refreshing one exact AVAILABLE source ID; repeatable")
    parser.add_argument("--json", action="store_true", help="emit the result as one JSON object on stdout")
    return parser.parse_args(argv)


def read_config(path):
    text = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    return json.loads(text)


def failure_message(exc):
    if isinstance(exc, ContractError):
        return str(exc)
    if isinstance(exc, KeyError):
        return f"missing key {exc}"
    return f"{type(exc).__name__}: {exc}"


def emit(report, as_json, message=None):
    if as_json:
        payload = {
            "status": "FAIL" if message is not None else "PASS",
            "scope": report.scope, "skip": report.skip, "warn": report.warn,
            "lines": report.lines, "offline": report.offline, "refreshed": report.refreshed,
        }
        if message is not None:
            payload["message"] = message
        print(json.dumps(payload, indent=2))
        return
    for line in report.prefixed_lines():
        print(line)
    if message is None:
        print(report.pass_line())
    else:
        print(f"FAIL: {message}", file=sys.stderr)


def main(argv=None):
    args = parse_args(argv)
    report = Report()
    as_json = args.json
    try:
        config = read_config(args.config)
        as_json = as_json or (isinstance(config, dict) and isinstance(config.get("output"), dict) and config["output"].get("json") is True)
        validate(config, online=args.online, refresh_source_ids=args.refresh_source, report=report)
    except Exception as exc:  # noqa: BLE001 - every failure is reported as FAIL, never a traceback
        emit(report, as_json, failure_message(exc))
        return 1
    emit(report, as_json)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

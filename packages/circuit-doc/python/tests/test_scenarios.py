"""Acceptance-scenario gaps (#32) not already carried by another issue's test name.

See doc/src/content/docs/release/scenario-matrix.mdx for the full 31-ID traceability
matrix; this file only holds the checks that had no home elsewhere. Every test name
starts with its scenario ID.
"""

from __future__ import annotations

import hashlib
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parent.parent
PACKAGE_DIR = PYTHON_DIR.parent
REPO_ROOT = PACKAGE_DIR.parent.parent
sys.path.insert(0, str(PYTHON_DIR))

import circuit_evidence as validator  # noqa: E402

from generic_project import bundle_for, line, make_project, run_cli  # noqa: E402

SCHEMA = PACKAGE_DIR / "contract/schema.json"
SELFTEST = validator.SELFTEST_DIR
WORKFLOW_MD = REPO_ROOT / "examples/minimal/circuit/WORKFLOW.md"
# A payload whose SHA-256 is what the fixture's source record locks — never actually
# served by the misbehaving server below, so any response fails the hash check.
PDF_PAYLOAD = b"%PDF-1.4 the real datasheet bytes, never served by SRC-01's server\n"


def golden():
    return validator.load(SELFTEST / "golden/critical-facts.json")


class MisservingSource:
    """A local http.server standing in for a datasheet URL that never serves a PDF.

    Never the internet: SRC-01 is about a URL that returns HTML (or an error page)
    instead of a document, so the fixture serves exactly that.
    """

    def __init__(self, body, *, status=200, content_type="text/html"):
        self.body = body
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(outer.body)))
                self.end_headers()
                self.wfile.write(outer.body)

            def log_message(self, *_args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_args):
        self.server.shutdown()
        self.server.server_close()

    def url(self, name):
        return f"http://127.0.0.1:{self.server.server_address[1]}/{name}"


def src01_project(root, server_url):
    part = line("line-src01", "SRC01-100", "Test Maker", owner="component-src01", source_state="AVAILABLE")
    bundle = bundle_for(part, suffix="src01")
    source = bundle["sources"][0]
    # The recorded hash locks the real PDF's bytes; whatever this server actually
    # serves, it is never those bytes, so a refresh can never fabricate a PASS.
    source.update({"availability": "AVAILABLE", "sha256": hashlib.sha256(PDF_PAYLOAD).hexdigest(), "authoritative_url": server_url})
    return make_project(root / "project", [part], bundles={"component-src01": bundle})


class Src01Tests(unittest.TestCase):
    """SRC-01: a datasheet URL that returns HTML or an error page, never a PDF."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def test_src_01_html_page_at_a_pdf_url_fails_and_marks_nothing_available(self):
        html = b"<html><body>Please sign in to view this datasheet.</body></html>"
        with MisservingSource(html, content_type="text/html") as server:
            config = src01_project(self.root, server.url("datasheet.pdf"))
            result = run_cli("--config", "-", "--refresh-source", "src-src01", config=config)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn("FAIL: src-src01: stale online hash", result.stderr)
            self.assertNotIn("Traceback", result.stdout + result.stderr)
            self.assertNotIn("PASS", result.stdout)

    def test_src_01_error_page_at_a_pdf_url_fails_cleanly(self):
        error_page = b"<html><body>500 Internal Server Error</body></html>"
        with MisservingSource(error_page, status=500, content_type="text/html") as server:
            config = src01_project(self.root, server.url("datasheet.pdf"))
            result = run_cli("--config", "-", "--refresh-source", "src-src01", config=config)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertTrue(result.stderr.startswith("FAIL: "))
            self.assertNotIn("Traceback", result.stdout + result.stderr)
            self.assertNotIn("PASS", result.stdout)

    def test_src_01_workflow_c_documents_the_pdf_magic_byte_check(self):
        text = WORKFLOW_MD.read_text(encoding="utf-8")
        section = text.split("## Workflow C", 1)[1].split("## Workflow D", 1)[0]
        self.assertIn("%PDF-", section)
        self.assertIn("Reject HTML posing as a PDF", section)


class Fact03Tests(unittest.TestCase):
    """FACT-03 (limit): arithmetic recompute is numerically exact even when an
    input's unit is wrong — the contract proves arithmetic, never dimensions.
    Record FACT-03 as automated (limit) + agent/engineering review (documented);
    never as fully automated (see the scenario matrix).
    """

    def setUp(self):
        self.schema = validator.load(SCHEMA)

    def test_fact_03_unit_mismatch_still_passes_the_arithmetic_recompute(self):
        data = golden()
        limit = next(f for f in data["facts"] if f["fact_id"] == "fact-golden-limit")
        margin = next(f for f in data["facts"] if f["fact_id"] == "fact-golden-margin")
        self.assertEqual(limit["unit"], "V")
        self.assertEqual(margin["expression"], "fact_golden_limit - fact_golden_project")
        # Numerically unchanged (still 20), but now semantically the wrong unit for
        # this expression's assumption (millivolts, not volts) — the recompute below
        # only checks the number, so it does not, and cannot, catch this.
        limit["unit"] = "mV"
        validator.validate_golden(data, self.schema, False)  # does not raise

    def test_fact_03_contract_never_claims_a_dimensional_result(self):
        forbidden = ("dimensionally checked", "dimensionally verified", "dimension checked", "units verified", "unit-checked", "units checked")
        offenders = []
        py_files = [PYTHON_DIR / "circuit_validate.py", *Path(validator.__file__).parent.rglob("*.py")]
        for py_file in py_files:
            text = py_file.read_text(encoding="utf-8").casefold()
            for phrase in forbidden:
                if phrase in text:
                    offenders.append(f"{py_file}: {phrase!r}")
        self.assertEqual(offenders, [])

    def test_fact_03_workflow_e_keeps_the_dimensional_review_step(self):
        text = WORKFLOW_MD.read_text(encoding="utf-8")
        section = text.split("## Workflow E", 1)[1].split("## Workflow F", 1)[0]
        self.assertIn("does not prove dimensional correctness", section)


if __name__ == "__main__":
    unittest.main()

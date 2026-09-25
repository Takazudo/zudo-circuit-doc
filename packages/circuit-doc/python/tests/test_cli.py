import copy
import hashlib
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from generic_project import USER_AGENT, bundle_for, line, make_project, run_cli, write_json

EMPTY_SCOPE = "SCOPE: inventory provider=manual; schematic/placement binding not performed (0 lines, 0 declared placements unverified); pin-asset check not performed: cad disabled"
CAD_SKIP = "SKIP: pin-asset check not performed: cad disabled"
PAYLOAD = b"%PDF-1.4 synthetic datasheet\n"


class SourceServer:
    """A local http.server standing in for every authoritative URL; never the internet."""

    def __init__(self):
        self.requests = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                outer.requests.append((self.path, self.headers.get("User-Agent", "")))
                self.send_response(200)
                self.send_header("Content-Type", "application/pdf")
                self.send_header("Content-Length", str(len(PAYLOAD)))
                self.end_headers()
                self.wfile.write(PAYLOAD)

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


class CliTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def assert_fail(self, result, message):
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn(f"FAIL: {message}", result.stderr)
        self.assertNotIn("Traceback", result.stderr + result.stdout)

    def test_empty_project_passes_via_stdin_with_scope_and_skip_lines(self):
        result = run_cli("--config", "-", config=make_project(self.root))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), [EMPTY_SCOPE, CAD_SKIP, "PASS: component-spec contract; 0 lines; offline=True; refreshed=none"])
        self.assertEqual(result.stderr, "")

    def test_config_file_path_and_json_output(self):
        config_path = write_json(self.root / "resolved.json", make_project(self.root / "project"))
        result = run_cli("--config", str(config_path), "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], "PASS")
        self.assertEqual((payload["lines"], payload["offline"], payload["refreshed"]), (0, True, "none"))
        self.assertEqual(payload["skip"], [CAD_SKIP.removeprefix("SKIP: ")])
        self.assertEqual(payload["scope"], [EMPTY_SCOPE.removeprefix("SCOPE: ")])
        config = make_project(self.root / "project-2")
        config["output"]["json"] = True
        self.assertEqual(json.loads(run_cli("--config", "-", config=config).stdout)["status"], "PASS")

    def test_missing_inventory_fails_naming_the_path(self):
        config = make_project(self.root)
        Path(config["inventory"]["path"]).unlink()
        self.assert_fail(run_cli("--config", "-", config=config), f"inventory: configured file is missing: {config['inventory']['path']}")

    def test_malformed_json_fails_without_traceback(self):
        config = make_project(self.root)
        Path(config["inventory"]["path"]).write_text("{not json", encoding="utf-8")
        self.assert_fail(run_cli("--config", "-", config=config), "JSONDecodeError")
        self.assert_fail(run_cli("--config", "-", stdin="{broken"), "JSONDecodeError")
        self.assert_fail(run_cli("--config", str(self.root / "absent.json")), "FileNotFoundError")

    def test_every_exception_type_becomes_fail(self):
        config = make_project(self.root)
        write_json(config["inventory"]["path"], {"schema_version": 1, "generator_specs": [], "assertions": [], "exclusions": [], "lines": []})
        self.assert_fail(run_cli("--config", "-", config=config), "inventory assertions: must be an object")
        broken = copy.deepcopy(config)
        del broken["cad"]["enabled"]
        self.assert_fail(run_cli("--config", "-", config=broken), "config cad: missing keys ['enabled']")
        self.assert_fail(run_cli("--config", "-", stdin="[]"), "config: top level must be an object")
        rules = make_project(self.root / "rules")
        write_json(rules["integration"]["rulesPath"], {"schema_version": 1, "rules": [{"rule_id": "r", "domain": "d", "record_ids": 5, "fact_ids": [], "conditions": "c", "verdict": "UNSOURCED", "refusal": "no"}]})
        self.assert_fail(run_cli("--config", "-", config=rules), "TypeError: 'int' object is not iterable")
        forward = make_project(self.root / "forward", forward_tests={"schema_version": 1, "cases": [], "negative_routes": [{"expected_line_ids": []}]})
        self.assert_fail(run_cli("--config", "-", config=forward), "missing key 'query'")

    def test_invalid_c_number_fails(self):
        part = line("line-a", "TST-100", "Test Maker", lcsc="X123", owner="component-a")
        result = run_cli("--config", "-", config=make_project(self.root, [part]))
        self.assertEqual(result.returncode, 1)
        self.assertTrue(result.stderr.startswith("FAIL: "))
        self.assertNotIn("Traceback", result.stderr)

    def test_warn_lines_precede_pass(self):
        part = line("line-a", "TST-100", "Test Maker", owner="component-a", source_state="AVAILABLE")
        lines = run_cli("--config", "-", config=make_project(self.root, [part])).stdout.splitlines()
        self.assertEqual([item.split(":", 1)[0] for item in lines], ["SCOPE", "SKIP", "WARN", "PASS"])
        self.assertTrue(lines[2].startswith("WARN: inventory summary for line-a lags evidence: "))
        self.assertEqual(lines[3], "PASS: component-spec contract; 1 lines; offline=True; refreshed=none")

    def test_usage_errors_exit_2(self):
        config_path = write_json(self.root / "resolved.json", make_project(self.root / "project"))
        self.assertEqual(run_cli().returncode, 2)
        result = run_cli("--config", str(config_path), "--online", "--refresh-source", "src-a")
        self.assertEqual(result.returncode, 2)
        self.assertIn("not allowed with argument", result.stderr)

    def online_project(self, server):
        part = line("line-a", "TST-100", "Test Maker", owner="component-a", source_state="AVAILABLE")
        bundle = bundle_for(part, suffix="a")
        stable = bundle["sources"][0]
        stable.update({"availability": "AVAILABLE", "sha256": hashlib.sha256(PAYLOAD).hexdigest(), "authoritative_url": server.url("src-a.pdf")})
        volatile = copy.deepcopy(stable)
        volatile.update({
            "source_id": "src-a-shop", "authority_class": "DISTRIBUTOR_IDENTITY", "authoritative_url": server.url("shop.html"),
            "refresh_policy": "VOLATILE-HTML", "refresh_note": "live distributor HTML is not deterministic", "identity_extract_sha256": "1" * 64,
        })
        bundle["sources"].append(volatile)
        bundle["records"][0]["source_ids"].append("src-a-shop")
        return make_project(self.root / "project", [part], bundles={"component-a": bundle})

    def test_online_skips_volatile_sources_and_uses_the_configured_temp_root(self):
        with SourceServer() as server:
            config = self.online_project(server)
            temp_root = Path(config["online"]["tempRoot"])
            self.assertFalse(temp_root.exists())
            result = run_cli("--config", "-", "--online", config=config)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("SKIP: src-a-shop volatile source not hash-refreshable", result.stdout.splitlines())
            self.assertEqual(result.stdout.splitlines()[-1], "PASS: component-spec contract; 1 lines; offline=False; refreshed=all")
            self.assertTrue(temp_root.is_dir())
            self.assertEqual(list(temp_root.iterdir()), [])
            self.assertEqual([path for path, _agent in server.requests], ["/src-a.pdf"])
            self.assertIn(USER_AGENT, server.requests[0][1])

            result = run_cli("--config", "-", "--refresh-source", "src-a", config=config)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(result.stdout.endswith("offline=False; refreshed=src-a\n"))
            self.assert_fail(run_cli("--config", "-", "--refresh-source", "src-a-shop", config=config), "src-a-shop: volatile source cannot claim deterministic selective refresh")

            config["online"]["skipVolatileInAll"] = False
            self.assert_fail(run_cli("--config", "-", "--online", config=config), "src-a-shop: volatile source cannot claim")

    def test_online_stale_hash_fails(self):
        with SourceServer() as server:
            config = self.online_project(server)
            sources_path = Path(config["bundles"]["root"]) / "component-a/sources.json"
            data = json.loads(sources_path.read_text(encoding="utf-8"))
            data["sources"][0]["sha256"] = "b" * 64
            write_json(sources_path, data)
            self.assert_fail(run_cli("--config", "-", "--refresh-source", "src-a", config=config), "src-a: stale online hash")


if __name__ == "__main__":
    unittest.main()

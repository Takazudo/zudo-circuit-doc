"""The led-generator-v1 inventory profile (ADR-010): inventory lines are bound to schgen
generator specs, which are read by a declarative AST interpreter and never executed.

Specs come only from the provider options (``specs: [{path, board?}]``); a board name is the
spec's evaluated ``PROJECT_NAME`` unless the spec entry overrides it.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path, PurePosixPath

from ..errors import ContractError, require, required_keys
from .common import InventoryProvider, ProviderResult, placements, validate_counts, validate_owner_parity

SPEC_OPTION_KEYS = {"path", "board"}


class ComponentDsl:
    """Interpret only the declarative COMPONENTS prefix of a generator spec."""

    def __init__(self, path):
        self.path = path
        self.env = {}

    def error(self, node, message):
        line = getattr(node, "lineno", "?")
        raise ContractError(f"{self.path}:{line}: unsafe generator syntax: {message}")

    def value(self, node):
        if isinstance(node, ast.Constant) and isinstance(node.value, (str, int, float, bool, type(None))):
            return node.value
        if isinstance(node, ast.Name):
            if node.id in self.env:
                return self.env[node.id]
            self.error(node, f"unknown name {node.id}")
        if isinstance(node, (ast.Tuple, ast.List)):
            result = []
            for item in node.elts:
                if isinstance(item, ast.Starred):
                    expanded = self.value(item.value)
                    require(isinstance(expanded, (tuple, list)), f"{self.path}:{item.lineno}: starred value must be tuple/list")
                    result.extend(expanded)
                else:
                    result.append(self.value(item))
            return tuple(result) if isinstance(node, ast.Tuple) else result
        if isinstance(node, ast.Dict):
            require(all(key is not None for key in node.keys), f"{self.path}:{node.lineno}: dict unpacking is not allowed")
            return {self.value(key): self.value(value) for key, value in zip(node.keys, node.values)}
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            operand = self.value(node.operand)
            require(isinstance(operand, (int, float)), f"{self.path}:{node.lineno}: unary operand must be numeric")
            return operand if isinstance(node.op, ast.UAdd) else -operand
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv)):
            left, right = self.value(node.left), self.value(node.right)
            require(isinstance(left, (int, float)) and isinstance(right, (int, float)), f"{self.path}:{node.lineno}: arithmetic operands must be numeric")
            if isinstance(node.op, ast.Add): return left + right
            if isinstance(node.op, ast.Sub): return left - right
            if isinstance(node.op, ast.Mult): return left * right
            if isinstance(node.op, ast.Div): return left / right
            return left // right
        if isinstance(node, ast.JoinedStr):
            parts = []
            for item in node.values:
                if isinstance(item, ast.Constant) and isinstance(item.value, str):
                    parts.append(item.value)
                elif isinstance(item, ast.FormattedValue) and item.conversion == -1 and item.format_spec is None:
                    parts.append(str(self.value(item.value)))
                else:
                    self.error(item, "unsupported f-string field")
            return "".join(parts)
        self.error(node, type(node).__name__)

    def assign(self, target, value):
        if isinstance(target, ast.Name):
            self.env[target.id] = value
            return
        if isinstance(target, ast.Subscript) and isinstance(target.value, ast.Name) and target.value.id == "COMPONENTS":
            require("COMPONENTS" in self.env and isinstance(self.env["COMPONENTS"], dict), f"{self.path}:{target.lineno}: COMPONENTS not initialized")
            self.env["COMPONENTS"][self.value(target.slice)] = value
            return
        self.error(target, "assignment target")

    def statement(self, statement):
        if isinstance(statement, ast.Assign) and len(statement.targets) == 1:
            self.assign(statement.targets[0], self.value(statement.value))
            return
        if isinstance(statement, ast.For):
            require(isinstance(statement.target, ast.Name), f"{self.path}:{statement.lineno}: range target must be a name")
            call = statement.iter
            require(isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "range" and not call.keywords, f"{self.path}:{statement.lineno}: only range loops are allowed")
            args = [self.value(arg) for arg in call.args]
            require(1 <= len(args) <= 3 and all(isinstance(arg, int) for arg in args), f"{self.path}:{statement.lineno}: range args must be integers")
            require(not statement.orelse, f"{self.path}:{statement.lineno}: for-else is not allowed")
            iterations = range(*args)
            require(len(iterations) <= 10_000, f"{self.path}:{statement.lineno}: range loop exceeds safety limit")
            for item in iterations:
                self.env[statement.target.id] = item
                for child in statement.body:
                    self.statement(child)
            return
        self.error(statement, type(statement).__name__)

    def parse(self):
        try:
            tree = ast.parse(self.path.read_text(encoding="utf-8"), filename=str(self.path))
        except SyntaxError as exc:
            raise ContractError(f"{self.path}:{exc.lineno}: unsafe generator syntax: invalid Python") from exc
        for index, statement in enumerate(tree.body):
            if index == 0 and isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Constant) and isinstance(statement.value.value, str):
                continue
            if isinstance(statement, ast.Assign) and len(statement.targets) == 1 and isinstance(statement.targets[0], ast.Name) and statement.targets[0].id == "NETS":
                for node in ast.walk(statement.value):
                    if isinstance(node, (ast.Attribute, ast.Lambda, ast.NamedExpr)) or (isinstance(node, ast.Call) and not (isinstance(node.func, ast.Name) and node.func.id == "range")):
                        self.error(node, "unsupported executable syntax in ignored NETS declaration")
                for tail in tree.body[index + 1:]:
                    require(not any(((isinstance(node, ast.Name) and node.id in ("COMPONENTS", "EXTERNAL_COMPONENTS")) or (isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id in ("COMPONENTS", "EXTERNAL_COMPONENTS"))) and isinstance(node.ctx, ast.Store) for node in ast.walk(tail)), f"{self.path}:{getattr(tail, 'lineno', '?')}: COMPONENTS mutation after NETS is not allowed")
                    if isinstance(tail, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.While, ast.If, ast.With, ast.AsyncWith, ast.Try, ast.Expr)):
                        self.error(tail, "unsupported statement after NETS")
                    for node in ast.walk(tail):
                        if isinstance(node, (ast.Attribute, ast.Lambda, ast.NamedExpr, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
                            self.error(node, "unsupported syntax after NETS")
                        if isinstance(node, ast.Call) and not (isinstance(node.func, ast.Name) and node.func.id == "range"):
                            self.error(node, "arbitrary call after NETS")
                break
            if isinstance(statement, (ast.Import, ast.ImportFrom)):
                self.error(statement, "imports are not allowed")
            self.statement(statement)
        require(isinstance(self.env.get("COMPONENTS"), dict), f"{self.path}: COMPONENTS dictionary missing")
        return self.env["COMPONENTS"]


def parse_components(path):
    return ComponentDsl(Path(path)).parse()


def generator_inventory(specs):
    """Group every spec's components by inventory key.

    ``specs`` is ``[{path, board?}]``; ``[]`` means no generator. Returns
    ``(grouped, excluded, boards)`` where ``boards`` lists each spec's board name in order.
    """
    grouped, excluded, boards = {}, [], []
    for spec in specs:
        dsl = ComponentDsl(Path(spec["path"]))
        components = dsl.parse()
        board = spec.get("board", dsl.env.get("PROJECT_NAME"))
        require(isinstance(board, str) and board.strip(), f"{spec['path']}: generator spec needs a PROJECT_NAME string or a configured board")
        boards.append(board)
        externals = dsl.env.get("EXTERNAL_COMPONENTS", {})
        require(isinstance(externals, dict) and set(externals) <= set(components), "external components: unknown reference")
        for refdes, item in components.items():
            symbol, value, lcsc, footprint, dnp, _position = item
            external = externals.get(refdes)
            if external is not None:
                required_keys(external, ("mpn", "manufacturer", "package", "supplier", "order_code", "datasheet"), f"external {refdes}")
                require(not lcsc and not footprint and not dnp and external["mpn"] == symbol, f"external {refdes}: invalid PCB/LCSC/DNP identity")
                require(all(isinstance(v, str) and v.strip() for v in external.values()), f"external {refdes}: blank identity")
                key, mpn, package = "external:" + symbol, symbol, external["package"]
            elif not lcsc:
                excluded.append((board, refdes))
                continue
            else:
                key, mpn, package = lcsc, expected_mpn(symbol), footprint.split(":", 1)[-1]
            entry = grouped.setdefault(key, {"mpn": mpn, "package": package, "symbols": set(), "placements": []})
            require(entry["mpn"] == mpn and entry["package"] == package, f"generator LCSC {lcsc}: conflicting identity")
            if external is not None:
                entry["external"] = external
            entry["symbols"].add(symbol)
            entry["placements"].append({"board": board, "refdes": refdes, "dnp": bool(dnp)})
    return grouped, excluded, boards


def expected_mpn(symbol):
    """schgen library symbols may carry an ``_C<lcsc>`` suffix that is not part of the MPN."""
    return re.sub(r"_C\d+$", "", symbol)


def inventory_key(line):
    return "external:" + line["mpn"] if line.get("mounting") == "external" else line["lcsc"]


def validate_generator_parity(data, generated, excluded):
    """Every inventory line matches the generator: LCSC key, MPN, package, placements, DNP, exclusions."""
    lines = data["lines"]
    require(len({inventory_key(line) for line in lines}) == len(lines), "inventory: duplicate LCSC ownership")
    require(set(generated) == {inventory_key(line) for line in lines}, "inventory: LCSC identity differs from generator specs")
    for line in lines:
        if line.get("mounting") == "external":
            require(line["lcsc"] == "" and not line["dnp"], f"{line['line_id']}: external identity must have no LCSC and be fitted")
        else:
            require(re.fullmatch(r"C[0-9]+", line["lcsc"]), f"{line['line_id']}: PCB line needs LCSC")
        expected = generated[inventory_key(line)]
        require(("external" in expected) == (line.get("mounting") == "external"), f"{line['line_id']}: mounting differs from generator")
        if "external" in expected:
            for key in ("manufacturer", "supplier", "order_code"):
                require(line.get(key) == expected["external"][key], f"{line['line_id']}: external {key} mismatch")
        require(line["mpn"] == expected["mpn"], f"{line['line_id']}: wrong MPN against generator")
        require(line["package"] == expected["package"], f"{line['line_id']}: wrong package against generator")
        want_places = {(x["board"], x["refdes"], x["dnp"]) for x in expected["placements"]}
        got_places = {(x["board"], x["refdes"], line["dnp"]) for x in line["placements"]}
        require(got_places == want_places, f"{line['line_id']}: board/refdes or DNP mismatch")
    validate_counts(data)
    exclusions = {(x["board"], x["refdes"]) for x in data["exclusions"]}
    require(exclusions == set(excluded), "inventory: bare-copper exclusions differ from blank-LCSC generator entries")


def _spec_options(specs):
    require(isinstance(specs, list), "inventory provider led-generator-v1: specs must be a list")
    for spec in specs:
        require(isinstance(spec, dict) and "path" in spec and set(spec) <= SPEC_OPTION_KEYS, f"inventory provider led-generator-v1: each spec needs exactly path and optional board, got {spec!r}")
        require(isinstance(spec["path"], str) and Path(spec["path"]).is_absolute(), f"inventory provider led-generator-v1: spec path must be absolute: {spec['path']!r}")
        if "board" in spec:
            require(isinstance(spec["board"], str) and spec["board"].strip(), "inventory provider led-generator-v1: spec board must be a nonblank string")
    return [dict(spec) for spec in specs]


class LedGeneratorProvider(InventoryProvider):
    kind = "led-generator-v1"

    def __init__(self, options):
        super().__init__(options)
        unexpected = set(options) - {"kind", "specs"}
        require(not unexpected, f"inventory provider led-generator-v1: unexpected options {sorted(unexpected)}")
        require("specs" in options, "inventory provider led-generator-v1: specs option is required")
        self.specs = _spec_options(options["specs"])
        self._generated = None

    def generated(self):
        """``(grouped, excluded, boards)`` from the configured specs, parsed once per run."""
        if self._generated is None:
            self._generated = generator_inventory(self.specs)
        return self._generated

    def board_names(self, inventory):
        return sorted(set(self.generated()[2]))

    def relative_spec_paths(self, project_root):
        root = Path(project_root).resolve()
        relative = []
        for spec in self.specs:
            path = Path(spec["path"]).resolve()
            require(path.is_relative_to(root), f"inventory provider led-generator-v1: spec {spec['path']} is outside projectRoot {project_root}")
            relative.append(PurePosixPath(*path.relative_to(root).parts).as_posix())
        return relative

    def validate_inventory(self, inventory, config):
        """The inventory-only part: spec-path consistency plus full generator parity."""
        configured = self.relative_spec_paths(config["projectRoot"])
        require(inventory["generator_specs"] == configured, f"inventory: generator_specs {inventory['generator_specs']} differ from the configured specs {configured}")
        grouped, excluded, _boards = self.generated()
        validate_generator_parity(inventory, grouped, excluded)

    def validate(self, inventory, aggregate, config):
        self.validate_inventory(inventory, config)
        lines = inventory["lines"]
        validate_owner_parity(lines, aggregate)
        bound = placements(lines)
        pin_assets = "performed" if config["cad"]["enabled"] else "not performed: cad disabled"
        scope = (
            f"inventory provider=led-generator-v1; placements bound to {len(self.specs)} generator specs "
            f"({len(lines)} lines, {len(bound)} placements, {len(inventory['exclusions'])} exclusions); pin-asset check {pin_assets}"
        )
        return ProviderResult(lines=lines, placements=bound, scope_lines=[scope])

    def extra_pin_asset_checks(self, provider_result, aggregate):
        """Each pin map's symbol and footprint equal the generator's for its line."""
        grouped = self.generated()[0]
        records = {record["record_id"]: record for record in aggregate["records"]}
        lines = {line["line_id"]: line for line in provider_result.lines}
        for mapping in aggregate["pin_maps"]:
            record = records[mapping["record_id"]]
            line = lines[record["line_id"]]
            generated = grouped[inventory_key(line)]
            require(len(generated["symbols"]) == 1, f"{record['record_id']}: conflicting generator symbols")
            symbol = next(iter(generated["symbols"]))
            require(mapping["symbol"] == symbol, f"{record['record_id']}: pin map symbol differs from generator")
            external = line.get("mounting") == "external"
            require(mapping["footprint"] == ("" if external else generated["package"]), f"{record['record_id']}: pin map footprint differs from generator")

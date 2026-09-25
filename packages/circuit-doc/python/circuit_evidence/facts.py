"""Fact validation: dependency graphs, safe arithmetic, and PASS/BLOCKER trust closure."""

from __future__ import annotations

import ast

from .errors import ContractError, require, required_keys
from .sources import ID, LOCATOR_DETAIL


def graph_cycles(facts):
    graph = {fact["fact_id"]: fact.get("depends_on", []) for fact in facts}
    visiting, done = set(), set()
    def visit(node):
        if node in visiting:
            raise ContractError(f"facts: derived dependency cycle at {node}")
        if node in done:
            return
        visiting.add(node)
        for dep in graph.get(node, []):
            require(dep in graph, f"{node}: missing dependency {dep}")
            visit(dep)
        visiting.remove(node)
        done.add(node)
    for node in graph:
        visit(node)


def arithmetic(expression, values):
    tree = ast.parse(expression, mode="eval")
    def ev(node):
        if isinstance(node, ast.Expression): return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)): return node.value
        if isinstance(node, ast.Name) and node.id in values: return values[node.id]
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = ev(node.operand)
            return value if isinstance(node.op, ast.UAdd) else -value
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow)):
            left, right = ev(node.left), ev(node.right)
            if isinstance(node.op, ast.Add): return left + right
            if isinstance(node.op, ast.Sub): return left - right
            if isinstance(node.op, ast.Mult): return left * right
            if isinstance(node.op, ast.Pow):
                require(abs(left) <= 1e12 and -10 <= right <= 10, "calculated exponent exceeds safety bound")
                return left ** right
            return left / right
        raise ContractError(f"unsafe or unknown expression: {expression}")
    return ev(tree)


def expression_names(expression):
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as exc:
        raise ContractError(f"invalid calculated expression: {expression}") from exc
    return {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}


def validate_facts(facts, sources, schema):
    source_ids = {source["source_id"] for source in sources}
    sources_by_id = {source["source_id"]: source for source in sources}
    facts_by_id = {fact["fact_id"]: fact for fact in facts}
    require(len({fact["fact_id"] for fact in facts}) == len(facts), "facts: duplicate fact ID")
    for fact in facts:
        required_keys(fact, schema["fact_required"], fact.get("fact_id", "fact"))
        require(ID.fullmatch(fact["fact_id"]), f"{fact['fact_id']}: invalid fact ID")
        require(fact["source_id"] in source_ids, f"{fact['fact_id']}: unknown source ID")
        require(fact["class"] in schema["fact_classes"], f"{fact['fact_id']}: fact class")
        require(fact["provenance"] in schema["provenance"], f"{fact['fact_id']}: provenance")
        require(fact["verdict"] in schema["verdicts"], f"{fact['fact_id']}: verdict")
        if fact["provenance"] == "DISTRIBUTOR-IDENTITY" or fact["verdict"] == "CONFIRMED - distributor identity only":
            source = sources_by_id[fact["source_id"]]
            require(fact["provenance"] == "DISTRIBUTOR-IDENTITY" and fact["verdict"] == "CONFIRMED - distributor identity only", f"{fact['fact_id']}: distributor identity provenance/verdict must be paired")
            require(fact["class"] == "PROJECT_STATE" and source["availability"] == "AVAILABLE" and source["authority_class"] == "DISTRIBUTOR_IDENTITY", f"{fact['fact_id']}: distributor identity lane requires AVAILABLE DISTRIBUTOR_IDENTITY PROJECT_STATE evidence")
        for key in ("unit", "conditions", "locator"):
            require(isinstance(fact[key], str) and fact[key].strip(), f"{fact['fact_id']}: missing {key}")
        require(LOCATOR_DETAIL.search(fact["locator"]), f"{fact['fact_id']}: locator lacks exact detail")
        if fact["provenance"] == "CALCULATED":
            require(fact["depends_on"] and fact["expression"], f"{fact['fact_id']}: calculated fact lacks dependencies/expression")
            require(fact["fact_id"] not in fact["depends_on"], f"{fact['fact_id']}: calculated fact depends on itself")
            expected_names = {dependency.replace("-", "_") for dependency in fact["depends_on"]}
            actual_names = expression_names(fact["expression"])
            require(actual_names == expected_names, f"{fact['fact_id']}: expression variables must exactly match depends_on fact IDs")
        else:
            require(not fact["depends_on"] and not fact["expression"], f"{fact['fact_id']}: raw fact cannot declare derived dependencies/expression")
    graph_cycles(facts)
    values = {fact["fact_id"]: fact["value"] for fact in facts}
    for fact in facts:
        if fact["provenance"] == "CALCULATED":
            require(all(facts_by_id[dependency]["provenance"] != "DISTRIBUTOR-IDENTITY" for dependency in fact["depends_on"]), f"{fact['fact_id']}: calculations cannot depend on distributor identity evidence")
            dependency_values = {key.replace("-", "_"): values[key] for key in fact["depends_on"]}
            require(arithmetic(fact["expression"], dependency_values) == fact["value"], f"{fact['fact_id']}: derived value is stale")


def validate_pass_trust(facts, sources):
    facts_by_id = {fact["fact_id"]: fact for fact in facts}
    sources_by_id = {source["source_id"]: source for source in sources}

    def trusted(fact_id, trail):
        require(fact_id not in trail, f"{fact_id}: trust dependency cycle")
        fact = facts_by_id[fact_id]
        if fact["provenance"] == "CALCULATED":
            require(fact["verdict"] == "PASS - primary-source confirmed", f"{fact_id}: calculated PASS dependency is not PASS")
            require(fact["depends_on"], f"{fact_id}: calculated PASS has no dependencies")
            return all(trusted(dependency, trail | {fact_id}) for dependency in fact["depends_on"])
        source = sources_by_id[fact["source_id"]]
        return fact["provenance"] == "PRIMARY-SPEC" and fact["verdict"] == "PASS - primary-source confirmed" and source["availability"] == "AVAILABLE" and source["authority_class"] == "MANUFACTURER_PRIMARY"

    for fact in facts:
        if fact["provenance"] == "PRIMARY-SPEC" and fact["verdict"] == "PASS - primary-source confirmed":
            source = sources_by_id[fact["source_id"]]
            require(source["availability"] == "AVAILABLE" and source["authority_class"] == "MANUFACTURER_PRIMARY", f"{fact['fact_id']}: PRIMARY-SPEC PASS requires AVAILABLE MANUFACTURER_PRIMARY")
        if fact["verdict"] == "PASS - primary-source confirmed":
            require(fact["provenance"] in ("PRIMARY-SPEC", "CALCULATED"), f"{fact['fact_id']}: PASS lacks primary/calculated provenance")
            if fact["provenance"] == "CALCULATED":
                require(trusted(fact["fact_id"], set()), f"{fact['fact_id']}: calculated PASS dependency closure is not fully trusted")
        if fact["verdict"] == "BLOCKER - deterministic spec violation":
            if fact["provenance"] == "CALCULATED":
                require(fact["depends_on"] and all(trusted(dependency, set()) for dependency in fact["depends_on"]), f"{fact['fact_id']}: deterministic BLOCKER dependency closure is not fully trusted")
            else:
                source = sources_by_id[fact["source_id"]]
                require(fact["provenance"] == "PRIMARY-SPEC" and source["availability"] == "AVAILABLE" and source["authority_class"] == "MANUFACTURER_PRIMARY", f"{fact['fact_id']}: deterministic BLOCKER requires available manufacturer-primary evidence")


def fact_blocks_domain(fact_id, facts_by_id, sources_by_id):
    # contract.md: a NOT APPLICABLE fact does not address the domain, so it never blocks (ADR-008).
    fact = facts_by_id[fact_id]
    if fact["verdict"] == "NOT APPLICABLE":
        return False
    return fact["verdict"] in ("UNSOURCED", "NEEDS BENCH") or sources_by_id[fact["source_id"]]["availability"] == "SOURCE UNAVAILABLE"


def fact_evidence_available(fact_id, facts_by_id, sources_by_id, trail=None):
    trail = trail or set()
    require(fact_id not in trail, f"{fact_id}: evidence dependency cycle")
    fact = facts_by_id[fact_id]
    source = sources_by_id[fact["source_id"]]
    if source["availability"] != "AVAILABLE" or fact["verdict"] == "UNSOURCED":
        return False
    if fact["provenance"] == "CALCULATED":
        return bool(fact["depends_on"]) and all(
            fact_evidence_available(dependency, facts_by_id, sources_by_id, trail | {fact_id})
            for dependency in fact["depends_on"]
        )
    return True


def fact_primary_trusted(fact_id, facts_by_id, sources_by_id, trail=None):
    trail = trail or set()
    require(fact_id not in trail, f"{fact_id}: trust dependency cycle")
    fact = facts_by_id[fact_id]
    if fact["provenance"] == "CALCULATED":
        return fact["verdict"] == "PASS - primary-source confirmed" and bool(fact["depends_on"]) and all(
            fact_primary_trusted(dependency, facts_by_id, sources_by_id, trail | {fact_id})
            for dependency in fact["depends_on"]
        )
    source = sources_by_id[fact["source_id"]]
    return (
        fact["provenance"] == "PRIMARY-SPEC"
        and fact["verdict"] == "PASS - primary-source confirmed"
        and source["availability"] == "AVAILABLE"
        and source["authority_class"] == "MANUFACTURER_PRIMARY"
    )

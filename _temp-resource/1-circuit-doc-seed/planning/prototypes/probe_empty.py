import importlib.util, sys, traceback, json
from pathlib import Path
root=Path(sys.argv[1])
spec=importlib.util.spec_from_file_location("v", root/".claude/skills/component-spec-audit/scripts/validate.py")
v=importlib.util.module_from_spec(spec); spec.loader.exec_module(v)
schema=v.load(v.REFS/"schema.json")
def step(name, fn):
    try:
        r=fn(); print("OK  ", name, (r if not isinstance(r,(dict,list)) else type(r).__name__)); return r
    except BaseException as e:
        print("FAIL", name, type(e).__name__, str(e)[:160]); return None
# emulate generator_inventory with explicit empty specs
print("generator_inventory(()) uses fallback? ->", end=" ")
try:
    g=v.generator_inventory(()); print("returned", len(g[0]))
except BaseException as e: print(type(e).__name__, str(e)[:120])
print("generator_inventory([]) ->", end=" ")
try:
    g=v.generator_inventory([]); print("returned", len(g[0]))
except BaseException as e: print(type(e).__name__, str(e)[:120])
lines=[]
step("validate_routing(empty)", lambda: v.validate_routing([], {"cases":[]}))
agg=step("validate_local_skills(empty, skills_root=empty dir)", lambda: v.validate_local_skills(schema, [], root/"nonexistent-skills"))
agg=agg or {k:[] for k in ("records","sources","facts","coverage","routes","interactions","pin_maps")}
step("validate_template_skill", v.validate_template_skill)
step("validate_bundle(template)", lambda: v.validate_bundle(v.template_bundle(), schema, True))
step("validate_bundle(empty aggregate)", lambda: v.validate_bundle(agg, schema))
step("validate_real_pin_locks(empty,{locks:[]})", lambda: v.validate_real_pin_locks(agg, {"locks":[]}))
step("validate_pin_assets(empty) [needs symbols file]", lambda: v.validate_pin_assets(agg, [], root/"x.kicad_sym", root))
step("validate_critical_fact_review(empty)", lambda: v.validate_critical_fact_review(agg, {"reviews":[]}))
step("validate_refresh_evidence(empty)", lambda: v.validate_refresh_evidence(agg, {"evidence":[]}))
step("validate_integration_artifacts(empty)", lambda: v.validate_integration_artifacts(agg))
step("validate_evidence_chain(empty chain)", lambda: v.validate_evidence_chain({"fact_ids":[],"evidence_chain":[{"stage":s,"status":"OPEN","fact_ids":[]} for s in ["official-source","conditioned-requirement","generated-netlist","symbol-footprint","pcb-orientation","bom-cpl","as-built","programmed","bench"]]}, agg))

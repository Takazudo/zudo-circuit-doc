import importlib.util, sys, copy, json
from pathlib import Path
root=Path(sys.argv[1])
spec=importlib.util.spec_from_file_location("v", root/".claude/skills/component-spec-audit/scripts/validate.py")
v=importlib.util.module_from_spec(spec); spec.loader.exec_module(v)
schema=v.load(v.REFS/"schema.json")
b=v.template_bundle()
# template source is SOURCE UNAVAILABLE; make pin fact NOT APPLICABLE
next(f for f in b["facts"] if f["fact_id"]=="fact-example-pin")["verdict"]="NOT APPLICABLE"
b["coverage"][0]["reason"]="Domain open pending inspection."
for ids,label in (([],"empty blocking ids"),(["fact-example-pin"],"NA fact named as blocker")):
    c=copy.deepcopy(b); c["coverage"][0]["blocking_fact_ids"]=ids
    try: v.validate_bundle(c, schema, True); print(label, "-> PASS")
    except v.ContractError as e: print(label, "-> FAIL:", e)
# corpus scan
inv=v.load(v.REFS/"inventory.json")["lines"]
for owner in sorted({l["owner_skill"] for l in inv}):
    bb=v.load_skill_bundle(root/".claude/skills"/owner)
    src={s["source_id"]:s for s in bb["sources"]}; fx={f["fact_id"]:f for f in bb["facts"]}
    for c in bb["coverage"]:
        for fid in c["fact_ids"]:
            f=fx[fid]
            if f["verdict"]=="NOT APPLICABLE" and src[f["source_id"]]["availability"]=="SOURCE UNAVAILABLE":
                print("corpus edge:", owner, c["coverage_id"], c["status"], fid, "in blocking" if fid in c["blocking_fact_ids"] else "not in blocking")

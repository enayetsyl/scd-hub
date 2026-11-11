#!/usr/bin/env python3
"""
validate_plan.py — plan conformance harness (SCD edition 2; logic identical to the Project 03 harness, only the schema lookup changed).

  python3 validate_plan.py <plan.json> [--chapter <chapter.json>]

Layer 1: JSON Schema (SCD_PlanSchema_v2.json) — presence / order / enum / count / pattern.
Layer 2: the checks JSON Schema cannot express —
   arithmetic (segment minutes sum = 35), cross-field equality (§3.0 header == Session Map row),
   numeral system by subject, surface purity (no codes on the teacher surface),
   Closing order, Opening rituals, r6 (>=2 Exit-Check forms per objective type — HARD, Principal ruling),
   no-consecutive-repeat rotation (WARN), and the cross-plan Session<->Chapter Spine match.

Exit code 0 = PASS, 1 = FAIL. Independent of the building chat — this is the conformance gate.
"""
import sys, json, re, argparse, os, glob
import jsonschema

HERE = os.path.dirname(os.path.abspath(__file__))
# Resolve the schema by suffix so a DRAFT_ / LOCKED_ prefix rename does not
# break the toolchain. SCD edition: prefers SCD_PlanSchema_v2 (Nursery–Class 10 + ISL);
# falls back to the Project 03 C5_PlanSchema_v1. LOCKED_ beats DRAFT_.
_cands = []
for _pat in ("*SCD_PlanSchema_v2.json", "*C5_PlanSchema_v1.json"):
    _cands = sorted(glob.glob(os.path.join(HERE, _pat)),
                    key=lambda p: (("LOCKED" not in p), len(os.path.basename(p))))
    if _cands:
        break
if not _cands:
    sys.exit("ERROR: SCD_PlanSchema_v2.json not found next to validate_plan.py")
SCHEMA = json.load(open(_cands[0], encoding="utf-8"))
import render_plan as R

FAILS, WARNS = [], []
def fail(c, m): FAILS.append((c, m))
def warn(c, m): WARNS.append((c, m))

BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯"
# code patterns forbidden on the teacher/reader surface (layout "Read first" rule #1)
SURFACE_FORBIDDEN = [
    (r"RC-[A-Z]", "RC- id"), (r"QP-[A-Z]", "QP- id"), (r"TOP-[A-Z]", "TOP- id"),
    (r"\bREF-\d", "REF-NN"), (r"§", "§ glyph"), (r"\bD-\d{3}", "D-NNN"),
    (r"\bD-PROJ\d", "D-PROJ id"), (r"\bC-\d{2}\b", "C-NN category"),
    (r"\bF-\d{2}\b", "F-NN flag"), (r"যোগ্যতা\s*\d", "NCF যোগ্যতা number"),
    (r"শিখনফল\s*[\d০-৯]", "NCF শিখনফল number"), (r"\.md\b", "filename"),
]

def strip_comments(md):
    return re.sub(r"<!--.*?-->", "", md, flags=re.DOTALL)

# ---- segments / flow ----------------------------------------------------
EXPECTED_ORDER = ["Opening", "Hook", "DirectInstruction", "GuidedPractice",
                  "IndependentPractice", "ExitCheck", "Closing"]
MAND = {"Opening", "Hook", "ExitCheck", "Closing"}

def check_session(plan):
    spn = plan["session_plan"]
    segs = spn["lesson_flow"]["segments"]
    names = [s["name"] for s in segs]
    if names != EXPECTED_ORDER:
        fail("SEG-ORDER", f"Lesson-Flow segment order {names} != frozen §A order {EXPECTED_ORDER}")
    for s in segs:
        if s["name"] in MAND and not s["mandatory"]:
            fail("SEG-MAND", f"{s['name']} must be mandatory")
        if s["name"] not in MAND and s["mandatory"]:
            warn("SEG-MAND", f"{s['name']} marked mandatory (layout: flexible)")
    total = sum(s["minutes"] for s in segs)
    if total != 35:
        fail("SUM-35", f"segment minutes sum to {total}, not 35")
    # Opening = 4 canonical rituals (salaam, bismillah, materials-check, objective) — D-034
    op = next(s for s in segs if s["name"] == "Opening")
    if not (isinstance(op["body"], list) and len(op["body"]) == 4):
        fail("OPEN-4", f"Opening must be the 4 canonical rituals (got {len(op['body']) if isinstance(op['body'],list) else 'prose'})")
    else:
        joined = " ".join(op["body"])
        for kw, lbl in [("সালাম|আসসালাম|Salaam|salaam|শুরু", "salaam"),
                        ("বিসমিল্লাহ|Bismillah", "bismillah"),
                        ("উপকরণ|খাতা|materials|khata", "materials-check"),
                        ("লক্ষ্য|শিখব|objective|learn", "objective")]:
            if not re.search(kw, joined, re.I):
                warn("OPEN-RITUAL", f"Opening ritual '{lbl}' not detected")
    # Closing order: takeaway -> homework -> materials-to-bag -> Alhamdulillah -> Salam (D-035)
    cl = next(s for s in segs if s["name"] == "Closing")
    if isinstance(cl["body"], list):
        seq = " || ".join(cl["body"])
        order_kw = ["শেখা|শিখল|takeaway|learned|মূল",
                    "বাড়ির কাজ|homework|HW",
                    "ব্যাগে|গুছি|গুছানো|bag|materials",
                    "আলহামদুলিল্লাহ|Alhamdulillah",
                    "সালাম|Salam|salam"]
        positions = []
        for kw in order_kw:
            m = re.search(kw, seq, re.I)
            positions.append(m.start() if m else -1)
        if any(p == -1 for p in positions):
            warn("CLOSE-ORDER", f"Closing step not detected for all five ({positions})")
        elif positions != sorted(positions):
            fail("CLOSE-ORDER", "Closing steps out of frozen order (শেখা→বাড়ির কাজ→গুছানো→আলহামদুলিল্লাহ→সালাম)")

    # flow-card rows align to segments
    fc_segs = [r["segment"] for r in spn["flow_card"]["rows"]]
    if fc_segs != EXPECTED_ORDER:
        fail("FLOWCARD-ORDER", f"flow-card rows {fc_segs} != segment order")

    # replacement-section presence rule
    multi = spn["session_form"] == "multi_period"
    rs = spn.get("replacement_section")
    if multi and plan["curation_tag"] == "NEEDS_REPLACEMENT" and not rs:
        fail("RC-SECTION", "NEEDS_REPLACEMENT multi-period session missing the inline replacement section")
    if rs and plan["curation_tag"] != "NEEDS_REPLACEMENT":
        fail("RC-SECTION", f"replacement section present but curation_tag={plan['curation_tag']} (only NEEDS_REPLACEMENT)")

    if multi and spn["period_index"] > spn["period_of"]:
        fail("PERIOD", f"period_index {spn['period_index']} > period_of {spn['period_of']}")


# ---- chapter / r6 / rotation -------------------------------------------
def check_chapter(plan):
    cp = plan["chapter_plan"]
    if cp["period_count"] != len(cp["session_map"]):
        fail("MAP-N", f"period_count {cp['period_count']} != session_map rows {len(cp['session_map'])}")
    bank_ids = {it["id"] for it in cp["spine"]["exit_check"]["bank"]}
    primaries = [it for it in cp["spine"]["exit_check"]["bank"] if it.get("primary")]
    if len(primaries) != 1:
        warn("EC-PRIMARY", f"expected exactly one *(মূল)* primary Exit-Check, found {len(primaries)}")
    # r6 — HARD: >=2 forms per objective type (Principal ruling; REF-02 §2.4 r6)
    by_type = {}
    for it in cp["spine"]["exit_check"]["bank"]:
        by_type.setdefault(it["objective_type"], []).append(it["id"])
    for t, ids in by_type.items():
        if len(ids) < 2:
            fail("R6", f"objective type '{t}' has {len(ids)} Exit-Check form(s); REF-02 §2.4 r6 requires >=2")
    # rotation: pointers valid + no consecutive repeat (WARN — a one-line reason may override)
    prev = None
    for row in cp["session_map"]:
        if row["exit_check_pointer"] not in bank_ids:
            fail("MAP-PTR", f"period {row['period']} Exit-Check pointer {row['exit_check_pointer']} not in bank")
        if prev is not None and row["exit_check_pointer"] == prev:
            warn("ROTATE", f"periods {row['period']-1}-{row['period']} repeat Exit-Check {row['exit_check_pointer']}")
        prev = row["exit_check_pointer"]


# ---- cross-plan Session <-> Chapter -------------------------------------
def check_cross_plan(session_plan, chapter_plan):
    spn = session_plan["session_plan"]
    if spn["session_form"] != "multi_period":
        return
    cp = chapter_plan["chapter_plan"]
    idx = spn["period_index"]
    row = next((r for r in cp["session_map"] if r["period"] == idx), None)
    if row is None:
        fail("XP-ROW", f"no Session Map row for period {idx} in the Chapter Plan")
        return
    h = spn["session_header"]
    if h["objective"].strip() != row["objective"].strip():
        fail("XP-OBJ", "§3.0 objective != Chapter Session Map row objective (Spine re-derived — REF-02 §2A.1)")
    if h["must_cover"].strip() != row["must_cover"].strip():
        fail("XP-SLICE", "§3.0 must-cover slice != Session Map row (Spine re-derived)")
    # exit-check full text must equal the bank item the row points to
    bank = {it["id"]: it["text"] for it in cp["spine"]["exit_check"]["bank"]}
    want = bank.get(row["exit_check_pointer"], "").strip()
    got = h["exit_check_text"].strip()
    if want and want not in got and got not in want:
        fail("XP-EC", f"§3.0 Exit-Check text != bank item {row['exit_check_pointer']} it points to")
    if spn["period_of"] != cp["period_count"]:
        fail("XP-N", f"session period_of {spn['period_of']} != chapter period_count {cp['period_count']}")


# ---- surface (numerals + purity), run on rendered output ----------------
def check_surface(plan):
    try:
        surface = strip_comments(R.render(plan))
    except Exception as e:
        fail("RENDER", f"render failed: {e}")
        return
    for pat, lbl in SURFACE_FORBIDDEN:
        m = re.search(pat, surface)
        if m:
            fail("SURFACE", f"forbidden code on surface: {lbl} ('{m.group(0)}')")
    if plan["subject"] == "ENG":
        # The ENG strict-Latin rule (Layout v10 §C) polices numerals the plan
        # GENERATES on the surface (minutes, flow-card #, counts, period index).
        # It does NOT touch the Bangla numerals baked into the frozen bilingual
        # layer headings (স্তর ২ … / Layer 2 …), which are subject-invariant
        # frozen strings (§B/§D). Exempt those lines before scanning.
        FROZEN_LAYER_HEADING = re.compile(
            r"^#{1,2}\s*স্তর\s*[" + BANGLA_DIGITS + r"]\s*—.*?/\s*Layer\s*\d", re.M)
        scan = FROZEN_LAYER_HEADING.sub("", surface)
        m = re.search(f"[{BANGLA_DIGITS}]", scan)
        if m:
            ctx = next((ln.strip() for ln in scan.split("\n") if m.group(0) in ln), "")
            fail("ENG-LATIN",
                 f"Bangla numeral '{m.group(0)}' on an English-subject surface "
                 f"(must be Latin) — line: {ctx[:70]}")
    # frozen flow-card cells
    if plan["plan_type"] == "session_plan":
        if "✅ আবশ্যিক" not in surface:
            fail("FROZEN-CELL", "flow card missing '✅ আবশ্যিক' frozen cell")
        if re.search(r"\|\s*(হ্যাঁ|না|Yes|No)\s*\|", surface):
            fail("FROZEN-CELL", "flow card uses হ্যাঁ/না/Yes/No instead of ✅ আবশ্যিক / নমনীয়")


def check_pinning(plan):
    p = plan.get("pinned_to", {})
    for k, v in R.CURRENT_BUILD_TARGET.items():
        if p.get(k) and p[k] != v:
            warn("PIN", f"{k} pinned to {p[k]}, current build target is {v} — re-conformance may be owed")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("plan")
    ap.add_argument("--chapter", help="Chapter Plan JSON for cross-plan check of a multi-period session")
    args = ap.parse_args()
    plan = json.load(open(args.plan, encoding="utf-8"))

    # Layer 1 — schema
    v = jsonschema.Draft202012Validator(SCHEMA)
    for e in sorted(v.iter_errors(plan), key=lambda e: e.path):
        fail("SCHEMA", f"{list(e.path)}: {e.message}")

    # Layer 2 — custom (only if schema-valid enough to traverse)
    if not any(c == "SCHEMA" for c, _ in FAILS):
        check_pinning(plan)
        check_surface(plan)
        if plan["plan_type"] == "chapter_plan":
            check_chapter(plan)
        else:
            check_session(plan)
            if args.chapter:
                check_cross_plan(plan, json.load(open(args.chapter, encoding="utf-8")))
            elif plan["session_plan"]["session_form"] == "multi_period":
                warn("XP", "multi-period session validated without its Chapter Plan; pass --chapter for the Spine-match check")

    name = os.path.basename(args.plan)
    print(f"\n=== {name} ===")
    for c, m in WARNS:
        print(f"  WARN [{c}] {m}")
    for c, m in FAILS:
        print(f"  FAIL [{c}] {m}")
    if FAILS:
        print(f"RESULT: FAIL ({len(FAILS)} fail, {len(WARNS)} warn)")
        sys.exit(1)
    print(f"RESULT: PASS ({len(WARNS)} warn)")
    sys.exit(0)


if __name__ == "__main__":
    main()

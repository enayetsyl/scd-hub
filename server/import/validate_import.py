#!/usr/bin/env python3
"""
validate_import.py — School Software import conformance harness (v1.0, LOCKED 2026-06-09).

  python3 validate_import.py <envelope.json> \
      [--envelope-schema <ImportEnvelope_v1.json>] \
      [--plan-schema <C5_PlanSchema_v1.json>] \
      [--question-schema <QuestionPayload_v1.json>] \
      [--stimulus-schema <StimulusPayload_v1.json>] \
      [--ref19-registry <ref19_slugs.json>] \
      [--lexicon <REF-21_lexicon.json>] \
      [--emit-batch]

The app's ingestion gate (REQ §4 R-IMP3). Mirrors Project 03's two-layer philosophy
(executed checks, not self-graded). Publisher-side equivalent of validate_plan.py.

v0.2 diff vs v0.1 (Project-04 ratification, R-IMP5):
  - L2 now dispatches QUESTION payload -> QuestionPayload_v1.json and STIMULUS payload ->
    StimulusPayload_v1.json (the closed, additionalProperties:false contracts), exactly as
    plan payloads dispatch to the plan schema.
  - L3 consistency extended: for doc_type=question, envelope tags.{bloom_level,difficulty,
    topic_tag,paper_role} must equal the payload's.
  - L4 question semantics (not expressible in JSON Schema): per-blank / per-pair / per-step
    marks sum to item marks (when present); ref19_topic_id MUST be in the REF-19 registry
    (HARD); stimulus_ref well-formedness (WARN — resolution to the store is app-DB, not a
    single-envelope check).
  - The REF-21 advisory scan stays PLAN-SURFACE-ONLY: questions deliberately get NO import
    curation scan (Project-04 decision 5-B; the build-side REF-01+REF-21 self-scan is the gate).

Layers:
  L1  Envelope schema       — outer contract (Draft 2020-12) + doc_type discriminator + light marker.
  L2  Payload schema        — full closed validation by doc_type (plan / question / stimulus).
  L3  Consistency           — envelope indexed copies vs payload (plan: subject/class_level/
                              curation_tag/address/pinned_to; question: tags.*).
  L4  Question semantics     — marks sums + REF-19 registry + stimulus_ref form.
  ADV REF-21 lexicon scan    — ADVISORY, plan surface only (D-#4 / decision 5-B).

Exit 0 = PASS (importable), 1 = FAIL (rejected). Advisories never affect exit code.
"""
import sys, json, re, argparse, os, glob
from jsonschema import Draft202012Validator

HERE = os.path.dirname(os.path.abspath(__file__))

FAILS, WARNS, ADVISORIES = [], [], []
def fail(code, msg): FAILS.append((code, msg))
def warn(code, msg): WARNS.append((code, msg))
def advise(code, msg): ADVISORIES.append((code, msg))

PLAN_DOC_TYPES = {"chapter_plan", "session_plan"}
STIM_ID_RE = re.compile(r"^STIM-[A-Z]+-C[1-5]-U\d+(-L\d+)?-\d{2,}$")

# REF-19 canonical topic slugs (auto-extracted from LOCKED_REF-19 v1.10, 2026-06-09; the
# doc-reference artifact 'BGS-REF19' excluded). This is the DEFAULT registry for the hard
# ref19_topic_id check — override with the authoritative list via --ref19-registry.
REF19_SLUGS_DEFAULT = {
    "BAN-ALPHABET","BAN-BIOGRAPHY","BAN-CONJUNCT","BAN-DRAMA","BAN-FOLA","BAN-FREEWRITE",
    "BAN-FUNCWRITE","BAN-GUIDEDWRITE","BAN-INFOTEXT","BAN-JUKTOBARNA","BAN-LEARNERQ","BAN-MATRA",
    "BAN-ORACY","BAN-PARTSPEECH","BAN-POEM","BAN-REF","BAN-RHYME","BAN-SENTENCE","BAN-STORY",
    "BAN-SWARBARNA","BAN-VERBAGREE","BAN-VOCAB","BAN-WORDBUILD","BAN-WORDREL",
    "ENG-ALPHABET","ENG-ASKANSWER","ENG-COMMANDS","ENG-COMPREHENSION","ENG-FREEWRITE","ENG-FUNCWRITE",
    "ENG-GRAMMAR","ENG-GREETING","ENG-GUIDEDWRITE","ENG-LISTENING","ENG-NUMERACY","ENG-PHONICS",
    "ENG-POEM","ENG-READALOUD","ENG-RHYME","ENG-SENTENCE","ENG-SENTSTR","ENG-SPEAKING","ENG-STORY",
    "ENG-TENSE","ENG-VOCAB","ENG-WHQ","ENG-WORDFORM","ENG-WRITINGMECH",
    "MATH-ADD","MATH-ADDSUB","MATH-AVERAGE","MATH-COMPARE","MATH-COUNT","MATH-DATA","MATH-DECIMAL",
    "MATH-DIV","MATH-FACTORS","MATH-FOUROP","MATH-FRACTION","MATH-GEOMETRY","MATH-MEASURE","MATH-MONEY",
    "MATH-MUL","MATH-MULDIV","MATH-ODDEVEN","MATH-ORDINAL","MATH-PATTERN","MATH-PERCENT","MATH-PLACEVAL",
    "MATH-SENTENCE","MATH-SUB","MATH-TIME",
    "SCI-ADOLESCENCE","SCI-ANIMAL","SCI-ASTRO","SCI-CLASSIFY","SCI-CLIMATE","SCI-CONSERV","SCI-ECOLOGY",
    "SCI-ENERGY","SCI-FOOD","SCI-FORCE","SCI-HEALTH","SCI-ICT","SCI-LANDFORM","SCI-MAGNET","SCI-MATTER",
    "SCI-PLANT","SCI-RESOURCES","SCI-SAFETY","SCI-SOIL","SCI-TECH","SCI-TECHSOC","SCI-WATER","SCI-WEATHER",
    "BGS-BANK","BGS-CHILDRIGHTS","BGS-CITIZEN","BGS-COEXIST","BGS-COUNTRY","BGS-CULTURE","BGS-DISASTER",
    "BGS-ENV","BGS-ETHICS","BGS-ETHNIC","BGS-FAMILYROLE","BGS-FOREST","BGS-GENDER","BGS-GEOGRAPHY",
    "BGS-HISTSITES","BGS-INTERORG","BGS-LANGMOV","BGS-LEADERS","BGS-LEADERSHIP","BGS-LIBERATION",
    "BGS-MONEY","BGS-POPULATION","BGS-PRODUCTS","BGS-PROFESSION","BGS-RESOURCES","BGS-ROADSAFETY",
}


def _resolve(explicit, patterns, label, required=True):
    if explicit:
        if not os.path.exists(explicit):
            sys.exit(f"ERROR: {label} not found at {explicit}")
        return explicit
    cands = []
    for pat in patterns:
        cands += glob.glob(os.path.join(HERE, pat))
    cands = sorted(set(cands), key=lambda p: (("LOCKED" not in os.path.basename(p)), len(os.path.basename(p))))
    if not cands:
        if required:
            sys.exit(f"ERROR: {label} not found (looked for {patterns} next to validate_import.py); pass it explicitly.")
        return None
    return cands[0]


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


# ---- L1: envelope schema ------------------------------------------------
def layer1_envelope(env, env_schema):
    v = Draft202012Validator(env_schema)
    for e in sorted(v.iter_errors(env), key=lambda e: list(e.path)):
        fail("ENVELOPE", f"{list(e.path)}: {e.message}")


# ---- L2: payload schema (dispatch by doc_type) --------------------------
def layer2_payload(env, schema, code):
    payload = env.get("payload", {})
    v = Draft202012Validator(schema)
    for e in sorted(v.iter_errors(payload), key=lambda e: list(e.path)):
        fail(code, f"payload{list(e.path)}: {e.message}")


# ---- L3: envelope <-> payload consistency -------------------------------
def consistency(env):
    dt = env.get("doc_type")
    p = env.get("payload", {})
    if dt in PLAN_DOC_TYPES:
        for field in ("subject", "class_level", "curation_tag"):
            if field in env and field in p and env[field] != p[field]:
                fail("XF", f"envelope.{field}={env[field]!r} != payload.{field}={p[field]!r}")
        addr, div = env.get("address"), p.get("division")
        if addr and div:
            for k in ("anchor_word", "number", "title"):
                if addr.get(k) != div.get(k):
                    fail("XF-ADDR", f"envelope.address.{k}={addr.get(k)!r} != payload.division.{k}={div.get(k)!r}")
        ep, pp = env.get("pinned_to") or {}, p.get("pinned_to") or {}
        for k in set(ep) | set(pp):
            if ep.get(k) != pp.get(k):
                warn("PIN", f"pinned_to.{k}: envelope={ep.get(k)!r} payload={pp.get(k)!r}")
        return
    if dt == "question":
        tags = env.get("tags", {})
        for f in ("bloom_level", "difficulty", "topic_tag", "paper_role"):
            if f in tags and f in p and tags[f] != p[f]:
                fail("XF", f"envelope.tags.{f}={tags[f]!r} != payload.{f}={p[f]!r}")
        return
    # stimulus / question_set carry no indexed-copy mirror — nothing to reconcile.


# ---- L4: question semantics (not expressible in JSON Schema) ------------
def _sum_eq(a, b): return abs(a - b) < 1e-9

def question_semantics(env, ref19_slugs):
    if env.get("doc_type") != "question":
        return
    p = env.get("payload", {})
    qt = p.get("question_type")
    marks = p.get("marks")

    if qt == "fill_blank":
        bl = p.get("blanks", [])
        marked = [b for b in bl if "marks" in b]
        if marked:
            if len(marked) != len(bl):
                fail("SUM", "fill_blank: per-blank marks must be all-or-none")
            elif marks is not None and not _sum_eq(sum(b["marks"] for b in bl), marks):
                fail("SUM", f"fill_blank per-blank marks sum {sum(b['marks'] for b in bl)} != item marks {marks}")
    elif qt == "matching":
        pr = p.get("pairs", [])
        marked = [x for x in pr if "marks" in x]
        if marked:
            if len(marked) != len(pr):
                fail("SUM", "matching: per-pair marks must be all-or-none")
            elif marks is not None and not _sum_eq(sum(x["marks"] for x in pr), marks):
                fail("SUM", f"matching per-pair marks sum {sum(x['marks'] for x in pr)} != item marks {marks}")
    elif qt == "short_answer":
        sb = (p.get("answer_key") or {}).get("step_breakdown")
        if sb and marks is not None and not _sum_eq(sum(s["marks"] for s in sb), marks):
            fail("SUM", f"short_answer step_breakdown sum {sum(s['marks'] for s in sb)} != item marks {marks}")
    # descriptive rubrics are qualitative (no per-band marks) — no machine sum check.

    slug = p.get("ref19_topic_id")
    if slug and slug not in ref19_slugs:
        fail("REF19", f"ref19_topic_id '{slug}' not in the REF-19 registry ({len(ref19_slugs)} slugs)")

    sref = p.get("stimulus_ref")
    if sref and not STIM_ID_RE.match(sref):
        warn("STIM-REF", f"stimulus_ref '{sref}' is not a well-formed stimulus_id; store resolution is checked app-side")


# ---- ADV: REF-21 advisory lexicon scan (plan surface only, D-#4 / 5-B) ---
DEMO_LEXICON = [
    {"term": "mawlid", "category": "bid'ah-celebration"},
    {"term": "urs", "category": "saint-veneration"},
    {"term": "dance", "category": "music-dance"},
    {"term": "song", "category": "music-dance"},
]

def load_lexicon(path):
    if not path:
        return DEMO_LEXICON, True
    raw = load_json(path)
    norm = [({"term": x, "category": "?"} if isinstance(x, str) else x) for x in raw]
    return norm, False

def ref21_advisory(env, lexicon, is_demo):
    # Plan surface only. Question/stimulus payloads are NOT scanned here (decision 5-B):
    # curation is gated build-side by the REF-01 + REF-21 self-scan.
    if env.get("doc_type") not in PLAN_DOC_TYPES:
        return
    surface = env.get("rendered_markdown", "") or ""
    if not surface:
        return
    low = surface.lower()
    for entry in lexicon:
        term = entry["term"].lower()
        if re.search(r"\b" + re.escape(term) + r"\b", low):
            advise("REF21", f"possible curation trigger '{entry['term']}' "
                            f"({entry.get('category','?')}) on the surface — advisory only, not blocking")
    if is_demo and ADVISORIES:
        advise("REF21-NOTE", "scan used the DEMO lexicon; wire the real REF-21 lexicon via --lexicon")


def load_ref19(path):
    if not path:
        return REF19_SLUGS_DEFAULT
    raw = load_json(path)
    return set(raw)


# ---- orchestration ------------------------------------------------------
def run(env_path, env_schema_path, schema_paths, ref19_slugs, lexicon_path):
    env = load_json(env_path)
    env_schema = load_json(env_schema_path)
    layer1_envelope(env, env_schema)
    if not any(c == "ENVELOPE" for c, _ in FAILS):
        dt = env.get("doc_type")
        if dt in PLAN_DOC_TYPES:
            layer2_payload(env, load_json(schema_paths["plan"]), "PAYLOAD")
        elif dt == "question":
            layer2_payload(env, load_json(schema_paths["question"]), "Q-PAYLOAD")
        elif dt == "stimulus":
            layer2_payload(env, load_json(schema_paths["stimulus"]), "S-PAYLOAD")
        # question_set: no closed schema (app-generated) — envelope marker only.
        consistency(env)
        question_semantics(env, ref19_slugs)
        lexicon, is_demo = load_lexicon(lexicon_path)
        ref21_advisory(env, lexicon, is_demo)
    return env


def make_batch_record(env, env_path, verdict):
    prov = env.get("provenance", {})
    return {"import_batch": {
        "source_file": os.path.basename(env_path),
        "doc_type": env.get("doc_type"), "subject": env.get("subject"),
        "class_level": env.get("class_level"), "source_project": prov.get("source_project"),
        "author": prov.get("author"), "content_version": prov.get("content_version"),
        "review_status": env.get("review_status"), "verdict": verdict,
        "advisories": [f"[{c}] {m}" for c, m in ADVISORIES],
        "warnings": [f"[{c}] {m}" for c, m in WARNS],
    }}


def main():
    ap = argparse.ArgumentParser(description="School Software import conformance harness")
    ap.add_argument("envelope")
    ap.add_argument("--envelope-schema")
    ap.add_argument("--plan-schema")
    ap.add_argument("--question-schema")
    ap.add_argument("--stimulus-schema")
    ap.add_argument("--ref19-registry")
    ap.add_argument("--lexicon")
    ap.add_argument("--emit-batch", action="store_true")
    args = ap.parse_args()

    env_schema_path = _resolve(args.envelope_schema, ["*ImportEnvelope*Schema*.json", "*ImportEnvelope*.json"], "envelope schema")
    # Payload schemas resolved lazily-but-eagerly here; only the one matching doc_type is loaded.
    dt = load_json(args.envelope).get("doc_type")
    schema_paths = {}
    if dt in PLAN_DOC_TYPES:
        schema_paths["plan"] = _resolve(args.plan_schema, ["*PlanSchema*.json"], "plan schema")
    elif dt == "question":
        schema_paths["question"] = _resolve(args.question_schema, ["*QuestionPayload*.json"], "question schema")
    elif dt == "stimulus":
        schema_paths["stimulus"] = _resolve(args.stimulus_schema, ["*StimulusPayload*.json"], "stimulus schema")

    ref19_slugs = load_ref19(args.ref19_registry)
    env = run(args.envelope, env_schema_path, schema_paths, ref19_slugs, args.lexicon)

    name = os.path.basename(args.envelope)
    print(f"\n=== {name} ===")
    for c, m in ADVISORIES: print(f"  ADVISORY [{c}] {m}")
    for c, m in WARNS:      print(f"  WARN     [{c}] {m}")
    for c, m in FAILS:      print(f"  FAIL     [{c}] {m}")

    if FAILS:
        print(f"RESULT: FAIL ({len(FAILS)} fail, {len(WARNS)} warn, {len(ADVISORIES)} advisory) — import REJECTED")
        sys.exit(1)
    print(f"RESULT: PASS ({len(WARNS)} warn, {len(ADVISORIES)} advisory) — importable")
    if args.emit_batch:
        print(json.dumps(make_batch_record(env, args.envelope, "PASS"), ensure_ascii=False, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()

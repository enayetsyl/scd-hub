#!/usr/bin/env python3
"""
validate_import.py — School Software import conformance harness.

  python3 validate_import.py <envelope.json> \
      [--envelope-schema <ImportEnvelope_v1.json>] \
      [--plan-schema <C5_PlanSchema_v1.json>] \
      [--lexicon <REF-21_lexicon.json>] \
      [--emit-batch]

This is the app's ingestion gate (REQ §4 R-IMP3). It mirrors Project 03's two-layer
philosophy (executed checks, not self-graded) and is the publisher-side equivalent of
validate_plan.py — it does NOT replace it. Project 03 remains the authority on full plan
conformance at authoring time; this harness ensures what arrives at the app is a well-formed
envelope wrapping a structurally-valid, internally-consistent payload.

Layers:
  L1  Envelope schema        — outer contract (Draft 2020-12) + doc_type discriminator.
  L2  Payload schema         — for plan doc-types, validate payload against the locked
                               Project-03 plan schema (payload is the whole plan artifact).
                               (Question payloads are already gated by the envelope schema's
                               provisional $ref; tightened when Project 04 ratifies.)
  L3  Consistency            — envelope's indexed copies (subject/class_level/curation_tag/
                               address/pinned_to) must agree with the payload. Cross-nesting
                               equality JSON Schema can't express cleanly — lives here.
  ADV REF-21 lexicon scan    — ADVISORY ONLY (D-#4). Flags possible curation triggers on the
                               teacher surface; never blocks. Curation authority stays upstream.

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


def _resolve(explicit, patterns, label):
    """Resolve a schema path: explicit wins; else glob next to this script, preferring LOCKED."""
    if explicit:
        if not os.path.exists(explicit):
            sys.exit(f"ERROR: {label} not found at {explicit}")
        return explicit
    cands = []
    for pat in patterns:
        cands += glob.glob(os.path.join(HERE, pat))
    # prefer LOCKED, then shortest basename (bare/current)
    cands = sorted(set(cands), key=lambda p: (("LOCKED" not in os.path.basename(p)), len(os.path.basename(p))))
    if not cands:
        sys.exit(f"ERROR: {label} not found (looked for {patterns} next to validate_import.py); pass it explicitly.")
    return cands[0]


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


# ---- L1: envelope schema ------------------------------------------------
def layer1_envelope(env, env_schema):
    v = Draft202012Validator(env_schema)
    for e in sorted(v.iter_errors(env), key=lambda e: list(e.path)):
        fail("ENVELOPE", f"{list(e.path)}: {e.message}")


# ---- L2: payload schema (plan types) ------------------------------------
def layer2_payload(env, plan_schema):
    if env.get("doc_type") in PLAN_DOC_TYPES:
        payload = env.get("payload", {})
        v = Draft202012Validator(plan_schema)
        for e in sorted(v.iter_errors(payload), key=lambda e: list(e.path)):
            fail("PAYLOAD", f"payload{list(e.path)}: {e.message}")
    # question / question_set: payload gated by the envelope schema (provisional). No second pass yet.


# ---- L3: envelope <-> payload consistency -------------------------------
def consistency(env):
    if env.get("doc_type") not in PLAN_DOC_TYPES:
        return  # plan-only checks; question payloads carry their own refs
    p = env.get("payload", {})
    for field in ("subject", "class_level", "curation_tag"):
        if field in env and field in p and env[field] != p[field]:
            fail("XF", f"envelope.{field}={env[field]!r} != payload.{field}={p[field]!r}")
    # address (envelope) must equal division (payload)
    addr, div = env.get("address"), p.get("division")
    if addr and div:
        for k in ("anchor_word", "number", "title"):
            if addr.get(k) != div.get(k):
                fail("XF-ADDR", f"envelope.address.{k}={addr.get(k)!r} != payload.division.{k}={div.get(k)!r}")
    # pinned_to mismatch is a WARN (re-conformance may be owed, like the plan harness PIN warn)
    ep, pp = env.get("pinned_to") or {}, p.get("pinned_to") or {}
    for k in set(ep) | set(pp):
        if ep.get(k) != pp.get(k):
            warn("PIN", f"pinned_to.{k}: envelope={ep.get(k)!r} payload={pp.get(k)!r}")


# ---- ADV: REF-21 advisory lexicon scan (non-blocking, D-#4) --------------
# PLACEHOLDER lexicon. The AUTHORITATIVE REF-21 Curation Trigger Lexicon lives upstream
# (Project 00/02). Wire it in via --lexicon (a JSON array of {"term","category"} or plain
# strings). This default is a tiny demo only and must not be mistaken for the real lexicon.
DEMO_LEXICON = [
    {"term": "mawlid", "category": "bid'ah-celebration"},
    {"term": "urs", "category": "saint-veneration"},
    {"term": "dance", "category": "music-dance"},
    {"term": "song", "category": "music-dance"},
]

def load_lexicon(path):
    if not path:
        return DEMO_LEXICON, True  # (lexicon, is_demo)
    raw = load_json(path)
    norm = [({"term": x, "category": "?"} if isinstance(x, str) else x) for x in raw]
    return norm, False

def ref21_advisory(env, lexicon, is_demo):
    # Scan the teacher-facing surface only: rendered_markdown (+ obvious payload text).
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


# ---- orchestration ------------------------------------------------------
def run(env_path, env_schema_path, plan_schema_path, lexicon_path):
    env = load_json(env_path)
    env_schema = load_json(env_schema_path)
    layer1_envelope(env, env_schema)
    # Only proceed to deeper layers if the envelope itself is well-formed enough to traverse.
    if not any(c == "ENVELOPE" for c, _ in FAILS):
        if env.get("doc_type") in PLAN_DOC_TYPES:
            plan_schema = load_json(plan_schema_path)
            layer2_payload(env, plan_schema)
        consistency(env)
        lexicon, is_demo = load_lexicon(lexicon_path)
        ref21_advisory(env, lexicon, is_demo)
    return env


def make_batch_record(env, env_path, verdict):
    """The ImportBatch audit record the app would persist on a PASS (R-IMP3)."""
    prov = env.get("provenance", {})
    return {
        "import_batch": {
            "source_file": os.path.basename(env_path),
            "doc_type": env.get("doc_type"),
            "subject": env.get("subject"),
            "class_level": env.get("class_level"),
            "source_project": prov.get("source_project"),
            "author": prov.get("author"),
            "content_version": prov.get("content_version"),
            "review_status": env.get("review_status"),
            "verdict": verdict,
            "advisories": [f"[{c}] {m}" for c, m in ADVISORIES],
            "warnings": [f"[{c}] {m}" for c, m in WARNS],
        }
    }


def main():
    ap = argparse.ArgumentParser(description="School Software import conformance harness")
    ap.add_argument("envelope", help="envelope instance JSON to validate")
    ap.add_argument("--envelope-schema", help="ImportEnvelope schema (default: glob next to this script)")
    ap.add_argument("--plan-schema", help="Project-03 plan schema (default: glob next to this script)")
    ap.add_argument("--lexicon", help="REF-21 lexicon JSON (default: built-in DEMO, advisory only)")
    ap.add_argument("--emit-batch", action="store_true", help="print the ImportBatch record on PASS")
    args = ap.parse_args()

    env_schema_path = _resolve(args.envelope_schema, ["*ImportEnvelope*Schema*.json", "*ImportEnvelope*.json"], "envelope schema")
    plan_schema_path = _resolve(args.plan_schema, ["*PlanSchema*.json"], "plan schema") if True else None

    env = run(args.envelope, env_schema_path, plan_schema_path, args.lexicon)

    name = os.path.basename(args.envelope)
    print(f"\n=== {name} ===")
    for c, m in ADVISORIES:
        print(f"  ADVISORY [{c}] {m}")
    for c, m in WARNS:
        print(f"  WARN     [{c}] {m}")
    for c, m in FAILS:
        print(f"  FAIL     [{c}] {m}")

    if FAILS:
        print(f"RESULT: FAIL ({len(FAILS)} fail, {len(WARNS)} warn, {len(ADVISORIES)} advisory) — import REJECTED")
        sys.exit(1)
    print(f"RESULT: PASS ({len(WARNS)} warn, {len(ADVISORIES)} advisory) — importable")
    if args.emit_batch:
        print(json.dumps(make_batch_record(env, args.envelope, "PASS"), ensure_ascii=False, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()

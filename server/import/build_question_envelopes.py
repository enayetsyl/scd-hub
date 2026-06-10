#!/usr/bin/env python3
"""
build_question_envelopes.py — fan a Project-04 question-bank JSON (a COLLECTION of
stimuli + questions) out into N single-doc import envelopes (one per stimulus, one per
question). The app builds the envelopes so authors never hand-write them — the question
analog of build_envelope.py (which wraps ONE plan), the difference being that a question
bank is one-doc-per-item while a plan is one document.

WHY a fan-out (not a 1:1 wrap): the import envelope is one-doc-per-file, and the app stores
one ContentArtifact per question / per stimulus riding the LOCKED *single-item* payloads
(LOCKED_QuestionPayload_Schema_v1.json / LOCKED_StimulusPayload_Schema_v1.json). A bank file
carrying {stimuli:[...], questions:[...]} therefore expands to len(stimuli)+len(questions)
envelopes, each then run UNCHANGED through validate_import.py (this script does not validate).

DERIVED FROM THE DATA, not fabricated — like build_envelope.py:
  * envelope STRUCTURE (envelope_version const, required field sets, addressBlock keys,
    provenance keys) is read from the envelope schema (docs/import-contract.schema.json).
  * subject / class_level / unit are PARSED from the item ids (the durable identity):
        qid          QP-{SUBJ}-C{n}-U{u}[-L{l}]-Q{nn}
        stimulus_id  STIM-{SUBJ}-C{n}-U{u}[-L{l}]-{nn}
    every item in a bank must agree on (subject, class_level, unit); a mixed bank is refused.
  * question tags {topic_tag, bloom_level, difficulty, paper_role} are COPIED VERBATIM from
    each question payload — validate_import.py L3 requires the envelope tags to MIRROR the
    payload, so they are a straight copy, nothing invented. Stimuli carry NO tags mirror.
  * payload = the item object, UNCHANGED (no item-internal key is lifted or mutated).

INJECTED (the bank does not carry these): envelope_version (schema const); review_status
= 'draft' (schema default, same as the plan auto-wrap); address = {anchor_word:'Unit',
number:<unit>, title:<--unit-title or "Unit <n>">} — required by the storage model + the
addressBlock; provenance {source_project='P04', author, content_version, source_filename};
curation_tag = --curation-tag (the storage model requires it; questions/stimuli do not carry
a curation decision — it is supplied by the importing user, default chosen in the UI).

Questions/stimuli are APP-RENDERED: NO rendered_markdown is attached (ADR-006 applies to
plans). The bank's companion .md / register .tsv are human read-views and are NOT imported.

Usage:
  python build_question_envelopes.py --json <bank.json>
      --curation-tag {KEEP_AS_IS|NEEDS_REPLACEMENT|FLEXIBLE}
      [--envelope-schema <path>]   (default: ../../docs/import-contract.schema.json)
      [--author NAME] [--source-file NAME] [--unit-title TITLE] [--out PATH]

Exit 0 = a JSON ARRAY of envelopes written to --out or stdout (UTF-8; stimuli first, then
questions). Exit 2 = refused (not a bank collection / already an envelope / a plan / a mixed
bank / an item id that does not parse / a required envelope field with no honest source).
The emitted envelopes are NOT validated here — each is then run through validate_import.py.
"""
import sys, os, re, json, argparse

# Force UTF-8 stdio: when spawned by Node (not a terminal) stdout defaults to the
# system locale (cp1252 on Windows), which cannot encode the Bangla envelope.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ENV_SCHEMA = os.path.normpath(os.path.join(HERE, "..", "..", "docs", "import-contract.schema.json"))

# Identity parsers (the qid/stimulus_id schemes the LOCKED payloads pin down).
QID_RE = re.compile(r"^QP-([A-Z]+)-C([1-5])-U(\d+)(?:-L\d+)?-Q\d{2,}$")
STIM_RE = re.compile(r"^STIM-([A-Z]+)-C([1-5])-U(\d+)(?:-L\d+)?-\d{2,}$")


def die(msg, code=2):
    sys.stderr.write(f"BUILD-QUESTION-ENVELOPES ERROR: {msg}\n")
    sys.exit(code)


def read_text(path, label):
    if not path:
        die(f"missing {label} input")
    if not os.path.exists(path):
        die(f"{label} not found at {path}")
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    if not text.strip():
        die(f"{label} at {path} is empty")
    return text


def derive_content_version(source_file, bank):
    # Sensible, non-fabricated default: the version token in the source filename
    # (…_v1.json -> "v1"), else the bank's own schema_version/version, else None.
    if source_file:
        m = re.search(r"_v(\d+[a-z]?)", os.path.basename(source_file), re.IGNORECASE)
        if m:
            return f"v{m.group(1)}"
    sv = bank.get("schema_version") or bank.get("version")
    return str(sv) if sv else None


def parse_identity(item_id, regex, label):
    m = regex.match(item_id or "")
    if not m:
        die(f"{label} '{item_id}' does not parse (expected e.g. QP-ENG-C5-U09-Q01 / STIM-ENG-C5-U09-01); "
            f"subject/class/unit are read from the id and cannot be guessed")
    return m.group(1), int(m.group(2)), int(m.group(3))  # subject, class_level, unit


def main():
    ap = argparse.ArgumentParser(description="Fan a Project-04 question bank out into per-item import envelopes")
    ap.add_argument("--json", dest="json_path")
    ap.add_argument("--curation-tag", dest="curation_tag")
    ap.add_argument("--envelope-schema", default=DEFAULT_ENV_SCHEMA)
    ap.add_argument("--author", default="Principal")
    ap.add_argument("--source-file")
    ap.add_argument("--unit-title")
    ap.add_argument("--out")
    args = ap.parse_args()

    if not args.json_path:
        die("no input: a question-bank import needs the bank JSON (--json <bank.json>)")
    bank_text = read_text(args.json_path, "bank JSON")
    try:
        bank = json.loads(bank_text)
    except json.JSONDecodeError as e:
        die(f"bank JSON is not valid JSON: {e}")
    if not isinstance(bank, dict):
        die("bank JSON must be a JSON object")

    # --- What kind of file is this? -----------------------------------------
    if "envelope_version" in bank:
        die("this JSON is already an import envelope (has envelope_version) — import it directly, do not wrap")
    if bank.get("plan_type"):
        die("this JSON is a Project-03 plan (has plan_type) — use build_envelope.py / a plan JSON+MD pair")
    stimuli = bank.get("stimuli") or []
    questions = bank.get("questions") or []
    if not isinstance(stimuli, list) or not isinstance(questions, list):
        die("'stimuli' and 'questions' must be arrays")
    if not stimuli and not questions:
        if bank.get("question_type") or bank.get("stimulus_type"):
            die("this JSON is a single question/stimulus payload, not a bank — wrap it in {\"questions\":[...]} "
                "or import a built envelope")
        die("not a question bank: expected a 'questions' and/or 'stimuli' array")

    if not args.curation_tag:
        die("--curation-tag is required (the storage model needs a curation_tag; questions do not carry one). "
            "Supply one of KEEP_AS_IS / NEEDS_REPLACEMENT / FLEXIBLE")

    # --- Load the envelope schema (authority for structure) -----------------
    if not os.path.exists(args.envelope_schema):
        die(f"envelope schema not found at {args.envelope_schema} (pass --envelope-schema)")
    with open(args.envelope_schema, encoding="utf-8") as fh:
        env_schema = json.load(fh)
    props = env_schema.get("properties", {})
    env_version = props.get("envelope_version", {}).get("const", "1.0")
    addr_keys = list(env_schema.get("$defs", {}).get("addressBlock", {}).get("properties", {}).keys()) \
        or ["anchor_word", "number", "title"]
    prov_props = props.get("provenance", {}).get("properties", {})
    prov_required = props.get("provenance", {}).get("required", [])
    curation_enum = props.get("curation_tag", {}).get("enum")
    if curation_enum and args.curation_tag not in curation_enum:
        die(f"--curation-tag '{args.curation_tag}' is not one of {curation_enum}")

    content_version = derive_content_version(args.source_file or args.json_path, bank)
    source_filename = os.path.basename(args.source_file) if args.source_file else os.path.basename(args.json_path)

    def provenance():
        prov = {
            "source_project": "P04",
            "author": args.author,
            "content_version": content_version,
            "source_filename": source_filename,
        }
        return {k: v for k, v in prov.items() if k in prov_props and v is not None}

    # --- One subject/class/unit for the whole bank (refuse a mixed bank) -----
    identity = None  # (subject, class_level, unit)

    def reconcile(item_id, regex, label):
        nonlocal identity
        ident = parse_identity(item_id, regex, label)
        if identity is None:
            identity = ident
        elif ident != identity:
            die(f"mixed bank: {label} '{item_id}' is {ident} but the bank started as {identity}; "
                f"one bank file is a single subject/class/unit")
        return ident

    envelopes = []

    # --- Stimuli first (a question may reference one; order is cosmetic since
    #     stimulus_ref resolution is app-side, not gate-enforced) -------------
    for s in stimuli:
        if not isinstance(s, dict):
            die("each stimulus must be a JSON object")
        sid = s.get("stimulus_id")
        subject, class_level, unit = reconcile(sid, STIM_RE, "stimulus_id")
        address = {"anchor_word": "Unit", "number": unit, "title": args.unit_title or f"Unit {unit}"}
        env = {
            "envelope_version": env_version,
            "doc_type": "stimulus",
            "subject": subject,
            "class_level": class_level,
            "address": address,
            "curation_tag": args.curation_tag,
            "review_status": "draft",
            "provenance": provenance(),
            "payload": s,  # UNCHANGED
        }
        envelopes.append(env)

    # --- Questions ----------------------------------------------------------
    for q in questions:
        if not isinstance(q, dict):
            die("each question must be a JSON object")
        qid = q.get("qid")
        subject, class_level, unit = reconcile(qid, QID_RE, "qid")
        address = {"anchor_word": "Unit", "number": unit, "title": args.unit_title or f"Unit {unit}"}
        # Tags MIRROR the payload (validate_import.py L3 reconciles these for questions).
        tags = {}
        for k in ("topic_tag", "bloom_level", "difficulty", "paper_role"):
            if q.get(k) is not None:
                tags[k] = q[k]
        env = {
            "envelope_version": env_version,
            "doc_type": "question",
            "subject": subject,
            "class_level": class_level,
            "address": address,
            "curation_tag": args.curation_tag,
            "review_status": "draft",
            "tags": tags,
            "provenance": provenance(),
            "payload": q,  # UNCHANGED
        }
        envelopes.append(env)

    if not envelopes:
        die("nothing to import: the bank has no stimuli and no questions")

    # --- Refuse to ship any envelope missing a REQUIRED field ---------------
    required = set(env_schema.get("required", []))
    for env in envelopes:
        ref = (env.get("payload", {}) or {}).get("qid") or (env.get("payload", {}) or {}).get("stimulus_id") or env["doc_type"]
        missing = [f for f in sorted(required) if f not in env or env[f] in (None, "", {})]
        prov = env.get("provenance", {})
        prov_missing = [k for k in prov_required if k not in prov or prov[k] in (None, "")]
        if prov_missing:
            missing.append(f"provenance.{{{','.join(prov_missing)}}}")
        if missing:
            die(f"cannot build a valid envelope for '{ref}' — no source (and no sensible default) for: "
                + ", ".join(missing) + ". Fix the bank or supply the field; nothing fabricated.")

    out_text = json.dumps(envelopes, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(out_text)
        sys.stderr.write(f"wrote {len(envelopes)} envelopes to {args.out}\n")
    else:
        sys.stdout.write(out_text)
    sys.exit(0)


if __name__ == "__main__":
    main()

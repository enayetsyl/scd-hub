#!/usr/bin/env python3
"""
build_envelope.py — auto-wrap a Project-03 plan (JSON) + its rendered Markdown into a
School-Hub import envelope (J1.1 ingest convenience; the app builds the envelope so authors
never hand-write one).

The wrap is DERIVED FROM THE LIVE CONTRACTS, not hardcoded:
  * envelope STRUCTURE (envelope_version const, required fields, the provenance/address key
    sets) is read from the envelope schema (docs/import-contract.schema.json).
  * the plan->envelope FIELD CORRESPONDENCES are exactly the indexed copies the gate
    reconciles in validate_import.py `consistency()` (the authority):
        doc_type     <- payload.plan_type        (plan branch requires plan_type == doc_type)
        subject      <- payload.subject
        class_level  <- payload.class_level
        curation_tag <- payload.curation_tag
        address      <- payload.division          (anchor_word / number / title)
        pinned_to    <- payload.pinned_to
  * INJECTED (the plan does not carry these): envelope_version (schema const), review_status
    = 'draft' (schema default), provenance {source_project=P03, author, content_version,
    authored_at, source_filename}, and rendered_markdown = the paired .md verbatim
    (ADR-006 — the app displays/PDFs this and never re-renders).

The plan JSON becomes `payload`, UNCHANGED (no plan-internal key is lifted or mutated).

Pairing contract: a plan JSON is paired to its Markdown by matched filename stem
(X.json <-> X.md). Both must be present; an orphan (plan with no .md, or .md with no plan)
is rejected. This script enforces it on the (--json, --md) pair it is given.

Usage:
  python build_envelope.py --json <plan.json> --md <plan.md>
      [--envelope-schema <path>]   (default: ../../docs/import-contract.schema.json)
      [--author NAME] [--authored-at ISO8601] [--source-file NAME] [--out PATH]

Exit 0 = envelope written to --out or stdout (UTF-8). Exit 2 = refused (orphan / not a plan /
already an envelope / a required envelope field has no source and no sensible default). The
produced envelope is NOT validated here — it is then run through validate_import.py unchanged.
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


def die(msg, code=2):
    sys.stderr.write(f"BUILD-ENVELOPE ERROR: {msg}\n")
    sys.exit(code)


def stem_of(path):
    base = os.path.basename(path)
    return re.sub(r"\.[^.]+$", "", base)


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


def derive_content_version(source_file, plan):
    # Sensible, non-fabricated default: the version token in the source filename
    # (…_v2.json -> "v2"), else the plan's own schema_version, else None.
    if source_file:
        m = re.search(r"_v(\d+[a-z]?)", os.path.basename(source_file), re.IGNORECASE)
        if m:
            return f"v{m.group(1)}"
    sv = plan.get("schema_version")
    return str(sv) if sv else None


def plan_branch_required(env_schema, doc_type):
    """The extra top-level fields the envelope schema requires for this plan doc_type."""
    extra = set()
    for branch in env_schema.get("allOf", []):
        cond = branch.get("if", {}).get("properties", {}).get("doc_type", {})
        if cond.get("const") == doc_type:
            extra |= set(branch.get("then", {}).get("required", []))
    return extra


def main():
    ap = argparse.ArgumentParser(description="Auto-wrap a Project-03 plan + Markdown into an import envelope")
    ap.add_argument("--json", dest="json_path")
    ap.add_argument("--md", dest="md_path")
    ap.add_argument("--envelope-schema", default=DEFAULT_ENV_SCHEMA)
    ap.add_argument("--author", default="Principal")
    ap.add_argument("--authored-at")
    ap.add_argument("--source-file")
    ap.add_argument("--out")
    args = ap.parse_args()

    # --- Pairing contract: both halves must be present, stems must match ----
    if not args.json_path and not args.md_path:
        die("no inputs: a plan import needs a JSON + Markdown pair (--json X.json --md X.md)")
    if args.json_path and not args.md_path:
        die(f"orphan plan JSON '{stem_of(args.json_path)}': no paired .md "
            f"(filename-stem pairing required, e.g. {stem_of(args.json_path)}.md)")
    if args.md_path and not args.json_path:
        die(f"orphan markdown '{stem_of(args.md_path)}': no paired plan .json "
            f"(filename-stem pairing required, e.g. {stem_of(args.md_path)}.json)")
    if stem_of(args.json_path) != stem_of(args.md_path):
        die(f"stem mismatch: '{os.path.basename(args.json_path)}' vs "
            f"'{os.path.basename(args.md_path)}' — pair by matching filename stem")

    json_text = read_text(args.json_path, "plan JSON")
    md_text = read_text(args.md_path, "markdown")

    try:
        plan = json.loads(json_text)
    except json.JSONDecodeError as e:
        die(f"plan JSON is not valid JSON: {e}")
    if not isinstance(plan, dict):
        die("plan JSON must be a JSON object")

    # --- What kind of file is this? -----------------------------------------
    if "envelope_version" in plan:
        die("this JSON is already an import envelope (has envelope_version) — import it directly, do not wrap")
    plan_type = plan.get("plan_type")
    if not plan_type:
        if plan.get("question_type") or plan.get("stimulus_type"):
            die("question/stimulus auto-wrap is not implemented yet (plan pairs only); import a built envelope")
        die("JSON is not a Project-03 plan (no 'plan_type'); only chapter_plan / session_plan pairs auto-wrap")

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

    # --- Map indexed copies from the plan (the gate's consistency() fields) ---
    division = plan.get("division") or {}
    address = {k: division[k] for k in addr_keys if k in division}

    content_version = derive_content_version(args.source_file or args.json_path, plan)

    provenance = {
        "source_project": "P03",
        "author": args.author,
        "content_version": content_version,
        "authored_at": args.authored_at,
        "source_filename": os.path.basename(args.source_file) if args.source_file else os.path.basename(args.json_path),
    }
    # Keep only provenance keys the schema knows, and drop empty optionals.
    provenance = {k: v for k, v in provenance.items() if k in prov_props and v is not None}

    envelope = {
        "envelope_version": env_version,
        "doc_type": plan_type,
        "subject": plan.get("subject"),
        "class_level": plan.get("class_level"),
        "address": address,
        "curation_tag": plan.get("curation_tag"),
        "pinned_to": plan.get("pinned_to"),
        "provenance": provenance,
        "review_status": "draft",
        "rendered_markdown": md_text,
        "payload": plan,
    }
    # Drop optional top-level keys we couldn't source (pinned_to is optional).
    if envelope["pinned_to"] is None:
        del envelope["pinned_to"]

    # --- Refuse to ship an envelope missing a REQUIRED field ----------------
    required = set(env_schema.get("required", [])) | plan_branch_required(env_schema, plan_type)
    missing = [f for f in sorted(required)
               if f not in envelope or envelope[f] in (None, "", {})]
    # address sub-fields the plan must have supplied
    if "address" in required:
        addr_missing = [k for k in addr_keys if k not in address or address[k] in (None, "")]
        if addr_missing:
            missing.append(f"address.{{{','.join(addr_missing)}}} (from payload.division)")
    # provenance required sub-fields
    prov_required = env_schema.get("properties", {}).get("provenance", {}).get("required", [])
    prov_missing = [k for k in prov_required if k not in provenance or provenance[k] in (None, "")]
    if prov_missing:
        missing.append(f"provenance.{{{','.join(prov_missing)}}}")
    if missing:
        die("cannot build a valid envelope — the plan has no source (and no sensible default) for: "
            + ", ".join(missing) + ". Fix the plan or supply the field; nothing fabricated.")

    out_text = json.dumps(envelope, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(out_text)
        sys.stderr.write(f"wrote envelope to {args.out}\n")
    else:
        sys.stdout.write(out_text)
    sys.exit(0)


if __name__ == "__main__":
    main()

/**
 * The support-book validator — the merge gate (SB-1, D-#408/#427).
 *
 * BOTH authoring paths run through this and nothing else: a patch written in Claude
 * Desktop and uploaded, and one emitted by the in-app chat, are the same object
 * through the same checks. That is what stops the API route becoming a second,
 * softer way into a book.
 *
 * PROVENANCE OF EACH CHECK — deliberately recorded, because the two sources disagree
 * about what exists (D-#427):
 *
 *   CLI     = ported from `studybook-pipeline/src/validate-studybook.js`
 *   PY      = ported from `SB-Governance/validator_letter_audit.py`
 *   README  = declared by README §6 but NEVER IMPLEMENTED upstream — written here
 *
 *   C1_JSON_VERSION      CLI     checkTopLevel
 *   C2_INVENTORY_FLAGS   CLI     checkInventory
 *   C3_CODES             README  (see CHECK_PROVENANCE note)
 *   C4_LETTER_AUDIT      PY      letterAudit.ts
 *   C5_GENRE             README
 *   C6_SLOT_BOOLEANS     CLI     checkImages (JSON half only — see below)
 *   C7_SOURCE_NOTE       README  GREY by README's own grading
 *   C8_SCRIPT_GUARD      CLI     checkScriptGuard
 *   C9_NO_STRIPE_LANG    README
 *   C10_MAP_DERIVABLE    README
 *   C11_BW_COMPLETE      CLI     checkBwTreatment
 *   C12_LAYOUT           CLI     checkLayout
 *
 * NOT RUN HERE: the image DPI-floor check. The CLI reads pixels off disk with sharp;
 * at merge time the images live in Drive and many slots are not generated yet. It is
 * an ASSEMBLY gate, and SB-4 runs the CLI itself — so the floor is still enforced
 * before anything prints, just not at the moment a lesson's text merges.
 *
 * RED refuses the merge. GREY merges with a warning. INFO is reported only.
 */
import type { ValidatorCheck, ValidatorSeverity } from "@scd/shared";
import type { ValidatorFinding } from "../../models/LessonPatch";
import { scanTree } from "./scriptGuard";
import { auditBlock, letterAuditApplies, type LetterInventory } from "./letterAudit";

/** Which source each check came from — surfaced in the report so a divergence from
 *  the CLI is visible rather than assumed. */
export const CHECK_PROVENANCE: Record<ValidatorCheck, "CLI" | "PY" | "README"> = {
  C1_JSON_VERSION: "CLI",
  C2_INVENTORY_FLAGS: "CLI",
  C3_CODES: "README",
  C4_LETTER_AUDIT: "PY",
  C5_GENRE: "README",
  C6_SLOT_BOOLEANS: "CLI",
  C7_SOURCE_NOTE: "README",
  C8_SCRIPT_GUARD: "CLI",
  C9_NO_STRIPE_LANGUAGE: "README",
  C10_MAP_DERIVABLE: "README",
  C11_BW_COMPLETE: "CLI",
  C12_LAYOUT: "CLI",
};

const KNOWN_SCHEMA_VERSIONS = ["1.0", "1.1", "1.2", "1.3"];
const VALID_ACTIONS = ["retain", "retain-curated", "replace"];
const VALID_BW = ["native_safe", "redesigned", "print_only_omit"];

/**
 * Compliance-stripe language that must never appear in an image prompt (README §5 /
 * check 9). The white stripe is applied programmatically AFTER generation; asking a
 * model for one produces a drawn stripe, which is not the same object at all.
 *
 * MATCHING IS QUALIFIED, NOT BARE. A first cut matched "strip"/"stripe" anywhere and
 * flagged four slots in the real C1-BAN book — every one a false positive: a *striped
 * tiger*, its *stripes*, a *strip of tablets*, a *strip of grass*. A validator that
 * cries wolf on legitimate art direction gets muted, so the pattern now requires the
 * white/compliance qualifier that actually names the doctrine object.
 */
const STRIPE_PATTERNS: RegExp[] = [
  // "white stripe", "white vertical bar", "white partition band" …
  /\bwhite\s+(?:\w+\s+){0,2}(?:stripe|strip|bar|band|partition)\b/i,
  /\b(?:compliance|modesty)\s+(?:stripe|strip|bar|band|partition)\b/i,
  /\bpartition\s+line\b/i,
  /সাদা\s*(?:ফিতা|পট্টি|বার)/,
  /পার্টিশন/,
];

export interface ValidatorInput {
  book: Record<string, unknown>;
  classLevel: number;
  subject: string;
  /** Required only when the letter audit applies (C1–C2 বাংলা). */
  letterInventory?: LetterInventory | null;
}

export interface ValidatorReport {
  findings: ValidatorFinding[];
  passed: boolean;
  redCount: number;
  greyCount: number;
  /** Checks that did not run, and why — an unrun check must never read as a pass. */
  skipped: Array<{ check: ValidatorCheck; reason: string }>;
}

type Lesson = Record<string, unknown>;

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function validateBook(input: ValidatorInput): ValidatorReport {
  const { book, classLevel, subject, letterInventory } = input;
  const findings: ValidatorFinding[] = [];
  const skipped: ValidatorReport["skipped"] = [];
  const add = (
    check: ValidatorCheck,
    severity: ValidatorSeverity,
    message: string,
    extra: Partial<ValidatorFinding> = {},
  ): void => {
    findings.push({ check, severity, message, ...extra });
  };

  // ---- C1: top level (CLI checkTopLevel) ----------------------------------
  for (const k of ["schema_version", "book_id", "class", "subject", "mode", "lessons"]) {
    if (!(k in book)) add("C1_JSON_VERSION", "RED", `missing top-level field: ${k}`);
  }
  const sv = book.schema_version;
  if (sv !== undefined && !KNOWN_SCHEMA_VERSIONS.includes(String(sv))) {
    add("C1_JSON_VERSION", "GREY", `schema_version ${String(sv)} not in known set ${KNOWN_SCHEMA_VERSIONS.join("/")}`);
  }
  if (!Array.isArray(book.lessons)) {
    add("C1_JSON_VERSION", "RED", "lessons is not an array");
    return finish(findings, skipped);
  }
  const lessons = book.lessons as Lesson[];

  // ---- C2: inventory order / dupes / gaps (CLI checkInventory) ------------
  const nos = lessons.map((l) => num(l.lesson_no) ?? -1);
  const sorted = [...nos].sort((a, b) => a - b);
  if (JSON.stringify(nos) !== JSON.stringify(sorted)) {
    add("C2_INVENTORY_FLAGS", "RED", `lessons not in ascending NCTB order: ${nos.join(",")}`);
  }
  const dupes = [...new Set(nos.filter((n, i) => nos.indexOf(n) !== i))];
  if (dupes.length) add("C2_INVENTORY_FLAGS", "RED", `duplicate lesson_no: ${dupes.join(",")}`);
  for (let i = 1; i < sorted.length; i++) {
    // A gap is GREY, not RED: a partial book must still render for a proof build.
    if (sorted[i] !== sorted[i - 1] + 1) {
      add("C2_INVENTORY_FLAGS", "GREY", `gap in lesson_no between ${sorted[i - 1]} and ${sorted[i]} (ok for partial/proof builds)`);
    }
  }
  // Action flag validity + the Mode-C rule (README §6 check 2).
  const mode = String(book.mode ?? "");
  for (const l of lessons) {
    const ln = num(l.lesson_no);
    const action = l.action;
    if (action !== undefined && !VALID_ACTIONS.includes(String(action))) {
      add("C2_INVENTORY_FLAGS", "RED", `পাঠ${ln}: invalid action "${String(action)}"`, { lessonNo: ln });
    }
    if (mode === "C" && action === "replace") {
      add("C2_INVENTORY_FLAGS", "RED", `পাঠ${ln}: Mode-C book cannot carry action "replace"`, { lessonNo: ln });
    }
  }

  // ---- C8: script guard (CLI checkScriptGuard) ----------------------------
  scanTree(lessons, "lessons", (path, bad, sample) => {
    add("C8_SCRIPT_GUARD", "RED", `${path}: disallowed ${JSON.stringify(bad)} in "${sample}"`);
  });

  // ---- C11: bw treatment (CLI checkBwTreatment) ---------------------------
  for (const l of lessons) {
    const ln = num(l.lesson_no);
    const bt = String(l.bw_treatment ?? "");
    if (!VALID_BW.includes(bt)) {
      add("C11_BW_COMPLETE", "RED", `পাঠ${ln}: bw_treatment "${bt}" invalid`, { lessonNo: ln });
      continue;
    }
    if (bt === "print_only_omit") {
      const notes = typeof l.notes === "string" ? l.notes : "";
      if (!/teacher|colour master|NCTB|রঙিন|মূল/i.test(notes)) {
        add("C11_BW_COMPLETE", "GREY", `পাঠ${ln}: print_only_omit should carry a teacher note pointing to the colour master/NCTB`, { lessonNo: ln });
      }
    }
  }

  // ---- C6: image slots, JSON half (CLI checkImages) -----------------------
  for (const l of lessons) {
    const ln = num(l.lesson_no);
    for (const raw of arr(l.image_slots)) {
      const s = raw as Record<string, unknown>;
      const slotId = typeof s.id === "string" ? s.id : "?";
      const where = `পাঠ${ln}/${slotId}`;
      const isVector = s.action === "vector_asset" || s.image_class === "tracing_asset";
      if (isVector) {
        // Tracing/vector pages render from vector assets; a prompt means someone
        // meant to AI-generate a letter-tracing page, which the doctrine forbids.
        if (s.prompt && s.prompt !== "") {
          add("C6_SLOT_BOOLEANS", "RED", `${where}: vector/tracing slot must have an empty prompt`, { lessonNo: ln, slotId });
        }
        continue;
      }
      if (!("contains_living_being" in s)) {
        add("C6_SLOT_BOOLEANS", "RED", `${where}: missing contains_living_being`, { lessonNo: ln, slotId });
      }
      if (!s.filename) {
        add("C6_SLOT_BOOLEANS", "RED", `${where}: missing filename`, { lessonNo: ln, slotId });
      } else if (s.status !== "approved") {
        add("C6_SLOT_BOOLEANS", "GREY", `${where}: status=${String(s.status)} (not approved)`, { lessonNo: ln, slotId });
      }

      // ---- C9: no stripe language in a prompt (README §6 check 9) ---------
      const prompt = typeof s.prompt === "string" ? s.prompt : "";
      for (const re of STRIPE_PATTERNS) {
        const m = prompt.match(re);
        if (m) {
          add("C9_NO_STRIPE_LANGUAGE", "RED", `${where}: prompt names the compliance stripe ("${m[0]}") — the stripe is applied programmatically, never prompted`, { lessonNo: ln, slotId });
          break;
        }
      }
    }
  }

  // ---- C12: layout composition (CLI checkLayout) --------------------------
  const presets = (book.layout_presets ?? {}) as Record<string, Record<string, unknown>>;
  for (const l of lessons) {
    const ln = num(l.lesson_no);
    const layout = arr(l.layout) as Array<Record<string, unknown>>;
    if (layout.length === 0) continue; // absent => document order; nothing to check
    const blockIds = new Set(arr(l.blocks).map((b) => (b as Record<string, unknown>).id as string));
    const imgIds = new Set(arr(l.image_slots).map((s) => (s as Record<string, unknown>).id as string));
    const placed = new Map<string, number>();
    const rowsSeen: number[] = [];

    for (const row of layout) {
      rowsSeen.push(num(row.row) ?? -1);
      for (const id of arr(row.refs) as string[]) {
        if (!blockIds.has(id) && !imgIds.has(id)) {
          add("C12_LAYOUT", "RED", `পাঠ${ln} row ${String(row.row)}: ref "${id}" resolves to no block/image`, { lessonNo: ln });
        }
        placed.set(id, (placed.get(id) ?? 0) + 1);
      }
      const presetName = typeof row.preset === "string" ? row.preset : null;
      if (presetName) {
        const p = presets[presetName];
        if (!p) {
          add("C12_LAYOUT", "RED", `পাঠ${ln} row ${String(row.row)}: preset "${presetName}" not in layout_presets`, { lessonNo: ln });
        } else {
          if (p.type && row.arrangement && p.type !== row.arrangement) {
            add("C12_LAYOUT", "RED", `পাঠ${ln} row ${String(row.row)}: preset type "${String(p.type)}" != arrangement "${String(row.arrangement)}"`, { lessonNo: ln });
          }
          if (p.type === "side-by-side") {
            const sum = (num(p.image_frac) ?? 0) + (num(p.text_frac) ?? 0);
            if (Math.abs(sum - 1.0) > 1e-6) {
              add("C12_LAYOUT", "RED", `পাঠ${ln} row ${String(row.row)}: preset "${presetName}" fracs sum ${sum} != 1.0`, { lessonNo: ln });
            }
          }
        }
      }
    }
    for (const id of [...blockIds, ...imgIds]) {
      const n = placed.get(id) ?? 0;
      if (n === 0) add("C12_LAYOUT", "RED", `পাঠ${ln}: "${id}" is never placed in any layout row`, { lessonNo: ln });
      if (n > 1) add("C12_LAYOUT", "RED", `পাঠ${ln}: "${id}" placed ${n} times`, { lessonNo: ln });
    }
    const want = Array.from({ length: rowsSeen.length }, (_, i) => i + 1);
    if (JSON.stringify([...rowsSeen].sort((a, b) => a - b)) !== JSON.stringify(want)) {
      add("C12_LAYOUT", "GREY", `পাঠ${ln}: row indices ${rowsSeen.join(",")} not contiguous 1..${rowsSeen.length}`, { lessonNo: ln });
    }
  }

  // ---- C3 / C5 / C7 / C10 (README-declared; no upstream implementation) ---
  for (const l of lessons) {
    const ln = num(l.lesson_no);
    if (arr(l.competency_codes).length === 0 || arr(l.outcome_codes).length === 0) {
      add("C3_CODES", "RED", `পাঠ${ln}: needs ≥1 competency code and ≥1 outcome code`, { lessonNo: ln });
    }
    if (l.action === "replace" && !l.genre) {
      add("C5_GENRE", "RED", `পাঠ${ln}: a replace পাঠ must carry a genre tag`, { lessonNo: ln });
    }
    // C10: the compliance map is DERIVED from these fields, so a missing one makes
    // the map incomplete rather than merely untidy.
    if (!l.action || arr(l.nctb_pages).length === 0) {
      add("C10_MAP_DERIVABLE", "RED", `পাঠ${ln}: compliance map needs action + nctb_pages`, { lessonNo: ln });
    }
    // C7 is GREY by README's own grading — the reviewer resolves it, it never locks.
    for (const raw of arr(l.blocks)) {
      const b = raw as Record<string, unknown>;
      const isNarrative = b.type === "story" || b.type === "oral_text";
      if (isNarrative && b.source === "school" && !b.source_note) {
        add("C7_SOURCE_NOTE", "GREY", `পাঠ${ln}/${String(b.id)}: narrative block without a source_note`, { lessonNo: ln, blockId: String(b.id) });
      }
    }
  }

  // ---- C4: letter audit (PY port) ----------------------------------------
  if (!letterAuditApplies(classLevel, subject)) {
    skipped.push({ check: "C4_LETTER_AUDIT", reason: `not a Class 1–2 বাংলা book (class ${classLevel}, ${subject})` });
  } else if (!letterInventory) {
    // NOT a silent skip: without the inventory the audit cannot run, and a book that
    // needs it must not merge as if it had passed.
    add("C4_LETTER_AUDIT", "RED", "letter inventory missing — a C1–C2 বাংলা book cannot merge unaudited");
  } else {
    for (const l of lessons) {
      const ln = num(l.lesson_no);
      if (ln === undefined) continue;
      for (const raw of arr(l.blocks)) {
        const b = raw as Record<string, unknown>;
        let violations;
        try {
          violations = auditBlock(b, ln, letterInventory);
        } catch (e) {
          add("C4_LETTER_AUDIT", "RED", `পাঠ${ln}: ${(e as Error).message}`, { lessonNo: ln });
          continue;
        }
        for (const v of violations) {
          add("C4_LETTER_AUDIT", "RED", `পাঠ${ln}/${String(b.id)}: ${v.detail} — "${v.unit}"`, {
            lessonNo: ln,
            blockId: typeof b.id === "string" ? b.id : undefined,
            unit: v.unit,
          });
        }
      }
    }
  }

  // ---- C6 image pixels: an ASSEMBLY gate, not a merge gate ----------------
  skipped.push({
    check: "C6_SLOT_BOOLEANS",
    reason: "image DPI floor is checked at assembly (SB-4 runs the CLI with --images); bytes live in Drive at merge time",
  });

  return finish(findings, skipped);
}

function finish(findings: ValidatorFinding[], skipped: ValidatorReport["skipped"]): ValidatorReport {
  const redCount = findings.filter((f) => f.severity === "RED").length;
  const greyCount = findings.filter((f) => f.severity === "GREY").length;
  return { findings, skipped, redCount, greyCount, passed: redCount === 0 };
}

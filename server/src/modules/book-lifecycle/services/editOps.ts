/**
 * The edit-operation engine — contract `book-chapter-edit/v1` (docs/prd-book-lifecycle.md §12.2 —
 * NORMATIVE, D-#1601). Exact-quote operations only, no fuzzy match:
 *
 *  - `before` / `anchor` are matched AFTER NFC normalisation, exactly, against the chapter text as it
 *    stands after the earlier ops of the same list; each must occur exactly once (0 or 2+ → refused);
 *  - ops may not overlap (an op whose matched span touches text an earlier op changed is refused);
 *  - `after ≠ before`; at most 300 ops per chapter; every op cites ≥ 1 ref.
 *
 * Pure: (text, ops) → { text, applied, findings, spans }. Deterministic; unit-tested in bookEditOps.
 */
import { z } from "zod";
import { BOOK_EDIT_REASONS, BOOK_LC_LIMITS, BOOK_REF_RE } from "@scd/shared";
import { ARABIC_RE, extractRegions } from "./markdown";

const ref = z.string().regex(BOOK_REF_RE);
const text = (max: number) => z.string().max(max);

export const OpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replace"), before: text(20_000).min(1), after: text(20_000), refs: z.array(ref).min(1).max(20), reasonBn: text(500).optional() }).strict(),
  z.object({ op: z.literal("insert_after"), anchor: text(20_000).min(1), text: text(20_000).min(1), refs: z.array(ref).min(1).max(20), reasonBn: text(500).optional() }).strict(),
  z.object({ op: z.literal("delete"), before: text(20_000).min(1), refs: z.array(ref).min(1).max(20), reasonBn: text(500).optional() }).strict(),
]);
export type EditOp = z.infer<typeof OpSchema>;

export const ChapterEditSchema = z
  .object({
    schema: z.literal("book-chapter-edit/v1"),
    draft: z.string().min(1).max(100),
    chapter: z.string().regex(/^(front|ch-\d{3,})$/),
    baseSha: z.string().regex(/^[0-9a-f]{64}$/),
    ops: z.array(OpSchema).max(BOOK_LC_LIMITS.opsPerChapter),
    notApplied: z.array(z.object({ ref: ref, reasonBn: text(500) }).strict()).max(200).optional(),
    alsoElsewhere: z.array(z.object({ ref: ref, hintBn: text(500) }).strict()).max(200).optional(),
  })
  .strict();
export type ChapterEdit = z.infer<typeof ChapterEditSchema>;

export const ChangeListRowSchema = z
  .object({
    chapterKey: z.string().regex(/^(front|ch-\d{3,})$/),
    where: text(200).optional(),
    page: text(20).optional(),
    beforeExcerpt: text(300),
    afterExcerpt: text(300),
    reason: text(500).optional(),
    refs: z.array(ref).min(1).max(20),
  })
  .strict();
export type ChangeListRow = z.infer<typeof ChangeListRowSchema>;

export interface OpFinding {
  code: string;
  level: "blocking" | "warning";
  messageBn: string;
  op?: number;
  ref?: string;
}

export interface AppliedOp {
  index: number;
  op: EditOp;
  /** Span in the RESULT text the op produced (for sacred / region checks). */
  start: number;
  end: number;
  /** The old text that span replaced (empty for insert_after). */
  removed: string;
  inserted: string;
  /** The op touched a bl:sacred region or Arabic-script text (VR-12). */
  sacred: boolean;
}

function occurrences(hay: string, needle: string): number[] {
  const out: number[] = [];
  let i = hay.indexOf(needle);
  while (i >= 0) {
    out.push(i);
    if (out.length > 1) break;
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

/** Zod issues → one Bangla line each (VR-2). */
export function schemaFindings(err: z.ZodError): OpFinding[] {
  return err.issues.slice(0, 20).map((i) => ({ code: "VR-2", level: "blocking" as const, messageBn: `${BOOK_EDIT_REASONS.VR2_SCHEMA}: ${i.path.join(".") || "(root)"} — ${i.message}` }));
}

/**
 * Apply ops in order. A refused op is skipped (its finding is blocking for the chapter); the
 * remaining ops still apply so the person sees every problem at once.
 */
export function applyOps(textIn: string, ops: EditOp[]): { text: string; applied: AppliedOp[]; findings: OpFinding[] } {
  let t = textIn.normalize("NFC");
  const findings: OpFinding[] = [];
  const applied: AppliedOp[] = [];
  if (ops.length > BOOK_LC_LIMITS.opsPerChapter) {
    return { text: t, applied, findings: [{ code: "VR-4", level: "blocking", messageBn: BOOK_EDIT_REASONS.VR4_TOO_MANY }] };
  }
  /** Changed spans in the CURRENT text, shifted as later ops edit. */
  let changed: { start: number; end: number }[] = [];
  ops.forEach((raw, index) => {
    const n = index + 1;
    const op = { ...raw } as EditOp;
    const quote = (op.op === "insert_after" ? op.anchor : op.before).normalize("NFC");
    const hits = occurrences(t, quote);
    if (hits.length === 0) return findings.push({ code: "VR-4", level: "blocking", op: n, messageBn: `${BOOK_EDIT_REASONS.VR4_NOT_FOUND} (op ${n})` });
    if (hits.length > 1) return findings.push({ code: "VR-4", level: "blocking", op: n, messageBn: `${BOOK_EDIT_REASONS.VR4_NOT_UNIQUE} (op ${n})` });
    const at = hits[0];
    const span = { start: at, end: at + quote.length };
    if (changed.some((c) => span.start < c.end && c.start < span.end)) {
      return findings.push({ code: "VR-4", level: "blocking", op: n, messageBn: `${BOOK_EDIT_REASONS.VR4_OVERLAP} (op ${n})` });
    }
    let removed = "";
    let inserted = "";
    let start = at;
    if (op.op === "replace") {
      const after = op.after.normalize("NFC");
      if (after === quote) return findings.push({ code: "VR-4", level: "blocking", op: n, messageBn: `${BOOK_EDIT_REASONS.VR4_SAME} (op ${n})` });
      removed = quote;
      inserted = after;
    } else if (op.op === "delete") {
      removed = quote;
    } else {
      start = span.end;
      inserted = op.text.normalize("NFC");
    }
    const sacredRegion = extractRegions(t).some((r) => r.type === "sacred" && span.start < r.end && r.start < span.end + (op.op === "insert_after" ? 1 : 0));
    const sacred = sacredRegion || ARABIC_RE.test(removed) || ARABIC_RE.test(inserted) || (op.op === "insert_after" && ARABIC_RE.test(quote.slice(-1) + t.slice(span.end, span.end + 1)));
    const delta = inserted.length - removed.length;
    t = t.slice(0, start) + inserted + t.slice(start + removed.length);
    changed = changed.map((c) => (c.start >= start + removed.length ? { start: c.start + delta, end: c.end + delta } : c));
    changed.push({ start, end: start + inserted.length });
    applied.push({ index: n, op: raw, start, end: start + inserted.length, removed, inserted, sacred });
  });
  return { text: t, applied, findings };
}

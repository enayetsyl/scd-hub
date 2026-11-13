/**
 * The edit validator — VR-1 … VR-15 (docs/prd-book-lifecycle.md §12.3 — NORMATIVE, D-#1601/#1607).
 *
 * Draft level (a failure refuses the whole submission): VR-1 base, VR-14 coverage, VR-15 (the accept
 * flow — `acceptDraft`). Chapter level (a failure fails that chapter only): VR-2 schema (at parse),
 * VR-3 known refs, VR-4 ops apply (editOps), VR-5 scope, VR-6 markers, VR-7 explained (whole-text),
 * VR-8 pictures, VR-9 regions, VR-10 characters, VR-11 size, VR-12 sacred text, VR-13 rules lexicon.
 * Messages are Bangla, one line, with the chapter key and op number (codes in BOOK_EDIT_REASONS).
 */
import { createHash } from "crypto";
import { BOOK_EDIT_REASONS, BOOK_LC_LIMITS, diffLines, foldWhitespace } from "@scd/shared";
import type { IBookEditDraft, DraftFinding } from "../models/BookEditDraft";
import type { IBookFeedback, IBookInstruction, IBookDecision, IBookRuleSet } from "../models/BookFeedback";
import type { AppliedOp } from "./editOps";
import { ARABIC_RE, MARKER_RE, changedRegions, extractRegions, mediaRefs } from "./markdown";
import { checkCharacters } from "./charGuard";

export interface ValidationContext {
  draft: Pick<IBookEditDraft, "scopeChapterKeys" | "chapters">;
  items: IBookFeedback[];
  instructions: IBookInstruction[];
  /** Ruled decisions of the book (citable as D-n). */
  decisions: IBookDecision[];
  ruleSets: IBookRuleSet[];
  /** media/… paths present in the base version or uploaded to the draft. */
  mediaPaths: Set<string>;
  /** The book's chapter heading level (default 2) — VR-6 counts these outside code fences. */
  headingLevel?: number;
}

export interface ChangeRow {
  chapterKey: string;
  beforeExcerpt: string;
  afterExcerpt: string;
  refs: string[];
}

export interface ChapterCheck {
  key: string;
  base: string;
  next: string;
  mode: "ops" | "whole";
  applied?: AppliedOp[];
  changes: ChangeRow[];
}

export interface ChapterResult {
  findings: DraftFinding[];
  unexplained: { index: number; beforeText: string; afterText: string; runHash?: string; context?: string }[];
  sacredTouched: boolean;
  /** Whole mode: indexes (into the chapter's rows) of rows that cover a run touching sacred text.
   *  Ops mode: the 1-based numbers of the applied ops that touch sacred text. */
  sacredRows: number[];
}

const f = (code: string, level: "blocking" | "warning", messageBn: string, op?: number, ref?: string): DraftFinding => ({ code, level, messageBn, op, ref });

/** Codes a change may cite in this draft (VR-3). */
export function knownRefs(ctx: ValidationContext): Map<string, "item" | "instruction" | "decision"> {
  const m = new Map<string, "item" | "instruction" | "decision">();
  for (const i of ctx.items) m.set(i.code, "item");
  for (const i of ctx.instructions) m.set(i.code, "instruction");
  for (const d of ctx.decisions) if (d.status === "ruled") m.set(d.code, "decision");
  return m;
}

/** Texts a sacred change may copy from, per qualifying ref (VR-12). `item` sources may also be
 *  cited for a deletion (an empty insertion); decision sources only for text they actually give. */
function sacredSources(ctx: ValidationContext): Map<string, { texts: string[]; item: boolean }> {
  const out = new Map<string, { texts: string[]; item: boolean }>();
  const fold = (t: string) => foldWhitespace(t.normalize("NFC"));
  for (const i of ctx.items) {
    if (i.category !== "sacred_text" || i.route !== "needs_reviewer") continue;
    const v = i.reviewerRuling?.verdict;
    if (v !== "agree" && v !== "modify") continue;
    out.set(i.code, { texts: [i.textBn, i.reviewerRuling?.noteBn ?? ""].filter(Boolean).map(fold), item: true });
  }
  for (const d of ctx.decisions) {
    if (d.status !== "ruled" || !d.ruling) continue;
    const opt = d.options.find((o) => o.key === d.ruling?.optionKey)?.textBn ?? "";
    out.set(d.code, { texts: [d.ruling.textBn ?? "", opt].filter(Boolean).map(fold), item: false });
  }
  return out;
}

/** The lexicon pairs of the active rule sets: a fenced ```bl-lexicon block, one `wrong → right` per line. */
export function lexicon(ruleSets: IBookRuleSet[]): { key: string; wrong: string; right: string }[] {
  const out: { key: string; wrong: string; right: string }[] = [];
  for (const rs of ruleSets) {
    for (const m of rs.bodyMarkdown.matchAll(/```bl-lexicon\n([\s\S]*?)```/g)) {
      for (const line of m[1].split("\n")) {
        const p = /^\s*(.+?)\s*(?:→|->|=>)\s*(.+?)\s*$/.exec(line);
        if (p) out.push({ key: rs.key, wrong: p[1].normalize("NFC"), right: p[2].normalize("NFC") });
      }
    }
  }
  return out;
}

const SACRED_MARKER_G = /<!--\s*bl:sacred (?:start|end)[^>]*-->/g;
/** Chapter markers and every `bl:sacred start/end` marker (they are immutable like the others). */
function markers(t: string): string[] {
  return [...t.split("\n").filter((l) => MARKER_RE.test(l)), ...(t.match(SACRED_MARKER_G) ?? [])];
}

/** Chapter-level headings outside code fences. */
function headingCount(t: string, level: number): number {
  let fence = false;
  let n = 0;
  for (const line of t.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (!fence && new RegExp(`^#{${level}}\\s+\\S`).test(line)) n++;
  }
  return n;
}

const LETTER = /[\p{L}\p{M}\p{N}]/u;
/** `needle` occurs in `hay` as whole words (no letter/mark/digit touching either end). */
function hasWord(hay: string, needle: string): boolean {
  if (!needle) return false;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    const before = i > 0 ? hay[i - 1] : "";
    const after = i + needle.length < hay.length ? hay[i + needle.length] : "";
    if ((!before || !LETTER.test(before) || !LETTER.test(needle[0])) && (!after || !LETTER.test(after) || !LETTER.test(needle[needle.length - 1]))) return true;
    i = hay.indexOf(needle, i + 1);
  }
  return false;
}

function multiset(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of list) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}
function sameMultiset(a: string[], b: string[]): boolean {
  const A = multiset(a);
  const B = multiset(b);
  if (A.size !== B.size) return false;
  for (const [k, v] of A) if (B.get(k) !== v) return false;
  return true;
}

/** A row is usable only when its excerpts really are in the texts: the before excerpt in the base,
 *  the after excerpt in the new text (whitespace-folded). A row naming text that is not there explains nothing. */
export function validRows(rows: ChangeRow[], base: string, next: string): ChangeRow[] {
  const B = foldWhitespace(base);
  const N = foldWhitespace(next);
  return rows.filter((c) => {
    const b = foldWhitespace(c.beforeExcerpt);
    const a = foldWhitespace(c.afterExcerpt);
    if (!b && !a) return false;
    return (!b || B.includes(b)) && (!a || N.includes(a));
  });
}

/** A change run is explained when one row's before excerpt holds its removed words and the after
 *  excerpt its added words, as whole words (a short insertion cannot hide inside a longer word). */
export function runCovered(removed: string, added: string, rows: ChangeRow[]): boolean {
  const R = foldWhitespace(removed);
  const A = foldWhitespace(added);
  return rows.some((c) => {
    const b = foldWhitespace(c.beforeExcerpt);
    const a = foldWhitespace(c.afterExcerpt);
    if (!b && !a) return false;
    return (!R || hasWord(b, R)) && (!A || hasWord(a, A));
  });
}

function sacredSpans(t: string): { start: number; end: number }[] {
  const spans = extractRegions(t).filter((r) => r.type === "sacred").map((r) => ({ start: r.start, end: r.end }));
  const re = new RegExp(`${ARABIC_RE.source}+(?:[\\s\\u064B-\\u065F]*${ARABIC_RE.source}+)*`, "g");
  for (const m of t.matchAll(re)) spans.push({ start: m.index!, end: m.index! + m[0].length });
  return spans;
}

export interface Run {
  removed: string;
  added: string;
  /** The run touches sacred text of the BASE (a bl:sacred region or Arabic-script text), or adds Arabic. */
  sacred: boolean;
  /** The whole changed lines the run sits in (what the person is shown). */
  lineBefore: string;
  lineAfter: string;
}

/** Word-level change runs of base → next, each judged against the BASE text's sacred spans. */
export function runsOf(base: string, next: string): Run[] {
  const spans = sacredSpans(base);
  const lineStart = (line: number) => base.split("\n").slice(0, line).join("\n").length + (line > 0 ? 1 : 0);
  const out: Run[] = [];
  for (const h of diffLines(base, next)) {
    let pos = lineStart(h.aStart);
    let cur: Run | null = null;
    const flush = () => {
      if (cur && (foldWhitespace(cur.removed) || foldWhitespace(cur.added))) out.push(cur);
      cur = null;
    };
    for (const w of h.words) {
      if (w.op === "eq") {
        flush();
        pos += w.text.length;
      } else if (w.op === "del") {
        cur ??= { removed: "", added: "", sacred: false, lineBefore: h.removed.join("\n"), lineAfter: h.added.join("\n") };
        cur.removed += w.text;
        if (ARABIC_RE.test(w.text) || spans.some((sp) => pos < sp.end && sp.start < pos + w.text.length)) cur.sacred = true;
        pos += w.text.length;
      } else {
        cur ??= { removed: "", added: "", sacred: false, lineBefore: h.removed.join("\n"), lineAfter: h.added.join("\n") };
        cur.added += w.text;
        if (ARABIC_RE.test(w.text) || spans.some((sp) => pos >= sp.start && pos <= sp.end)) cur.sacred = true;
      }
    }
    flush();
  }
  return out;
}

export function validateChapter(ctx: ValidationContext, c: ChapterCheck): ChapterResult {
  const findings: DraftFinding[] = [];
  const known = knownRefs(ctx);
  const itemsByCode = new Map(ctx.items.map((i) => [i.code, i]));
  const refsUsed = c.mode === "ops" ? (c.applied ?? []).flatMap((a) => a.op.refs) : c.changes.filter((x) => x.chapterKey === c.key).flatMap((x) => x.refs);
  const tag = (m: string, op?: number) => `${c.key}${op ? ` op ${op}` : ""}: ${m}`;

  // VR-3 known refs
  for (const r of new Set(refsUsed)) {
    if (!known.has(r)) findings.push(f("VR-3", "blocking", tag(`${BOOK_EDIT_REASONS.VR3_UNKNOWN_REF} ${r}`), undefined, r));
    const it = itemsByCode.get(r);
    if (it && (it.status === "rejected" || it.status === "duplicate")) findings.push(f("VR-3", "blocking", tag(`${BOOK_EDIT_REASONS.VR3_DEAD_REF} ${r}`), undefined, r));
  }
  const changed = c.base !== c.next;
  if (!changed) return { findings, unexplained: [], sacredTouched: false, sacredRows: [] };

  // VR-5 scope
  if (ctx.draft.scopeChapterKeys.length && !ctx.draft.scopeChapterKeys.includes(c.key)) findings.push(f("VR-5", "blocking", tag(BOOK_EDIT_REASONS.VR5_SCOPE)));
  if (c.key === "front" && !ctx.items.some((i) => i.anchor?.chapterKey === "front")) findings.push(f("VR-5", "blocking", tag(BOOK_EDIT_REASONS.VR5_FRONT)));

  // VR-6 markers: same marker lines, and the chapter's head (up to its marker) unchanged
  const mb = markers(c.base);
  const mn = markers(c.next);
  const headOf = (t: string) => {
    const m = t.split("\n").findIndex((l) => MARKER_RE.test(l));
    return m < 0 ? "" : t.split("\n").slice(0, m + 1).join("\n");
  };
  if (mb.join("\n") !== mn.join("\n") || headOf(c.base) !== headOf(c.next)) findings.push(f("VR-6", "blocking", tag(BOOK_EDIT_REASONS.VR6_MARKER)));
  if (c.key !== "front") {
    const lvl = ctx.headingLevel ?? 2;
    if (headingCount(c.base, lvl) === 1 && headingCount(c.next, lvl) !== 1) findings.push(f("VR-6", "blocking", tag(BOOK_EDIT_REASONS.VR6_MARKER)));
  }

  // Rows that explain edits: ops mode builds them from the applied ops, whole mode takes the change list.
  const opRows: ChangeRow[] = (c.applied ?? []).map((a) => ({ chapterKey: c.key, beforeExcerpt: a.removed || (a.op.op === "insert_after" ? a.op.anchor : ""), afterExcerpt: a.inserted, refs: a.op.refs }));
  const rawRows = c.mode === "ops" ? opRows : c.changes.filter((x) => x.chapterKey === c.key);
  const rows = validRows(rawRows, c.base, c.next);
  const runs = runsOf(c.base, c.next);

  // VR-7 explained (whole-text replacements only; ops are explained by construction). Each word-level
  // change run must be explained by a row on its own, so two edits on one line cannot hide behind one row.
  const unexplained: ChapterResult["unexplained"] = [];
  if (c.mode === "whole") {
    for (const run of runs) {
      if (runCovered(run.removed, run.added, rows)) continue;
      const hash = createHash("sha256").update(`${foldWhitespace(run.removed)}\u0001${foldWhitespace(run.added)}`).digest("hex").slice(0, 16);
      unexplained.push({ index: unexplained.length, beforeText: run.lineBefore.slice(0, 2000), afterText: run.lineAfter.slice(0, 2000), runHash: hash, context: `${c.key}` });
    }
    if (unexplained.length) findings.push(f("VR-7", "warning", tag(`${unexplained.length}টি ${BOOK_EDIT_REASONS.VR7_UNEXPLAINED}`)));
  }

  // VR-8 pictures
  const pb = mediaRefs(c.base);
  const pn = mediaRefs(c.next);
  if (!sameMultiset(pb, pn)) {
    const isPic = (refs: string[]) => refs.some((r) => itemsByCode.get(r)?.category === "picture");
    if (c.mode === "ops") {
      // Per op: an op that adds or drops a picture must itself cite a picture item.
      for (const a of c.applied ?? []) if (!sameMultiset(mediaRefs(a.removed), mediaRefs(a.inserted)) && !isPic(a.op.refs)) findings.push(f("VR-8", "blocking", tag(BOOK_EDIT_REASONS.VR8_PICTURE, a.index)));
    } else if (!isPic(refsUsed)) findings.push(f("VR-8", "blocking", tag(BOOK_EDIT_REASONS.VR8_PICTURE)));
    for (const p of pn) if (!pb.includes(p) && !ctx.mediaPaths.has(p)) findings.push(f("VR-8", "blocking", tag(`${BOOK_EDIT_REASONS.VR8_MISSING_MEDIA}: ${p}`)));
  }

  // VR-9 regions
  const bad = changedRegions(c.base, c.next, ["protect", "server"]);
  if (bad.length) findings.push(f("VR-9", "blocking", tag(`${BOOK_EDIT_REASONS.VR9_REGION}: ${bad.join(", ")}`)));

  // VR-10 characters (changed text only)
  const ch = checkCharacters(c.base, c.next);
  if (ch) findings.push(f("VR-10", "blocking", tag(ch)));

  // VR-11 size
  if (c.next.length > BOOK_LC_LIMITS.chapterChars) findings.push(f("VR-11", "blocking", tag(BOOK_EDIT_REASONS.VR11_MAX)));
  else if (c.base.length > 0 && c.next.length > 1.5 * c.base.length) {
    // Growth is expected only when a cited instruction (or an exercise item) asks for new material.
    const asks = refsUsed.some((r) => r.startsWith("I-") || itemsByCode.get(r)?.category === "exercise");
    findings.push(f("VR-11", asks ? "warning" : "blocking", tag(BOOK_EDIT_REASONS.VR11_GROWTH)));
  }

  // VR-12 sacred text — judged against the BASE text's sacred spans, in BOTH modes. A run that touches
  // sacred text needs ONE row that covers it AND whose refs give exactly the text it adds (verbatim,
  // from a ruled sacred_text item or a ruled decision); a deletion needs a ruled sacred_text item.
  const sources = sacredSources(ctx);
  let sacredTouched = false;
  let sacredBad = false;
  const sacredRows = new Set<number>();
  const verbatim = (refs: string[], added: string) => {
    const A = foldWhitespace(added.normalize("NFC"));
    return refs.some((r) => {
      const src = sources.get(r);
      if (!src) return false;
      return A === "" ? src.item : src.texts.some((t) => t.includes(A));
    });
  };
  for (const run of runs.filter((r) => r.sacred)) {
    sacredTouched = true;
    const covering = rows.map((r, i) => ({ r, i })).filter(({ r }) => runCovered(run.removed, run.added, [r]));
    const ok = covering.find(({ r }) => verbatim(r.refs, run.added));
    for (const { r } of covering) sacredRows.add(rawRows.indexOf(r) + 1);
    if (!ok) sacredBad = true;
  }
  if (sacredBad) findings.push(f("VR-12", "blocking", tag(BOOK_EDIT_REASONS.VR12_SACRED)));
  if (sacredTouched) findings.push(f("VR-12", "warning", tag("কুরআন/হাদিস/দোয়ার পরিবর্তন — মানুষের যাচাই দরকার; পরের স্মারকে পর্যালোচককে জানানো হবে")));

  // VR-13 rules lexicon (warnings) on the changed text
  const insertedText = c.mode === "ops" ? (c.applied ?? []).map((a) => a.inserted).join("\n") : runs.map((r) => r.added).join("\n");
  for (const l of lexicon(ctx.ruleSets)) {
    if (insertedText.includes(l.wrong)) findings.push(f("VR-13", "warning", tag(`${BOOK_EDIT_REASONS.VR13_LEXICON}: «${l.wrong}» → «${l.right}» (${l.key})`)));
  }

  return { findings, unexplained, sacredTouched, sacredRows: [...sacredRows] };
}

/** VR-14: every item and instruction given is cited somewhere or listed in notApplied. */
export function coverageFindings(ctx: ValidationContext, cited: Set<string>, notApplied: Set<string>): DraftFinding[] {
  const out: DraftFinding[] = [];
  for (const code of [...ctx.items.map((i) => i.code), ...ctx.instructions.map((i) => i.code)]) {
    if (!cited.has(code) && !notApplied.has(code)) out.push(f("VR-14", "warning", `${BOOK_EDIT_REASONS.VR14_SILENT}: ${code}`, undefined, code));
  }
  return out;
}

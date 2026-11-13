/**
 * The edit validator — VR-1 … VR-15 (docs/prd-book-lifecycle.md §12.3 — NORMATIVE, D-#1601/#1607).
 *
 * Draft level (a failure refuses the whole submission): VR-1 base, VR-14 coverage, VR-15 (the accept
 * flow — `acceptDraft`). Chapter level (a failure fails that chapter only): VR-2 schema (at parse),
 * VR-3 known refs, VR-4 ops apply (editOps), VR-5 scope, VR-6 markers, VR-7 explained (whole-text),
 * VR-8 pictures, VR-9 regions, VR-10 characters, VR-11 size, VR-12 sacred text, VR-13 rules lexicon.
 * Messages are Bangla, one line, with the chapter key and op number (codes in BOOK_EDIT_REASONS).
 */
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
  unexplained: { index: number; beforeText: string; afterText: string }[];
  sacredTouched: boolean;
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

/** Texts a sacred change may copy from, per qualifying ref (VR-12). */
function sacredSources(ctx: ValidationContext): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const i of ctx.items) {
    if (i.category !== "sacred_text" || i.route !== "needs_reviewer") continue;
    const v = i.reviewerRuling?.verdict;
    if (v !== "agree" && v !== "modify") continue;
    out.set(i.code, [i.textBn, i.reviewerRuling?.noteBn ?? ""].filter(Boolean).map((t) => t.normalize("NFC")));
  }
  for (const d of ctx.decisions) {
    if (d.status !== "ruled" || !d.ruling) continue;
    const opt = d.options.find((o) => o.key === d.ruling?.optionKey)?.textBn ?? "";
    out.set(d.code, [d.ruling.textBn ?? "", opt].filter(Boolean).map((t) => t.normalize("NFC")));
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

function markers(t: string): string[] {
  return t.split("\n").filter((l) => MARKER_RE.test(l));
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

/** A hunk is explained when a declared change's before/after excerpts appear in its removed/added
 *  text after whitespace folding (VR-7). */
export function hunkCovered(removed: string, added: string, rows: ChangeRow[]): boolean {
  const R = foldWhitespace(removed);
  const A = foldWhitespace(added);
  return rows.some((c) => {
    const b = foldWhitespace(c.beforeExcerpt);
    const a = foldWhitespace(c.afterExcerpt);
    if (!b && !a) return false;
    return (!b || R.includes(b)) && (!a || A.includes(a)) && (b ? true : !R || A.length > 0) && (a ? true : !A || R.length > 0);
  });
}

/** Consecutive non-equal word segments of a hunk, as (removed, added) pairs; whitespace-only runs drop out. */
export function changeRuns(words: { op: string; text: string }[]): { removed: string; added: string }[] {
  const out: { removed: string; added: string }[] = [];
  let cur: { removed: string; added: string } | null = null;
  for (const w of words) {
    if (w.op === "eq") {
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    cur ??= { removed: "", added: "" };
    if (w.op === "del") cur.removed += w.text;
    else cur.added += w.text;
  }
  if (cur) out.push(cur);
  return out.filter((r) => foldWhitespace(r.removed) || foldWhitespace(r.added));
}

/** A change run is explained when one row's before excerpt holds its removed words and the after excerpt its added words. */
export function runCovered(removed: string, added: string, rows: ChangeRow[]): boolean {
  const R = foldWhitespace(removed);
  const A = foldWhitespace(added);
  return rows.some((c) => {
    const b = foldWhitespace(c.beforeExcerpt);
    const a = foldWhitespace(c.afterExcerpt);
    if (!b && !a) return false;
    return (!R || b.includes(R)) && (!A || a.includes(A));
  });
}

function sacredSpans(t: string): { start: number; end: number }[] {
  const spans = extractRegions(t).filter((r) => r.type === "sacred").map((r) => ({ start: r.start, end: r.end }));
  const re = new RegExp(`${ARABIC_RE.source}+(?:[\\s\\u064B-\\u065F]*${ARABIC_RE.source}+)*`, "g");
  for (const m of t.matchAll(re)) spans.push({ start: m.index!, end: m.index! + m[0].length });
  return spans;
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
  if (!changed) return { findings, unexplained: [], sacredTouched: false };

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

  // VR-7 explained (whole-text replacements only; ops are explained by construction)
  const unexplained: ChapterResult["unexplained"] = [];
  const hunks = diffLines(c.base, c.next);
  if (c.mode === "whole") {
    const rows = c.changes.filter((x) => x.chapterKey === c.key);
    // Each word-level change run inside a line hunk must be explained by a row on its own, so two edits
    // on one line cannot hide behind one row (a run is covered when a row's excerpts contain both sides).
    for (const h of hunks) {
      const removed = h.removed.join("\n");
      const added = h.added.join("\n");
      for (const run of changeRuns(h.words)) {
        if (!runCovered(run.removed, run.added, rows)) unexplained.push({ index: unexplained.length, beforeText: removed.slice(0, 600), afterText: added.slice(0, 600) });
      }
    }
    if (unexplained.length) findings.push(f("VR-7", "warning", tag(`${unexplained.length}টি ${BOOK_EDIT_REASONS.VR7_UNEXPLAINED}`)));
  }

  // VR-8 pictures
  const pb = mediaRefs(c.base);
  const pn = mediaRefs(c.next);
  if (!sameMultiset(pb, pn)) {
    const pictureCited = refsUsed.some((r) => itemsByCode.get(r)?.category === "picture");
    if (!pictureCited) findings.push(f("VR-8", "blocking", tag(BOOK_EDIT_REASONS.VR8_PICTURE)));
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
    const asks = refsUsed.some((r) => r.startsWith("I-") || ["exercise", "instruction"].includes(itemsByCode.get(r)?.category ?? ""));
    findings.push(f("VR-11", asks ? "warning" : "blocking", tag(BOOK_EDIT_REASONS.VR11_GROWTH)));
  }

  // VR-12 sacred text
  const sources = sacredSources(ctx);
  let sacredTouched = false;
  const verbatim = (refs: string[], inserted: string) => {
    const ins = inserted.normalize("NFC").trim();
    return refs.some((r) => sources.has(r) && (ins === "" || sources.get(r)!.some((s) => s.includes(ins))));
  };
  if (c.mode === "ops") {
    for (const a of c.applied ?? []) {
      if (!a.sacred) continue;
      sacredTouched = true;
      if (!verbatim(a.op.refs, a.inserted)) findings.push(f("VR-12", "blocking", tag(BOOK_EDIT_REASONS.VR12_SACRED, a.index)));
    }
  } else {
    const spans = sacredSpans(c.base);
    const lineStart = (t: string, line: number) => t.split("\n").slice(0, line).join("\n").length + (line > 0 ? 1 : 0);
    const rows = c.changes.filter((x) => x.chapterKey === c.key);
    for (const h of hunks) {
      const removed = h.removed.join("\n");
      const added = h.added.join("\n");
      const s = lineStart(c.base, h.aStart);
      const e = s + removed.length;
      const touches = ARABIC_RE.test(removed) || ARABIC_RE.test(added) || spans.some((sp) => s < sp.end && sp.start < e);
      if (!touches) continue;
      sacredTouched = true;
      const covering = rows.filter((r) => hunkCovered(removed, added, [r]));
      if (!covering.some((r) => verbatim(r.refs, r.afterExcerpt) && (!ARABIC_RE.test(added) || verbatim(r.refs, added)))) {
        findings.push(f("VR-12", "blocking", tag(BOOK_EDIT_REASONS.VR12_SACRED)));
      }
    }
  }
  if (sacredTouched) findings.push(f("VR-12", "warning", tag("কুরআন/হাদিস/দোয়ার পরিবর্তন — মানুষের যাচাই দরকার; পরের স্মারকে পর্যালোচককে জানানো হবে")));

  // VR-13 rules lexicon (warnings) on the changed text
  const insertedText = c.mode === "ops" ? (c.applied ?? []).map((a) => a.inserted).join("\n") : hunks.map((h) => h.added.join("\n")).join("\n");
  for (const l of lexicon(ctx.ruleSets)) {
    if (insertedText.includes(l.wrong)) findings.push(f("VR-13", "warning", tag(`${BOOK_EDIT_REASONS.VR13_LEXICON}: «${l.wrong}» → «${l.right}» (${l.key})`)));
  }

  return { findings, unexplained, sacredTouched };
}

/** VR-14: every item and instruction given is cited somewhere or listed in notApplied. */
export function coverageFindings(ctx: ValidationContext, cited: Set<string>, notApplied: Set<string>): DraftFinding[] {
  const out: DraftFinding[] = [];
  for (const code of [...ctx.items.map((i) => i.code), ...ctx.instructions.map((i) => i.code)]) {
    if (!cited.has(code) && !notApplied.has(code)) out.push(f("VR-14", "warning", `${BOOK_EDIT_REASONS.VR14_SILENT}: ${code}`, undefined, code));
  }
  return out;
}

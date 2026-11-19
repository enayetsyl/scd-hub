/**
 * The "book beside a plan" cut (.claude/plans/plan-book-tab.md, "Cut rule"). PURE: no database, no files.
 *
 * A book master holds, per chapter, a REVIEW note (for the reviewer, never shown to a teacher here)
 * and a TEACHER note, each opened by its own bold label paragraph, mixed in with the children's
 * text. This module splits one chapter's text into
 *   - `childText`   the children's text (heading, opener picture, everything that is not a note),
 *   - `teacherNote` the teacher note + answers (or null),
 * and drops the review note and every `<!-- … -->` comment.
 *
 * Two layouts exist in the 20 books (decided once per book, from where the FIRST note pair sits):
 *   - "after":  the pair sits right after the chapter heading. Nothing marks where the teacher note
 *               ends, so the end is found with an ANCHOR: the first paragraph after the teacher label
 *               that also appears in the same chapter of the STUDENT edition.
 *   - "before": the pair for chapter N sits BEFORE N's heading, i.e. at the tail of chapter N-1 (or in
 *               `front` for N = 1). The teacher note ends at the next `<!-- bl:ch` marker, so no
 *               edition is needed.
 * When the layout is "after" and no anchor can be found (no edition, unreadable, no match), the
 * chapter is returned minus the review note, with `teacherNote: null` and `anchorMissing: true`
 * — the app then shows the chapter whole, unsplit. Nothing is guessed.
 */
import { FRONT_KEY } from "./markdown";

export interface CutChapterInput {
  key: string;
  title: string;
  text: string;
}

export interface CutChapter {
  childText: string;
  teacherNote: string | null;
  /** True when the teacher note could not be separated (after-layout without an anchor, or odd labels). */
  anchorMissing: boolean;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const COMMENT_RE = /<!--[\s\S]*?-->/g;
const DASH = "\\-\\u2010-\\u2015";
// The word must END at "নোট"/"note": "শিক্ষক-নোটের নমুনা …" is ordinary text, not a label.
const REVIEW_LABEL_RE = new RegExp(`^(?:পর্যালোচনা[\\s\\u200c\\u200d${DASH}]*নোট|reviewer[\\s\\u200c\\u200d${DASH}]*note)(?![\\p{L}\\p{M}])`, "iu");
const TEACHER_LABEL_RE = new RegExp(`^(?:শিক্ষক[\\s\\u200c\\u200d${DASH}]*নোট|teacher(?:'s|’s)?[\\s\\u200c\\u200d${DASH}]*note)(?![\\p{L}\\p{M}])`, "iu");
const MODEL_TEST_HEAD_RE = /^[#*_\s>]*(?:মডেল\s*টেস্ট|model\s*test)/i;
const BARE_REVIEW_RE = /^reviewer\s*note\s*[:.]?\s*(?:\*\*)?$/i;
const BARE_TEACHER_RE = /^teacher\s*note\s*[:.]?\s*(?:\*\*)?$/i;
/** Any review-note wording; used by the fail-closed guard on what is served. */
const REVIEW_WORDS_RE = new RegExp(`পর্যালোচনা[\\s\\u200c\\u200d${DASH}]*নোট|reviewer[\\s\\u200c\\u200d${DASH}]*note|শুধু\\s*পর্যালোচকের\\s*জন্য`, "iu");
const BLANK_LINE_RE = /^\s*(?:>\s*)*$/;
const PICTURE_ONLY_RE = /^(?:\s*>?\s*!\[[^\]]*\]\([^)]*\)\s*)+$/;

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
export function toAsciiDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/** Markup-free, whitespace-collapsed text for comparing the master with the student edition.
 *  Digits (Bangla/ASCII) are kept as written. */
export function normText(s: string): string {
  return s
    .normalize("NFC")
    .replace(COMMENT_RE, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^[ \t]*(?:>[ \t]*)+/gm, "")
    .replace(/^[ \t]*(?:[-*+•]|[0-9০-৯]+[.)])[ \t]+/gm, "")
    .replace(/[*_#>|`~\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Para {
  raw: string;
  /** "R" / "T" when this paragraph is a note LABEL; `bare` = just the words "Reviewer note". */
  label: "R" | "T" | null;
  bare: boolean;
  pictureOnly: boolean;
}

/**
 * A label paragraph is ONLY the bold (or heading) form: `**পর্যালোচনা-নোট — …**`,
 * `> **Reviewer Note (পর্যালোচনা-নোট) — …**`, `### Teacher note`, or the bare `**Reviewer note**`.
 * A plain sentence that merely starts with "শিক্ষক-নোট:" is ordinary text (it may sit inside a review note).
 */
function labelOf(raw: string): { label: "R" | "T" | null; bare: boolean } {
  const first = raw.replace(COMMENT_RE, "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const m = /^(?:>\s*)*(#{1,6}\s*)?(\*\*)?\s*([\s\S]*)$/.exec(first.normalize("NFC"));
  if (!m || (!m[1] && !m[2])) return { label: null, bare: false };
  const rest = m[3];
  if (BARE_REVIEW_RE.test(rest)) return { label: "R", bare: true };
  if (BARE_TEACHER_RE.test(rest)) return { label: "T", bare: true };
  if (REVIEW_LABEL_RE.test(rest)) return { label: "R", bare: false };
  if (TEACHER_LABEL_RE.test(rest)) return { label: "T", bare: false };
  return { label: null, bare: false };
}

function makePara(raw: string): Para {
  const { label, bare } = labelOf(raw);
  const stripped = raw.replace(COMMENT_RE, "").trim();
  return { raw, label, bare, pictureOnly: stripped !== "" && PICTURE_ONLY_RE.test(stripped) };
}

/** Blank-line paragraphs ("> " only lines count as blank, so blockquote notes split too). */
export function splitParas(text: string): Para[] {
  const out: Para[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) out.push(makePara(cur.join("\n")));
    cur = [];
  };
  for (const line of text.split("\n")) {
    if (BLANK_LINE_RE.test(line)) flush();
    else cur.push(line);
  }
  flush();
  return out;
}

const isStub = (s: string) => s.includes("|") && /^[\s|:\-]+$/.test(s);
const clean = (raw: string) => raw.replace(COMMENT_RE, "").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();

/** Paragraphs → Markdown: comments dropped, empty paragraphs dropped, a trailing empty table stub dropped. */
function render(paras: Para[]): string {
  const list = paras.map((p) => clean(p.raw)).filter(Boolean);
  while (list.length && isStub(list[list.length - 1])) list.pop();
  return list.join("\n\n");
}

/** The teacher note for the fold: the note's OWN opening label (and a bare "Teacher note" paragraph) is
 *  dropped — the app titles the fold itself. Inner teacher labels stay as sub-headings. */
function renderTeacher(paras: Para[]): string {
  const out: Para[] = [];
  let opening = true;
  for (const p of paras) {
    if (p.bare) continue;
    if (opening && p.label === "T") {
      opening = false;
      const lines = clean(p.raw).split("\n");
      const rest = lines[0].replace(/^((?:>\s*)*(?:#{1,6}\s*)?)\*\*[\s\S]*?\*\*\s*/, "$1").replace(/^(?:>\s*)*(?:#{1,6}\s*)?$/, "");
      const kept = [rest, ...lines.slice(1)].filter((l) => l.trim() !== "").join("\n");
      if (kept) out.push({ ...p, raw: kept });
      continue;
    }
    if (p.label !== "T") opening = false;
    out.push(p);
  }
  return render(out);
}

// ---------------------------------------------------------------------------
// Note events inside one chapter
// ---------------------------------------------------------------------------

interface NoteEvent {
  type: "R" | "T";
  start: number;
  last: number;
}

function noteEvents(paras: Para[]): NoteEvent[] {
  const ev: NoteEvent[] = [];
  paras.forEach((p, i) => {
    if (!p.label) return;
    const prev = ev[ev.length - 1];
    if (prev && prev.type === p.label && prev.last === i - 1) prev.last = i;
    else ev.push({ type: p.label, start: i, last: i });
  });
  return ev;
}

/** One review note and the teacher note(s) that follow it. */
interface Group {
  r: NoteEvent;
  ts: NoteEvent[];
}

function groupsOf(ev: NoteEvent[]): Group[] {
  const gs: Group[] = [];
  for (const e of ev) {
    if (e.type === "R") gs.push({ r: e, ts: [] });
    else if (gs.length) gs[gs.length - 1].ts.push(e);
  }
  return gs;
}

const MODEL_TEST_MAX = 120;
const isModelTestHead = (p: Para) => !p.label && p.raw.length < MODEL_TEST_MAX && MODEL_TEST_HEAD_RE.test(clean(p.raw));

/** The chapter minus every review note (each review label up to the next label, else to the end). */
function minusReview(paras: Para[], ev: NoteEvent[]): Para[] {
  const drop = new Set<number>();
  ev.forEach((e, k) => {
    if (e.type !== "R") return;
    const next = ev[k + 1];
    const to = next ? next.start : paras.length;
    for (let i = e.start; i < to; i++) drop.add(i);
  });
  return paras.filter((_, i) => !drop.has(i));
}

/**
 * FAIL-CLOSED guard on everything served: if review-note wording is still present, remove from that
 * paragraph to the next teacher label or heading (else to the end) and report it. Never serve it.
 */
function scrubReview(text: string | null, warnings: string[], what: string): string | null {
  if (!text) return text;
  let cur = text;
  for (let guard = 0; guard < 50 && REVIEW_WORDS_RE.test(cur.normalize("NFC")); guard++) {
    const paras = splitParas(cur);
    const at = paras.findIndex((p) => REVIEW_WORDS_RE.test(p.raw.normalize("NFC")));
    if (at < 0) break;
    let to = paras.length;
    for (let i = at + 1; i < paras.length; i++) {
      if (paras[i].label === "T" || /^\s*(?:>\s*)*#{1,6}\s/.test(paras[i].raw)) {
        to = i;
        break;
      }
    }
    warnings.push(`review-note wording found in ${what}; removed ${to - at} paragraph(s)`);
    cur = render([...paras.slice(0, at), ...paras.slice(to)]);
  }
  return REVIEW_WORDS_RE.test(cur.normalize("NFC")) ? "" : cur;
}

/** A comparison key: markup-free, punctuation and dashes dropped, digits ASCII, lower-case. */
export function matchKey(s: string): string {
  return toAsciiDigits(normText(s))
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const ANCHOR_NUMBER_RE = new RegExp("(অধ্যায়|পাঠ|ইউনিট|একক|unit|lesson|chapter|part)\\s*([0-9]+)".normalize("NFC"), "i");

/** Split the student edition's plain text (headings may be `#` lines, plain lines, table rows or a
 *  page banner such as "| School · Class One · English Unit 4 Naming Words |") into chapters by the
 *  version's chapter titles. A line starts a chapter when its key equals the title key, or it is a
 *  short line that contains it; when no line does, the anchor word + number ("Unit 4", "অধ্যায় ৪")
 *  at the start of a line is used. A contents list comes first, so the LAST such line is taken.
 *  A title that is not found simply has no entry. */
export function splitStudentChapters(studentText: string, chapters: { key: string; title: string }[]): Map<string, string> {
  const lines = studentText.split("\n");
  const keys = lines.map((l) => matchKey(l));
  const picks: { key: string; at: number }[] = [];
  for (const c of chapters) {
    const t = matchKey(c.title);
    if (!t) continue;
    let at = -1;
    for (let i = 0; i < lines.length; i++) {
      const n = keys[i];
      if (!n) continue;
      if (n === t || (t.length >= 6 && n.length <= t.length + 90 && n.includes(t))) at = i;
    }
    if (at < 0) {
      const m = ANCHOR_NUMBER_RE.exec(toAsciiDigits(c.title.normalize("NFC")));
      if (m) {
        const prefix = `${m[1].toLowerCase()} ${m[2]}`;
        for (let i = 0; i < lines.length; i++) {
          const n = keys[i];
          if (n && n.length <= 160 && (n === prefix || n.startsWith(prefix + " "))) at = i;
        }
      }
    }
    if (at >= 0) picks.push({ key: c.key, at });
  }
  const starts = [...new Set(picks.map((p) => p.at))].sort((a, b) => a - b);
  const out = new Map<string, string>();
  for (const p of picks) {
    const next = starts.find((s) => s > p.at) ?? lines.length;
    out.set(p.key, normText(lines.slice(p.at, next).join("\n")));
  }
  return out;
}


// ---------------------------------------------------------------------------
// The cut
// ---------------------------------------------------------------------------

/** Children's paragraphs between a chapter's heading and its first review label that mark the pair as the
 *  NEXT chapter's (tail) rather than this chapter's own. Measured on the 20 real books: after-heading
 *  chapters have 0–2 lead-in paragraphs, before-heading chapters 8 or more (so 3 separates them). */
const TAIL_MIN_CHILDREN_PARAS = 3;

export interface CutOptions {
  /** Markdown heading level of a chapter heading (book.chapterHeadingLevel, default 2). */
  headingLevel?: number;
}

/**
 * Cut every chapter of a master. `chapters` is the version's chapter list in reading order INCLUDING
 * `front`; `studentByKey` is `splitStudentChapters(...)` (null when the edition is unavailable).
 * Returns one entry per chapter except `front`.
 *
 * Layout is decided PER PAIR (plan rule 2). A note pair belongs to the NEXT chapter when it sits at the
 * tail of the text it is in — `front` always, otherwise when children's text lies between the chapter's
 * own heading and the review label — and to the chapter it is in when it follows the heading directly.
 */
export function cutChapters(chapters: CutChapterInput[], studentByKey: Map<string, string> | null, opts: CutOptions = {}): Map<string, CutChapter> {
  const level = opts.headingLevel ?? 2;
  const headRe = new RegExp(`^\\s*(?:>\\s*)*#{${level}}\\s`, "m");
  const parsed = chapters.map((c) => {
    const paras = splitParas(c.text);
    const ev = noteEvents(paras);
    return { c, paras, ev, groups: groupsOf(ev) };
  });

  type Mode = "tail" | "own" | "none";
  const pairFor = new Map<string, Para[]>(); // chapter key → teacher paragraphs handed on by the previous text
  const ownOf = new Map<string, Para[]>(); // tail mode: the chapter's children's text (pair + strays removed)
  const mode = new Map<string, Mode>();
  const warn = new Map<string, string[]>();
  const addWarn = (key: string, w: string) => (warn.get(key) ?? warn.set(key, []).get(key)!).push(w);

  parsed.forEach((p, i) => {
    const key = p.c.key;
    if (!p.groups.length) {
      mode.set(key, "none");
      return;
    }
    let tail = key === FRONT_KEY;
    if (!tail && p.ev[0].type === "R") {
      const h = p.paras.findIndex((x) => headRe.test(x.raw));
      const between = p.paras.slice(h + 1, p.groups[0].r.start).filter((x) => !x.pictureOnly && !x.label && clean(x.raw) !== "");
      tail = between.length >= TAIL_MIN_CHILDREN_PARAS;
    }
    mode.set(key, tail ? "tail" : "own");
    if (!tail) return;
    const g = p.groups[p.groups.length - 1];
    const stray = p.groups.slice(0, -1);
    if (stray.length) addWarn(key, `earlier note labels (${stray.length} pair(s)) before the tail pair; removed`);
    if (!g.ts.length) addWarn(key, "tail review note has no teacher note after it; removed");
    const dropFrom = stray.length ? stray[0].r.start : g.r.start;
    // children's text = everything before the first stray/tail review label, plus nothing after it
    ownOf.set(key, p.paras.slice(0, dropFrom));
    const target = parsed[i + 1];
    if (!g.ts.length) return;
    if (target) pairFor.set(target.c.key, p.paras.slice(g.ts[0].start));
    else addWarn(key, "note pair at the tail of the last chapter has no chapter to belong to");
  });
  const anyTail = [...mode.values()].includes("tail");

  const out = new Map<string, CutChapter>();
  for (const p of parsed) {
    if (p.c.key === FRONT_KEY) continue;
    const key = p.c.key;
    const warnings = warn.get(key) ?? [];
    const finish = (child: Para[], teacher: Para[] | null, anchorMissing: boolean): CutChapter => {
      const childText = scrubReview(render(child), warnings, "the children's text") ?? "";
      const t = teacher && teacher.length ? scrubReview(renderTeacher(teacher), warnings, "the teacher note") : null;
      return { childText, teacherNote: t || null, anchorMissing, warnings };
    };
    const unsplit = (paras: Para[], ev: NoteEvent[], why: string): CutChapter => {
      warnings.push(`${why}; chapter shown with review notes removed`);
      return finish(minusReview(paras, ev), null, true);
    };
    /** model-test back matter inside the children's text (after the chapter's own heading). */
    const trimBack = (paras: Para[]): Para[] => {
      const h = paras.findIndex((x) => headRe.test(x.raw));
      for (let i = Math.max(h + 1, 1); i < paras.length; i++) {
        if (isModelTestHead(paras[i])) {
          warnings.push(`back matter (model test) cut at paragraph ${i} of ${paras.length}`);
          return paras.slice(0, i);
        }
      }
      return paras;
    };

    const m = mode.get(key)!;
    if (m === "tail" || m === "none") {
      const handed = pairFor.get(key) ?? null;
      const base = m === "tail" ? ownOf.get(key)! : p.paras;
      if (!handed && m === "none") {
        warnings.push("no note pair found for this chapter");
        out.set(key, finish(trimBack(base), null, !anyTail));
        continue;
      }
      if (!handed) warnings.push("no note pair found for this chapter");
      out.set(key, finish(trimBack(base), handed, false));
      continue;
    }

    // own mode: the pair follows the chapter's own heading
    if (p.ev[0].type !== "R" || !p.groups[0].ts.length) {
      out.set(key, unsplit(p.paras, p.ev, `unexpected note labels (${p.ev.map((e) => e.type).join("")})`));
      continue;
    }
    // Back matter (model tests, the glossary — each with its own notes) is not part of the chapter view.
    const g0 = p.groups[0];
    let back = p.groups[1] ? p.groups[1].r.start : p.paras.length;
    for (let i = g0.ts[0].last + 1; i < back; i++) {
      if (isModelTestHead(p.paras[i])) {
        back = i;
        break;
      }
    }
    if (back < p.paras.length) warnings.push(`back matter cut at paragraph ${back} of ${p.paras.length}`);
    const paras = p.paras.slice(0, back);
    const ev = back < p.paras.length ? noteEvents(paras) : p.ev;
    const r = g0.r;
    const t = g0.ts[0];
    const student = studentByKey?.get(key);
    const anchored = (i: number) => {
      const n = normText(paras[i].raw);
      return n.length >= 12 && !!student && student.includes(n);
    };
    let end = -1;
    if (student) for (let i = t.last + 1; i < paras.length; i++) if (anchored(i)) { end = i; break; }
    if (end < 0) {
      out.set(key, unsplit(paras, ev, student ? "no paragraph after the teacher note matches the student edition" : "student edition text unavailable"));
      continue;
    }
    while (end - 1 > t.last && paras[end - 1].pictureOnly) end--;
    // Separate inner teacher notes after the first fold belong to the fold, never to the children's text.
    const child = [...paras.slice(0, r.start)];
    const teacher = paras.slice(t.start, end);
    for (let i = end; i < paras.length; i++) {
      if (paras[i].label !== "T") {
        child.push(paras[i]);
        continue;
      }
      let j = i;
      while (j + 1 < paras.length && paras[j + 1].label === "T") j++;
      let stop = paras.length;
      for (let k = j + 1; k < paras.length; k++) if (anchored(k)) { stop = k; break; }
      teacher.push(...paras.slice(i, stop));
      i = stop - 1;
    }
    out.set(key, finish(child, teacher, false));
  }
  return out;
}

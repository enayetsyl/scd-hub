/**
 * Book Markdown conventions (docs/prd-book-lifecycle.md §6 — NORMATIVE, D-#1591).
 *
 *  - §6.1 normalisation: UTF-8 only (invalid bytes refused), BOM removed, CRLF → LF, NFC.
 *  - §6.2 chapters: a chapter starts at a heading of the book's level (default `##`); text before
 *    the first is `front`. A higher-level (part) heading that is IMMEDIATELY followed by the chapter
 *    heading (blank lines and its own marker aside) belongs to that chapter (D-#1617).
 *    Each chapter is preceded by a permanent marker `<!-- bl:ch ch-001 -->`. Chapter texts are exact
 *    character slices: `front + ch-001 + ch-002 …` reproduces the master byte for byte.
 *  - §6.2 re-keying: an upload without markers is matched to the parent by heading text and order.
 *  - §6.3 regions: `bl:protect`, `bl:server` (version-line, version-log) and `bl:sacred`; restored
 *    from the parent by text match when a docx round-trip dropped them.
 *  - Headings inside fenced code blocks are not headings.
 */
import { createHash } from "crypto";
import { BOOK_LC_LIMITS, foldWhitespace } from "@scd/shared";

export const FRONT_KEY = "front";
export const MARKER_RE = /^<!-- bl:ch (ch-\d{3,}) -->$/;
const HEADING_RE = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const FENCE_RE = /^\s{0,3}(```|~~~)/;

export function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

export class BookMarkdownError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "BookMarkdownError";
  }
}

/** §6.1. A Buffer is decoded strictly (invalid UTF-8 → refused in Bangla). */
export function normaliseMarkdown(input: Buffer | string): string {
  let text: string;
  if (typeof input === "string") text = input;
  else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch {
      throw new BookMarkdownError("ফাইলটি UTF-8 নয় — UTF-8 হিসেবে সংরক্ষণ করে আবার তুলুন");
    }
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n/g, "\n").normalize("NFC");
}

export function chapterKeyOf(n: number): string {
  return `ch-${String(n).padStart(3, "0")}`;
}
export function chapterNoOf(key: string): number {
  const m = /^ch-(\d+)$/.exec(key);
  return m ? Number(m[1]) : 0;
}

interface Line {
  text: string;
  offset: number;
  inFence: boolean;
}

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let offset = 0;
  let fence: string | null = null;
  for (const raw of text.split("\n")) {
    const m = FENCE_RE.exec(raw);
    let inFence = fence !== null;
    if (m) {
      if (fence === null) {
        fence = m[1];
        inFence = true;
      } else if (m[1] === fence) {
        fence = null;
        inFence = true;
      }
    }
    out.push({ text: raw, offset, inFence });
    offset += raw.length + 1;
  }
  return out;
}

function headingOf(l: Line): { level: number; title: string } | null {
  if (l.inFence) return null;
  const m = HEADING_RE.exec(l.text);
  return m ? { level: m[1].length, title: m[2].trim() } : null;
}

export interface ParsedChapter {
  /** From the marker; null when the chapter has none. */
  key: string | null;
  title: string;
  text: string;
  /** Character offset of the chapter start in the master. */
  offset: number;
}

export interface ParsedMaster {
  front: string;
  chapters: ParsedChapter[];
  /** Marker lines not attached to a chapter heading (VR-6 / refusal). */
  strayMarkers: string[];
  duplicateKeys: string[];
}

/** Split a normalised master into `front` + chapters (§6.2). Exact slices. */
export function parseMaster(text: string, level = 2): ParsedMaster {
  const lines = linesOf(text);
  const starts: { line: number; headingLine: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = headingOf(lines[i]);
    if (!h || h.level !== level) continue;
    let start = i;
    for (let j = i - 1; j >= 0; j--) {
      const l = lines[j];
      if (l.text.trim() === "") continue;
      const hh = headingOf(l);
      if (!l.inFence && MARKER_RE.test(l.text)) {
        start = j;
        continue;
      }
      if (hh && hh.level < level) {
        start = j;
        continue;
      }
      break;
    }
    // Never reach back into the previous chapter's heading region.
    const prev = starts[starts.length - 1];
    if (prev && start <= prev.headingLine) start = i;
    starts.push({ line: start, headingLine: i });
  }
  const endOffset = text.length;
  const offsetOfLine = (n: number) => (n < lines.length ? lines[n].offset : endOffset);
  const front = text.slice(0, starts.length ? offsetOfLine(starts[0].line) : endOffset);
  const chapters: ParsedChapter[] = [];
  const seen = new Set<string>();
  const duplicateKeys: string[] = [];
  const attached = new Set<number>();
  starts.forEach((s, idx) => {
    const from = offsetOfLine(s.line);
    const to = idx + 1 < starts.length ? offsetOfLine(starts[idx + 1].line) : endOffset;
    let key: string | null = null;
    for (let j = s.line; j < s.headingLine; j++) {
      const m = MARKER_RE.exec(lines[j].text);
      if (m && !lines[j].inFence) {
        attached.add(j);
        if (key === null) key = m[1];
      }
    }
    if (key) {
      if (seen.has(key)) duplicateKeys.push(key);
      seen.add(key);
    }
    chapters.push({ key, title: headingOf(lines[s.headingLine])!.title, text: text.slice(from, to), offset: from });
  });
  const strayMarkers: string[] = [];
  lines.forEach((l, j) => {
    if (!l.inFence && MARKER_RE.test(l.text) && !attached.has(j)) strayMarkers.push(MARKER_RE.exec(l.text)![1]);
  });
  return { front, chapters, strayMarkers, duplicateKeys };
}

export interface KeyedChapter {
  key: string;
  title: string;
  text: string;
  order: number;
}

export interface SplitResult {
  front: string;
  chapters: KeyedChapter[];
  /** Titles of chapters that got a NEW key (not matched to the parent). */
  newChapters: string[];
  /** Keys of parent chapters not found in this text. */
  missingChapters: string[];
  maxChapterNo: number;
  /** True when keys were assigned by heading match (the upload had no markers). */
  rekeyed: boolean;
  /** The master rebuilt with markers in place. */
  master: string;
}

function withMarker(key: string, chapterText: string): string {
  const firstLine = chapterText.split("\n", 1)[0];
  if (MARKER_RE.test(firstLine)) return chapterText;
  return `<!-- bl:ch ${key} -->\n${chapterText}`;
}

/**
 * Key every chapter (§6.2): keep markers; on an upload with none, match the parent's chapters by
 * heading text (whitespace-folded, NFC) in order; anything unmatched gets the next free number and
 * is listed for the person to confirm. Stray/duplicate markers are refused.
 */
export function splitAndKey(
  text: string,
  level: number,
  opts: { parent?: { key: string; title: string }[]; maxChapterNo: number },
): SplitResult {
  const parsed = parseMaster(text, level);
  if (parsed.strayMarkers.length) throw new BookMarkdownError(`অধ্যায়-চিহ্ন কোনো অধ্যায়ের শিরোনামের আগে নেই: ${parsed.strayMarkers.join(", ")}`);
  if (parsed.duplicateKeys.length) throw new BookMarkdownError(`একই অধ্যায়-চিহ্ন দুবার: ${parsed.duplicateKeys.join(", ")}`);
  let max = opts.maxChapterNo;
  for (const c of parsed.chapters) if (c.key) max = Math.max(max, chapterNoOf(c.key));
  const anyMarker = parsed.chapters.some((c) => c.key);
  const rekeyed = !anyMarker && !!opts.parent && opts.parent.length > 0;
  const used = new Set<string>(parsed.chapters.filter((c) => c.key).map((c) => c.key!));
  const newChapters: string[] = [];
  const parentLeft = (opts.parent ?? []).filter((p) => !used.has(p.key));
  const keyed: KeyedChapter[] = parsed.chapters.map((c, i) => {
    let key = c.key;
    if (!key && rekeyed) {
      const t = foldWhitespace(c.title);
      const hit = parentLeft.find((p) => !used.has(p.key) && foldWhitespace(p.title) === t);
      if (hit) key = hit.key;
    }
    if (!key) {
      key = chapterKeyOf(++max);
      if (opts.parent) newChapters.push(c.title);
    }
    used.add(key);
    // A chapter that already carried its marker is kept byte for byte (the marker may sit after a
    // part heading); only an unmarked chapter gets one inserted at its start.
    return { key, title: c.title, text: c.key ? c.text : withMarker(key, c.text), order: i + 1 };
  });
  const missingChapters = (opts.parent ?? []).filter((p) => !used.has(p.key)).map((p) => p.key);
  const master = parsed.front + keyed.map((c) => c.text).join("");
  return { front: parsed.front, chapters: keyed, newChapters, missingChapters, maxChapterNo: max, rekeyed, master };
}

export function assembleMaster(front: string, chapters: { text: string }[]): string {
  return front + chapters.map((c) => c.text).join("");
}

/** §6.2: a chapter over 60,000 characters is cut for the API at its next-lower headings. */
export function chapterParts(key: string, text: string, level = 2, limit: number = BOOK_LC_LIMITS.apiPartChars): { key: string; text: string }[] {
  if (text.length <= limit) return [{ key, text }];
  const lines = linesOf(text);
  const cuts = [0];
  for (const l of lines) {
    const h = headingOf(l);
    if (h && h.level === level + 1 && l.offset > 0) cuts.push(l.offset);
  }
  // Greedy: keep adding sections while under the limit.
  const parts: string[] = [];
  let from = 0;
  for (let i = 1; i <= cuts.length; i++) {
    const at = i < cuts.length ? cuts[i] : text.length;
    if (at - from > limit && i - 1 >= 0 && cuts[i - 1] > from) {
      parts.push(text.slice(from, cuts[i - 1]));
      from = cuts[i - 1];
    }
  }
  parts.push(text.slice(from));
  return parts.map((t, i) => ({ key: `${key}.p${i + 1}`, text: t }));
}

// ---------------------------------------------------------------------------
// §6.3 regions
// ---------------------------------------------------------------------------

export type RegionType = "protect" | "server" | "sacred";
export interface Region {
  type: RegionType;
  name?: string;
  startLine: string;
  endLine: string;
  /** Full text from the start marker to the end marker inclusive. */
  full: string;
  inner: string;
  start: number;
  end: number;
}

const REGION_RE = /<!-- bl:(protect|server|sacred) start([^>]*?)-->([\s\S]*?)<!-- bl:\1 end -->/g;

export function extractRegions(text: string): Region[] {
  const out: Region[] = [];
  for (const m of text.matchAll(REGION_RE)) {
    const attrs = m[2];
    const name = /name="([^"]*)"/.exec(attrs)?.[1];
    const startLine = `<!-- bl:${m[1]} start${attrs}-->`;
    out.push({
      type: m[1] as RegionType,
      name,
      startLine,
      endLine: `<!-- bl:${m[1]} end -->`,
      full: m[0],
      inner: m[3],
      start: m.index!,
      end: m.index! + m[0].length,
    });
  }
  return out;
}

/** Protect + server regions must be byte-identical (VR-9). Returns the offending region labels. */
export function changedRegions(before: string, after: string, types: RegionType[] = ["protect", "server"]): string[] {
  const a = extractRegions(before).filter((r) => types.includes(r.type));
  const b = extractRegions(after).filter((r) => types.includes(r.type));
  const bad: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (!a[i] || !b[i] || a[i].full !== b[i].full) bad.push((a[i] ?? b[i]).name ?? `${(a[i] ?? b[i]).type}#${i + 1}`);
  }
  return bad;
}

/** True when any protect region's content differs (an upload needs finalize + confirmation). */
export function protectedTextChanged(before: string, after: string): boolean {
  return changedRegions(before, after, ["protect"]).length > 0;
}

/**
 * A docx round-trip may drop the HTML-comment markers (§6.3). Every parent region missing from
 * `text` is restored when its inner text occurs exactly once; anything else is returned as
 * unmatched (the caller refuses the upload, naming it).
 */
export function restoreRegions(parentMaster: string, text: string): { text: string; restored: string[]; unmatched: string[] } {
  const parentRegions = extractRegions(parentMaster);
  const have = extractRegions(text);
  const restored: string[] = [];
  const unmatched: string[] = [];
  let out = text;
  const counts = new Map<string, number>();
  for (const r of have) counts.set(`${r.type}:${r.name ?? ""}`, (counts.get(`${r.type}:${r.name ?? ""}`) ?? 0) + 1);
  const needed = new Map<string, number>();
  for (const r of parentRegions) {
    const k = `${r.type}:${r.name ?? ""}`;
    needed.set(k, (needed.get(k) ?? 0) + 1);
    if ((needed.get(k) ?? 0) <= (counts.get(k) ?? 0)) continue; // still present
    const label = r.name ?? `${r.type}`;
    const inner = r.inner;
    const core = inner.trim();
    if (!core) {
      unmatched.push(label);
      continue;
    }
    const first = out.indexOf(core);
    if (first < 0 || out.indexOf(core, first + 1) >= 0) {
      unmatched.push(label);
      continue;
    }
    out = out.slice(0, first) + r.startLine + inner.slice(0, inner.indexOf(core)) + core + inner.slice(inner.indexOf(core) + core.length) + r.endLine + out.slice(first + core.length);
    restored.push(label);
  }
  return { text: out, restored, unmatched };
}

/** The server rewrites `version-line` / `version-log` (§6.3). Absent regions are left absent. */
export function rewriteServerRegions(text: string, content: { versionLine: string; versionLog: string }): string {
  return text.replace(REGION_RE, (full, type: string, attrs: string, _inner: string) => {
    if (type !== "server") return full;
    const name = /name="([^"]*)"/.exec(attrs)?.[1];
    const body = name === "version-line" ? content.versionLine : name === "version-log" ? content.versionLog : null;
    if (body === null) return full;
    return `<!-- bl:server start${attrs}-->\n${body}\n<!-- bl:server end -->`;
  });
}

// ---------------------------------------------------------------------------
// §6.4 pictures, Arabic runs (VR-12)
// ---------------------------------------------------------------------------

const MEDIA_RE = /!\[[^\]]*\]\((media\/[^)\s]+)\)/g;
export function mediaRefs(text: string): string[] {
  return [...text.matchAll(MEDIA_RE)].map((m) => m[1]);
}

/** Arabic-script code points (Arabic, Supplement, Extended-A, Presentation Forms A/B). */
export const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
export function hasArabic(text: string): boolean {
  return ARABIC_RE.test(text);
}

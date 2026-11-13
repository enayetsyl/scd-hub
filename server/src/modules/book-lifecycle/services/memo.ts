/**
 * The generated memo (docs/prd-book-lifecycle.md §10.2, D-#1595) — built ONLY from records, in the
 * offline memo's shape (P20). `bookMemoMarkdown(data)` is pure and deterministic (byte-for-byte
 * fixture test); `buildMemoData(round)` loads the records. The memo PDF (packet.ts) draws the same
 * `MemoData`, so the printed copy and the Markdown never disagree.
 */
import { Types } from "mongoose";
import { formatBookVersionBn, toBnDigits, type BookChangeRoute, type BookVersionNo } from "@scd/shared";
import { BookVersion, type IBookVersion } from "../models/BookVersion";
import { BookFeedback, BookDecision } from "../models/BookFeedback";
import type { IBookMemoRound } from "../models/BookMemoRound";
import { chapterTextsBySha, loadBook, loadVersion, vno } from "./store";
import { FRONT_KEY } from "./markdown";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { namesOf } from "./names";

export interface MemoRow {
  page: string;
  where: string;
  what: string;
  reason: string;
  refs: string;
  typeBn: string;
}
export interface MemoItem {
  code: string;
  where: string;
  quote: string;
  textBn: string;
  edited: boolean;
  sourceBn: string;
}
export interface MemoDecision {
  code: string;
  questionBn: string;
  options: { key: string; textBn: string }[];
  recommendedKey?: string;
}
export interface MemoData {
  bookCode: string;
  bookTitleBn: string;
  memoNo: number;
  reviewerName: string;
  assignerName: string;
  dateKey: string;
  version: BookVersionNo;
  base: BookVersionNo | null;
  attachments: string[];
  changedChapters: { key: string; title: string; pages: string }[];
  rows: MemoRow[];
  items: MemoItem[];
  decisions: MemoDecision[];
  extraNotesBn: string;
}

export const ROUTE_TYPE_BN: Record<BookChangeRoute, string> = {
  needs_reviewer: "আপনার মতামত চাই",
  instruction: "আপনার মতামত চাই",
  direct_fix: "সরাসরি সংশোধন — জানানোর জন্য",
  verbal_errata: "ভুল-সংশোধনী (ছাপা বইয়ে জানানো হয়েছে)",
};
const SOURCE_BN: Record<string, string> = {
  reviewer: "আপনার আগের মত",
  teacher: "শিক্ষকের মতামত",
  school: "বিদ্যালয়ের মতামত",
  print_error: "ছাপার ভুল",
  proof_read: "প্রুফ দেখা",
};

const cell = (s: string): string => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim() || "—";
const quote = (s: string, n = 80): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Pure: MemoData → Markdown (Bangla; §10.2 shape). */
export function bookMemoMarkdown(d: MemoData): string {
  const L: string[] = [];
  const v = formatBookVersionBn(d.version);
  L.push(`# স্মারক ${toBnDigits(d.memoNo)} — ${d.bookTitleBn}`);
  L.push("");
  L.push(`| প্রাপক | ${cell(d.reviewerName)}, পর্যালোচক |`);
  L.push("|---|---|");
  L.push(`| প্রেরক | ${cell(d.assignerName)} |`);
  L.push(`| বিষয় | বই ${d.bookCode} ${v} — পর্যালোচনা |`);
  L.push(`| তারিখ | ${toBnDigits(d.dateKey)} |`);
  L.push(`| সংযুক্ত | ${cell(d.attachments.join("; "))} |`);
  L.push("");
  if (d.base) {
    const list = d.changedChapters.length ? d.changedChapters.map((c) => `${c.title}${c.pages ? ` (পৃ. ${c.pages})` : ""}`).join("; ") : "—";
    L.push(`> পুরো বই আবার পড়ার দরকার নেই। ${formatBookVersionBn(d.base)}-এর পর কেবল নিচের অধ্যায়/অংশ বদলেছে: ${list}`);
  } else {
    L.push("> প্রথম পর্যালোচনা — পুরো বই।");
  }
  L.push("");
  L.push(`## অংশ ১ — যা বদলেছে`);
  L.push("");
  if (!d.base) L.push("প্রথম পর্যালোচনা — পুরো বই");
  else if (!d.rows.length) L.push("কোনো পরিবর্তন নেই।");
  else {
    L.push("| পৃষ্ঠা | কোথায় | কী বদলেছে | কারণ | সূত্র | ধরন |");
    L.push("|---|---|---|---|---|---|");
    for (const r of d.rows) L.push(`| ${cell(r.page)} | ${cell(r.where)} | ${cell(r.what)} | ${cell(r.reason)} | ${cell(r.refs)} | ${cell(r.typeBn)} |`);
  }
  L.push("");
  L.push(`## অংশ ২ — আপনার মতামত চাই`);
  L.push("");
  if (!d.items.length) L.push("এবার আলাদা কোনো প্রশ্ন নেই।");
  for (const it of d.items) {
    L.push(`### ${it.code} — ${it.sourceBn}${it.edited ? " (সম্পাদিত)" : ""}`);
    L.push("");
    L.push(`- কোথায়: ${it.where || "—"}`);
    if (it.quote) L.push(`- বইয়ে আছে: «${it.quote}»`);
    L.push(`- প্রস্তাব: ${it.textBn}`);
    L.push(`- আপনার মত: ☐ একমত ☐ একমত নই ☐ বদলে: ____________`);
    L.push("");
  }
  L.push(`## অংশ ৩ — সিদ্ধান্ত`);
  L.push("");
  if (!d.decisions.length) L.push("এবার কোনো সিদ্ধান্ত চাওয়া হয়নি।");
  for (const dec of d.decisions) {
    L.push(`### ${dec.code} — ${dec.questionBn}`);
    L.push("");
    for (const o of dec.options) L.push(`- ☐ ${o.key}) ${o.textBn}`);
    if (dec.recommendedKey) L.push(`- আমাদের প্রস্তাব: ${dec.recommendedKey}`);
    L.push("");
  }
  L.push(`## অংশ ৪ — অতিরিক্ত কথা`);
  L.push("");
  L.push(d.extraNotesBn.trim() || "—");
  L.push("");
  L.push("---");
  L.push("");
  L.push("আপনার সামগ্রিক মত: ☐ অনুমোদিত ☐ পরিবর্তন দরকার — স্বাক্ষর ও তারিখ: ____________");
  L.push("");
  return L.join("\n");
}

function pageRange(pageMap: { chapterKey: string; startPage: number | null }[] | undefined, totalPages: number | undefined, key: string): string {
  if (!pageMap?.length) return "";
  const sorted = pageMap.filter((p) => p.startPage != null).sort((a, b) => a.startPage! - b.startPage!);
  const i = sorted.findIndex((p) => p.chapterKey === key);
  if (i < 0) return "";
  const start = sorted[i].startPage!;
  const end = i + 1 < sorted.length ? sorted[i + 1].startPage! - 1 : totalPages ?? start;
  return end > start ? `${toBnDigits(start)}–${toBnDigits(end)}` : toBnDigits(start);
}

function frontPages(pageMap: { startPage: number | null }[] | undefined): string {
  const first = Math.min(...(pageMap ?? []).filter((p) => p.startPage != null).map((p) => p.startPage!));
  return Number.isFinite(first) && first > 1 ? (first > 2 ? `${toBnDigits(1)}–${toBnDigits(first - 1)}` : toBnDigits(1)) : "";
}

/** Versions after `base` (exclusive) up to `v` (inclusive), oldest first, by parent pointers. */
export async function versionChain(v: IBookVersion, baseId?: Types.ObjectId | null): Promise<IBookVersion[]> {
  const out: IBookVersion[] = [];
  let cur: IBookVersion | null = v;
  let guard = 0;
  while (cur && guard++ < 500) {
    if (baseId && cur._id.equals(baseId)) break;
    out.push(cur);
    cur = cur.parentVersionId ? await BookVersion.findById(cur.parentVersionId) : null;
  }
  return out.reverse();
}

/** Chapters whose text differs between base and v (incl. new and removed), in v's order. A chapter
 *  whose only difference is inside `bl:server` regions (the version line / log the server rewrites
 *  on every version) does not count as changed. */
export async function changedChapterKeys(base: IBookVersion | null, v: IBookVersion): Promise<{ key: string; title: string }[]> {
  if (!base) return v.chapters.filter((c) => c.key !== FRONT_KEY).map((c) => ({ key: c.key, title: c.title }));
  const b = new Map(base.chapters.map((c) => [c.key, c.textSha256]));
  const differ = [...v.chapters].sort((x, y) => x.order - y.order).filter((c) => b.get(c.key) !== c.textSha256);
  const texts = await chapterTextsBySha([...differ.map((c) => c.textSha256), ...differ.map((c) => b.get(c.key)).filter((x): x is string => !!x)]);
  const strip = (t: string) => t.replace(/(<!-- bl:server start[^>]*?-->)[\s\S]*?(<!-- bl:server end -->)/g, "$1$2");
  const out = differ
    .filter((c) => {
      const old = b.get(c.key);
      if (!old) return true;
      return strip(texts.get(old) ?? "") !== strip(texts.get(c.textSha256) ?? "");
    })
    .map((c) => ({ key: c.key, title: c.title }));
  for (const c of base.chapters) if (!v.chapters.some((x) => x.key === c.key)) out.push({ key: c.key, title: `${c.title} (বাদ)` });
  return out;
}

export async function buildMemoData(round: IBookMemoRound, now = new Date()): Promise<MemoData> {
  const book = await loadBook(round.bookId);
  const v = await loadVersion(round.versionId);
  const base = round.baseVersionId ? await loadVersion(round.baseVersionId) : null;
  const pageMap = round.packet?.pageMap;
  const total = round.packet?.pageCount;
  const titleOf = (key: string) => v.chapters.find((c) => c.key === key)?.title ?? key;
  const rows: MemoRow[] = [];
  if (base) {
    for (const ver of await versionChain(v, base._id)) {
      for (const c of ver.changes) {
        const what = c.beforeExcerpt || c.afterExcerpt ? `«${quote(c.beforeExcerpt)}» → «${quote(c.afterExcerpt)}»` : "—";
        rows.push({
          page: c.page ? c.page : pageRange(pageMap, total, c.chapterKey),
          where: c.where || titleOf(c.chapterKey),
          what,
          reason: c.reason,
          refs: c.refs.join(", "),
          typeBn: `${ROUTE_TYPE_BN[c.route]}${c.sacred ? " · কুরআন/হাদিস/দোয়া — দেখে নিন" : ""}`,
        });
      }
    }
  }
  const edits = new Map(round.wordingEdits.map((w) => [w.code, w.textBn]));
  const fb = await BookFeedback.find({ _id: { $in: round.feedbackIds } }).sort({ createdAt: 1 }).lean();
  const items: MemoItem[] = fb.map((f) => ({
    code: f.code,
    where: [f.anchor.chapterKey ? titleOf(f.anchor.chapterKey) : "", f.anchor.where ?? "", f.anchor.page ? `পৃ. ${toBnDigits(f.anchor.page)}` : f.anchor.chapterKey ? (pageRange(pageMap, total, f.anchor.chapterKey) ? `পৃ. ${pageRange(pageMap, total, f.anchor.chapterKey)}` : "") : ""].filter(Boolean).join(" › "),
    quote: f.anchor.quote ? quote(f.anchor.quote, 160) : "",
    textBn: edits.get(f.code) ?? f.textBn,
    edited: edits.has(f.code),
    sourceBn: SOURCE_BN[f.source] ?? f.source,
  }));
  const decs = await BookDecision.find({ _id: { $in: round.decisionIds } }).sort({ code: 1 }).lean();
  const decisions: MemoDecision[] = decs.map((d) => ({ code: d.code, questionBn: edits.get(d.code) ?? d.questionBn, options: d.options, recommendedKey: d.recommendedKey }));
  const assigner = { name: (await namesOf([round.assignedBy])).get(round.assignedBy.toString()) };
  const scopeLabel = round.packet?.scope === "changed" ? "বই PDF (শুধু বদলানো অধ্যায়)" : "বই PDF (পুরো বই)";
  return {
    bookCode: book.code,
    bookTitleBn: book.titleBn,
    memoNo: round.memoNo,
    reviewerName: round.reviewerName,
    assignerName: assigner?.name ?? "প্রধান শিক্ষক",
    dateKey: dhakaDayKey(round.memo.frozen && round.memo.generatedAt ? round.memo.generatedAt : now),
    version: vno(v),
    base: base ? vno(base) : null,
    attachments: ["স্মারক PDF", scopeLabel],
    changedChapters: (await changedChapterKeys(base, v)).map((c) => ({ ...c, pages: c.key === FRONT_KEY ? frontPages(pageMap) : pageRange(pageMap, total, c.key) })),
    rows,
    items,
    decisions,
    extraNotesBn: round.memo.extraNotesBn ?? "",
  };
}

/**
 * Path B manual — the bundle zip and the return-transcription pack (docs/prd-book-lifecycle.md §15.4;
 * D-#1605, D-#1615).
 *
 * Bundle: METHOD.md (the method file byte for byte), the base master with markers, the outline, the
 * chosen items (feedback text de-identified against the whole school, fail-closed PER ITEM — an item
 * naming a student or guardian is left out, named, D-#1606) and instructions, active rule sets, the
 * ruled decision log, OUTPUT.md. Built in memory and streamed; the server keeps only the nonce, the
 * base hash and the item list (an open `bundle` draft). Results come back into that draft through
 * the same validator.
 *
 * Transcription pack: the round's memo, codes, page map and scans + OUTPUT.md describing
 * `book-feedback-items/v1`; its upload creates the same UNCHECKED rows as MCP `add_feedback_items`
 * (via: bundle) and never records a verdict.
 */
import { randomBytes } from "crypto";
import JSZip from "jszip";
import { z } from "zod";
import { BOOK_FEEDBACK_CATEGORIES, BOOK_ITEM_VERDICTS, BOOK_LC_LIMITS } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { BookEditDraft, type IBookEditDraft } from "../models/BookEditDraft";
import { BookFeedback, BookInstruction, BookDecision, type IBookFeedback } from "../models/BookFeedback";
import { BookMediaAsset } from "../models/BookVersion";
import { BookMemoRound } from "../models/BookMemoRound";
import { requireBookLc, uid } from "./access";
import { BookLcError } from "./errors";
import { lcEvent, recordContentRead } from "./events";
import { loadLcFile } from "./files";
import { loadBook, loadVersion, storedMaster, versionChapters, vlabel } from "./store";
import { activeRuleSetsFor } from "./feedbackService";
import { applyChapterEdit, openEditDraft, putChapter } from "./draftService";
import { loadDraft } from "./versionService";
import { methodText } from "./method";
import { normaliseMarkdown, parseMaster } from "./markdown";
import { loadRound, proposeTranscription, roundMemoMarkdown } from "./roundService";
import { bookMemoMarkdown, buildMemoData } from "./memo";
import type { IBookMemoRound } from "../models/BookMemoRound";
import { scopeForSchool } from "../../platform/services/DeidScopeService";
import { deidentify } from "../../platform/ai/deidentify";
import { writeAudit } from "../../platform/services/AuditService";

/** Hard cap on one bundle / pack (bytes of file content, before compression). */
export const BUNDLE_MAX_BYTES = 300 * 1024 * 1024;
const ALREADY_COMPRESSED = /\.(pdf|jpe?g|png|webp|zip|docx)$/i;

/** A zip that refuses to grow past the cap and STOREs files that are already compressed. */
function cappedZip(): { zip: JSZip; add: (name: string, data: string | Buffer) => void } {
  const zip = new JSZip();
  let total = 0;
  return {
    zip,
    add(name, data) {
      total += typeof data === "string" ? Buffer.byteLength(data) : data.length;
      if (total > BUNDLE_MAX_BYTES) throw new BookLcError("CAP", "বান্ডেল খুব বড় — ছবি বাদ দিয়ে আবার চেষ্টা করুন");
      zip.file(name, data, ALREADY_COMPRESSED.test(name) ? { compression: "STORE" } : undefined);
    },
  };
}

/** A scan's name as one safe path segment (no folders, no dots-only, no control characters). */
export function safeBaseName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? "";
  const cleaned = last.replace(/[\u0000-\u001f]/g, "").replace(/^\.+/, "").trim().slice(0, 120);
  return cleaned || "scan";
}

export const NAME_LEFT_OUT_BN = "নাম আছে — বাছাইয়ে ঠিক করুন";

/**
 * Feedback text for AI or a bundle (§9.6, D-#1606): de-identified against the whole school; an item
 * whose text or quote names a student or guardian is LEFT OUT with the reason (fail-closed per item);
 * staff names and phone/number runs are replaced by tokens. Reporter names are never included.
 */
export async function deidentifiedItems(items: IBookFeedback[]): Promise<{ kept: { item: IBookFeedback; textBn: string; quote: string }[]; excluded: { code: string; reasonBn: string }[] }> {
  const scope = await scopeForSchool();
  const kept: { item: IBookFeedback; textBn: string; quote: string }[] = [];
  const excluded: { code: string; reasonBn: string }[] = [];
  for (const item of items) {
    const t = deidentify(item.textBn, scope);
    const q = deidentify(item.anchor?.quote ?? "", scope);
    const named = [...Object.keys(t.map), ...Object.keys(q.map)].some((k) => /^\[(S|G)/.test(k));
    if (named) excluded.push({ code: item.code, reasonBn: NAME_LEFT_OUT_BN });
    else kept.push({ item, textBn: t.text, quote: q.text });
  }
  return { kept, excluded };
}

const README = (code: string, label: string) => `# বই বান্ডেল — ${code} ${label}

এটি বিদ্যালয়ের বইয়ের একটি সম্পাদনা-বান্ডেল। Claude (বা যে কেউ) এটি থেকে পরিবর্তনের প্রস্তাব তৈরি করে; প্রধান শিক্ষক অ্যাপে অধ্যায় ধরে ধরে গ্রহণ করেন। কিছুই নিজে নিজে বদলায় না।

চ্যাটে এই এক লাইন লিখুন:

এই ফাইলের METHOD অনুসরণ করুন; শুধু book-edit-result JSON দিন।

ফাইল: METHOD.md (পদ্ধতি) · book/master.md · book/outline.json · feedback.json · rules/ · decisions.md · OUTPUT.md
`;

const OUTPUT_EDIT = (nonce: string, baseHash: string, method: string) => `# OUTPUT — book-edit-result/v1

Return ONE JSON object, nothing else:

\`\`\`json
{
  "schema": "book-edit-result/v1",
  "bundle": "${nonce}",
  "baseMasterHash": "${baseHash}",
  "methodVersion": "${method}",
  "chapters": [
    {
      "schema": "book-chapter-edit/v1",
      "draft": "${nonce}",
      "chapter": "ch-002",
      "baseSha": "<sha256 of ch-002 from book/outline.json>",
      "ops": [ { "op": "replace", "before": "বসে ৫টি হাঁস", "after": "বসে পাঁচটি হাঁস", "refs": ["F-7"], "reasonBn": "সংখ্যা কথায়" } ],
      "notApplied": [],
      "alsoElsewhere": []
    }
  ]
}
\`\`\`

(The example text is invented.) Each chapter object follows METHOD.md section M-6 exactly.
`;

export async function downloadBundle(
  auth: AuthPayload,
  bookId: string,
  input: { feedback?: string[] | null; instructionIds?: string[] | null; instructions?: { text: string; needsReview?: boolean | null }[] | null; includeMedia?: boolean | null },
  opts: { buffer?: boolean } = {},
): Promise<{ zip: Buffer; jszip: JSZip; filename: string; nonce: string; draftId: string; excluded: { code: string; reasonBn: string }[] }> {
  requireBookLc(auth, "manage");
  const book = await loadBook(bookId);
  const draft = await openEditDraft(auth, bookId, { source: "bundle", feedback: input.feedback, instructionIds: input.instructionIds, instructions: input.instructions });
  const base = await loadVersion(draft.baseVersionId);
  const m = methodText();
  const items = await BookFeedback.find({ _id: { $in: draft.feedbackIds } }).sort({ createdAt: 1 });
  const { kept, excluded } = await deidentifiedItems(items);
  const instructions = await BookInstruction.find({ _id: { $in: draft.instructionIds } }).sort({ createdAt: 1 });
  const decisions = await BookDecision.find({ bookId: book._id, status: "ruled" }).sort({ code: 1 });
  const ruleSets = await activeRuleSetsFor(book);
  const chapters = await versionChapters(base);
  const cz = cappedZip();
  const zip = { file: cz.add } as { file: (name: string, data: string | Buffer) => void };
  zip.file("README.md", README(book.code, vlabel(base)));
  zip.file("METHOD.md", m.text);
  zip.file("book/master.md", await storedMaster(base));
  zip.file("book/outline.json", JSON.stringify({ book: book.code, version: vlabel(base), baseMasterHash: base.masterHash, chapters: chapters.map((c) => ({ key: c.key, title: c.title, sha256: c.sha, chars: c.text.length })), media: base.media.map((x) => x.path) }, null, 2));
  zip.file(
    "feedback.json",
    JSON.stringify(
      {
        items: kept.map((k) => ({ code: k.item.code, category: k.item.category, chapterKey: k.item.anchor?.chapterKey ?? null, where: k.item.anchor?.where ?? null, page: k.item.anchor?.page ?? null, quote: k.quote || null, text: k.textBn, route: k.item.route ?? null, ruling: k.item.reviewerRuling?.verdict ? { verdict: k.item.reviewerRuling.verdict, note: k.item.reviewerRuling.noteBn ?? null } : null })),
        instructions: instructions.map((i) => ({ code: i.code, text: i.textBn, needsReview: i.needsReview })),
        leftOut: excluded,
      },
      null,
      2,
    ),
  );
  for (const rs of ruleSets) zip.file(`rules/${rs.key}.md`, rs.bodyMarkdown);
  zip.file("decisions.md", decisions.map((d) => `## ${d.code} — ${d.questionBn}\n\nরায়: ${d.ruling?.optionKey ? `${d.ruling.optionKey}) ${d.options.find((o) => o.key === d.ruling?.optionKey)?.textBn ?? ""}` : ""}${d.ruling?.textBn ? ` — ${d.ruling.textBn}` : ""}\n`).join("\n") || "—\n");
  zip.file("OUTPUT.md", OUTPUT_EDIT(draft.bundleNonce!, base.masterHash, m.version));
  if (input.includeMedia) {
    for (const md of base.media) {
      const asset = await BookMediaAsset.findById(md.assetId);
      if (asset) zip.file(md.path, (await loadLcFile(asset.storedFileId)).data);
    }
  }
  const buf = opts.buffer === false ? Buffer.alloc(0) : await cz.zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await recordContentRead({ bookId: book._id, versionId: base._id, userId: auth.userId, surface: "bundle" });
  await lcEvent({ bookId: book._id, kind: "BUNDLE_DOWNLOADED", actorId: uid(auth), summary: `bundle ${draft.bundleNonce} (${kept.length} items, ${excluded.length} left out)`, refs: { draftId: draft._id, versionId: base._id } });
  await writeAudit({ eventKind: "BOOK_LC_BUNDLE_DOWNLOADED", actorId: auth.userId, actorRole: auth.role, targetKind: "BookEditDraft", targetId: draft._id.toString(), meta: { bookCode: book.code, version: vlabel(base), nonce: draft.bundleNonce, items: kept.length, leftOut: excluded.length } });
  return { zip: buf, jszip: cz.zip, filename: `book-bundle_${book.code}_${vlabel(base)}_${draft.bundleNonce}.zip`, nonce: draft.bundleNonce!, draftId: draft._id.toString(), excluded };
}

/**
 * The round's memo for Claude (§9.6): rebuilt from its data, never the frozen text — reviewer and assigner
 * names are replaced by their roles, items that name a student or guardian are left out (listed), and every
 * free text runs through the same de-identification as the bundle's feedback.
 */
export async function deidentifiedMemo(r: IBookMemoRound): Promise<{ markdown: string; leftOut: { code: string; reasonBn: string }[]; items: { code: string; textBn: string; quote: string }[] }> {
  const data = await buildMemoData(r);
  const scope = await scopeForSchool();
  const de = (t: string) => deidentify(t ?? "", scope).text;
  const raw = await BookFeedback.find({ _id: { $in: r.feedbackIds } }).sort({ createdAt: 1 });
  const { kept, excluded } = await deidentifiedItems(raw);
  const keep = new Map(kept.map((k) => [k.item.code, k]));
  const items = data.items.filter((i) => keep.has(i.code)).map((i) => ({ ...i, where: de(i.where), textBn: de(i.textBn), quote: de(i.quote) }));
  const markdown = bookMemoMarkdown({
    ...data,
    reviewerName: "পর্যালোচক",
    assignerName: "প্রধান শিক্ষক",
    items,
    decisions: data.decisions.map((d) => ({ ...d, questionBn: de(d.questionBn), options: d.options.map((o) => ({ ...o, textBn: de(o.textBn) })) })),
    rows: data.rows.map((x) => ({ ...x, where: de(x.where), what: de(x.what), reason: de(x.reason) })),
    extraNotesBn: de(data.extraNotesBn),
  });
  return { markdown, leftOut: excluded, items: items.map((i) => ({ code: i.code, textBn: i.textBn, quote: i.quote })) };
}

/** The raw JSON, or the first fenced block of a .md / .txt answer (≤ 4 MB). */
export function extractJson(text: string): unknown {
  if (text.length > 4 * 1024 * 1024) throw new BookLcError("TOO_BIG", "ফলাফল ৪ মেগাবাইটের বেশি");
  const t = text.replace(/^﻿/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = /```(?:json)?\s*\n([\s\S]*?)```/.exec(t);
    if (!m) throw new BookLcError("NO_JSON", "ফলাফলে JSON পাওয়া যায়নি");
    try {
      return JSON.parse(m[1]);
    } catch {
      throw new BookLcError("BAD_JSON", "JSON পড়া যায়নি");
    }
  }
}

const ResultSchema = z
  .object({
    schema: z.literal("book-edit-result/v1"),
    bundle: z.string().min(8).max(64),
    baseMasterHash: z.string().regex(/^[0-9a-f]{64}$/),
    methodVersion: z.string().max(10),
    chapters: z.array(z.unknown()).max(500),
  })
  .strict();

async function bundleDraft(bookId: string, nonce: string): Promise<IBookEditDraft> {
  const book = await loadBook(bookId);
  const draft = await BookEditDraft.findOne({ bookId: book._id, bundleNonce: nonce });
  if (!draft) throw new BookLcError("VR-1", "এই বান্ডেলের খসড়া পাওয়া যায়নি (অন্য বান্ডেল?)");
  return draft;
}

/** Upload a `book-edit-result/v1` answer back into the bundle's draft (same validator). */
export async function uploadBundleResult(auth: AuthPayload, bookId: string, text: string): Promise<{ draftId: string; chapters: { key: string; status: string; blocking: number }[] }> {
  requireBookLc(auth, "manage");
  const parsed = ResultSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new BookLcError("VR-2", `কাঠামো ভুল (VR-2): ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`);
  const r = parsed.data;
  const draft = await bundleDraft(bookId, r.bundle);
  if (r.baseMasterHash !== draft.baseMasterHash) throw new BookLcError("VR-1", "ফলাফলটি অন্য ভিত্তি-সংস্করণের (VR-1)");
  if (r.methodVersion !== draft.methodVersion) throw new BookLcError("VR-2", "পদ্ধতির সংস্করণ মেলে না (VR-2)");
  const out: { key: string; status: string; blocking: number }[] = [];
  for (const ch of r.chapters) {
    const res = await applyChapterEdit(auth, draft._id.toString(), ch);
    out.push({ key: String((ch as { chapter?: unknown })?.chapter ?? "?"), status: res.status, blocking: res.findings.filter((f) => f.level === "blocking").length });
  }
  return { draftId: draft._id.toString(), chapters: out };
}

/** Upload a whole `master.md` + `changes.json` (book-change-list/v1 rows) into the bundle's draft. */
export async function uploadBundleWhole(auth: AuthPayload, bookId: string, input: { nonce: string; master: Buffer; changesJson: string }): Promise<{ draftId: string; chapters: { key: string; status: string; unexplained: number }[]; newChapters: string[]; missingChapters: string[]; ignoredKeys: string[] }> {
  requireBookLc(auth, "manage");
  const draft = await bundleDraft(bookId, input.nonce);
  const book = await loadBook(bookId);
  const changes = extractJson(input.changesJson);
  const rows = Array.isArray(changes) ? changes : Array.isArray((changes as { changes?: unknown[] })?.changes) ? (changes as { changes: unknown[] }).changes : null;
  if (!rows) throw new BookLcError("VR-2", "changes.json একটি তালিকা হতে হবে (VR-2)");
  if (input.master.length > BOOK_LC_LIMITS.masterMdBytes) throw new BookLcError("CAP", "master.md ৫ মেগাবাইটের বেশি");
  const parsed = parseMaster(normaliseMarkdown(input.master), book.chapterHeadingLevel);
  // Markers are the chapters' identity: a stray or repeated marker is refused, never guessed.
  if (parsed.strayMarkers.length) throw new BookLcError("VR-6", `শিরোনামহীন অধ্যায়-মার্কার আছে: ${parsed.strayMarkers.join(", ")} (VR-6)`);
  if (parsed.duplicateKeys.length) throw new BookLcError("VR-6", `একই অধ্যায়-মার্কার একাধিকবার আছে: ${parsed.duplicateKeys.join(", ")} (VR-6)`);
  const base = await versionChapters(await loadVersion(draft.baseVersionId));
  const baseKeys = new Set(base.map((b) => b.key));
  const out: { key: string; status: string; unexplained: number }[] = [];
  const next = new Map<string, string>([["front", parsed.front], ...parsed.chapters.filter((c) => c.key).map((c) => [c.key!, c.text] as [string, string])]);
  // Never silently drop a chapter: whatever does not match is reported for the person to confirm.
  const newChapters = parsed.chapters.filter((c) => !c.key || !baseKeys.has(c.key)).map((c) => c.title);
  const missingChapters = base.filter((b) => b.key !== "front" && !next.has(b.key)).map((b) => b.key);
  const ignoredKeys = [...next.keys()].filter((k) => k !== "front" && !baseKeys.has(k));
  for (const b of base) {
    const t = next.get(b.key);
    if (t === undefined || t === b.text) continue;
    const res = await putChapter(auth, draft._id.toString(), b.key, t, rows);
    out.push({ key: b.key, status: res.status, unexplained: res.unexplained });
  }
  if (newChapters.length || missingChapters.length) {
    await lcEvent({ bookId: book._id, kind: "DRAFT_CHAPTER", actorId: uid(auth), summary: `bundle upload: ${newChapters.length} new, ${missingChapters.length} missing chapter(s) NOT applied`, refs: { draftId: draft._id } });
  }
  return { draftId: draft._id.toString(), chapters: out, newChapters, missingChapters, ignoredKeys };
}

// ---------------------------------------------------------------------------
// The return-transcription pack (§15.4, owner Q1)
// ---------------------------------------------------------------------------

const OUTPUT_ITEMS = (roundId: string, nonce: string) => `# OUTPUT — book-feedback-items/v1

Read the reviewer's marked copy in scans/ against memo.md and codes.json. Return ONE JSON object:

\`\`\`json
{
  "schema": "book-feedback-items/v1",
  "round": "${roundId}",
  "nonce": "${nonce}",
  "scan_file_id": "<one of the file ids in codes.json → scans>",
  "items": [ { "chapter_key": "ch-002", "page": "৭", "quote": "<what the book says>", "category": "spelling", "text_bn": "<her point>", "scan_page": 2 } ],
  "item_marks": [ { "feedback_code": "F-12", "verdict": "agree", "note_bn": null, "scan_page": 1 } ],
  "decision_marks": [ { "decision_code": "D-03", "option_key": "খ", "note_bn": null, "scan_page": 1 } ]
}
\`\`\`

verdict: agree | disagree | modify. option_key: the option she ticked (omit when she left it for later).
Every row you send arrives UNCHECKED; the Principal checks each against the scan and records her
verdict himself. Never write a verdict for her.
`;

export async function downloadTranscriptionPack(auth: AuthPayload, roundId: string, opts: { buffer?: boolean } = {},
): Promise<{ zip: Buffer; jszip: JSZip; filename: string; nonce: string }> {
  requireBookLc(auth, "manage");
  const r = await loadRound(roundId);
  if (r.status !== "sent_on_paper") throw new BookLcError("ROUND_STATE", "শুধু কাগজে পাঠানো পর্যালোচনার প্যাক");
  if (!r.scanFileIds.length) throw new BookLcError("NO_SCAN", "আগে ফেরত কপির স্ক্যান তুলুন");
  const book = await loadBook(r.bookId);
  const nonce = randomBytes(12).toString("hex");
  await BookMemoRound.updateOne({ _id: r._id }, { $set: { transcriptionNonce: nonce } });
  const [items, decs] = await Promise.all([BookFeedback.find({ _id: { $in: r.feedbackIds } }).sort({ createdAt: 1 }), BookDecision.find({ _id: { $in: r.decisionIds } }).sort({ code: 1 })]);
  const { kept, excluded } = await deidentifiedItems(items);
  const cz2 = cappedZip();
  const zip = { file: cz2.add } as { file: (name: string, data: string | Buffer) => void };
  zip.file("README.md", `# ফেরত কপি — স্মারক ${r.memoNo} (${book.code})\n\nscans/ দেখে তাঁর দাগ ও লেখা OUTPUT.md-র JSON-এ তুলুন। প্রতিটি সারি "মেলানো হয়নি" অবস্থায় আসবে।\n`);
  zip.file("memo.md", await roundMemoMarkdown(r));
  const scans: { file_id: string; name: string }[] = [];
  for (const [i, id] of r.scanFileIds.entries()) {
    const { file, data } = await loadLcFile(id);
    const name = `scans/${String(i + 1).padStart(2, "0")}_${safeBaseName(file.originalName)}`;
    zip.file(name, data);
    scans.push({ file_id: id.toString(), name });
  }
  zip.file(
    "codes.json",
    JSON.stringify(
      {
        round: r._id.toString(),
        memo: r.memoNo,
        items: kept.map((k) => ({ code: k.item.code, text: k.textBn, quote: k.quote || null })),
        leftOut: excluded,
        decisions: decs.map((d) => ({ code: d.code, question: d.questionBn, options: d.options })),
        scans,
      },
      null,
      2,
    ),
  );
  zip.file("pagemap.json", JSON.stringify(r.packet?.pageMap ?? [], null, 2));
  zip.file("OUTPUT.md", OUTPUT_ITEMS(r._id.toString(), nonce));
  const buf = opts.buffer === false ? Buffer.alloc(0) : await cz2.zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await lcEvent({ bookId: r.bookId, kind: "BUNDLE_DOWNLOADED", actorId: uid(auth), summary: `transcription pack for memo ${r.memoNo}`, refs: { roundId: r._id } });
  await writeAudit({ eventKind: "BOOK_LC_BUNDLE_DOWNLOADED", actorId: auth.userId, actorRole: auth.role, targetKind: "BookMemoRound", targetId: r._id.toString(), meta: { bookCode: book.code, memoNo: r.memoNo, nonce, kind: "transcription" } });
  return { zip: buf, jszip: cz2.zip, filename: `transcription_${book.code}_memo-${r.memoNo}_${nonce}.zip`, nonce };
}

const ItemsSchema = z
  .object({
    schema: z.literal("book-feedback-items/v1"),
    round: z.string(),
    nonce: z.string(),
    scan_file_id: z.string().optional(),
    items: z
      .array(
        z
          .object({
            chapter_key: z.string().optional(),
            where: z.string().max(200).optional(),
            page: z.string().max(20).optional(),
            quote: z.string().max(500).optional(),
            category: z.enum(BOOK_FEEDBACK_CATEGORIES),
            text_bn: z.string().min(1).max(2000),
            scan_page: z.number().int().positive().optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    item_marks: z.array(z.object({ feedback_code: z.string(), verdict: z.enum(BOOK_ITEM_VERDICTS), note_bn: z.string().max(2000).nullish(), scan_page: z.number().int().positive().nullish() }).strict()).max(200).default([]),
    decision_marks: z.array(z.object({ decision_code: z.string(), option_key: z.string().nullish(), note_bn: z.string().max(2000).nullish(), scan_page: z.number().int().positive().nullish() }).strict()).max(100).default([]),
  })
  .strict();

/** Upload a `book-feedback-items/v1` answer: UNCHECKED rows (via bundle); never a verdict. */
export async function uploadTranscriptionResult(auth: AuthPayload, roundId: string, text: string): Promise<{ created: string[] }> {
  requireBookLc(auth, "manage");
  const parsed = ItemsSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new BookLcError("VR-2", `কাঠামো ভুল: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`);
  const p = parsed.data;
  const r = await loadRound(roundId);
  const nonce = r.transcriptionNonce;
  if (p.round !== r._id.toString() || !nonce || p.nonce !== nonce) throw new BookLcError("MISMATCH", "এই ফলাফল অন্য পর্যালোচনা বা অন্য প্যাকের");
  const scan = p.scan_file_id ?? r.scanFileIds[0]?.toString();
  if (!scan) throw new BookLcError("NO_SCAN", "স্ক্যান নেই");
  if (!r.scanFileIds.some((s) => s.toString() === scan)) throw new BookLcError("BAD_SCAN", "স্ক্যানটি এই পর্যালোচনার নয়");
  // Validate EVERY mark before anything is written (a bad row must not leave half an answer behind).
  const asked = await BookFeedback.find({ _id: { $in: r.feedbackIds } }).select("code").lean();
  const decs = await BookDecision.find({ _id: { $in: r.decisionIds } }).select("code options").lean();
  for (const m of p.item_marks) if (!asked.some((x) => x.code === m.feedback_code)) throw new BookLcError("NOT_ASKED", `${m.feedback_code} এই স্মারকে চাওয়া হয়নি`);
  for (const m of p.decision_marks) {
    const d = decs.find((x) => x.code === m.decision_code);
    if (!d) throw new BookLcError("NOT_ASKED", `${m.decision_code} এই স্মারকে চাওয়া হয়নি`);
    if (m.option_key && !d.options.some((o) => o.key === m.option_key)) throw new BookLcError("BAD_OPTION", `${m.decision_code}: বিকল্প ভুল`);
  }
  // One answer per pack: the nonce is consumed first, so a second upload (or a double click) is refused.
  const taken = await BookMemoRound.updateOne({ _id: r._id, transcriptionNonce: nonce }, { $unset: { transcriptionNonce: 1 } });
  if (!taken.modifiedCount) throw new BookLcError("MISMATCH", "এই প্যাকের উত্তর আগেই নেওয়া হয়েছে");
  try {
    return await applyTranscription();
  } catch (e) {
    await BookMemoRound.updateOne({ _id: r._id, transcriptionNonce: { $exists: false } }, { $set: { transcriptionNonce: nonce } });
    throw e;
  }
  async function applyTranscription(): Promise<{ created: string[] }> {
  const { items } = await proposeTranscription(
    auth,
    roundId,
    {
      scanFileId: scan,
      items: p.items.map((i) => ({ chapterKey: i.chapter_key, where: i.where, page: i.page, quote: i.quote, category: i.category, textBn: i.text_bn, scanPage: i.scan_page })),
      itemMarks: p.item_marks.map((m) => ({ feedbackCode: m.feedback_code, verdict: m.verdict, noteBn: m.note_bn, scanPage: m.scan_page })),
      decisionMarks: p.decision_marks.map((m) => ({ decisionCode: m.decision_code, optionKey: m.option_key, noteBn: m.note_bn, scanPage: m.scan_page })),
    },
    "bundle",
  );
  return { created: items.map((i) => i.code) };
  }
}

export { loadDraft };

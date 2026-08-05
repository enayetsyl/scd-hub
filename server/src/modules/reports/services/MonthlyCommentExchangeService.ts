/**
 * MonthlyCommentExchangeService (MR-8, prd-monthly-report §8b, D-#415) — the Desktop
 * round trip: export de-identified Markdown, author the paragraphs elsewhere, paste a
 * JSON envelope back.
 *
 * A SECOND LANE TO THE SAME FIELD. Both lanes write `commentDraft` and neither can
 * release anything; the only difference an imported comment carries is
 * `source: "IMPORT"`. It exists because the in-app free tier rate-limits mid-class and
 * writes a serviceable rather than a good paragraph, and because the school already
 * authors its curriculum this way (docs/import-workflow.md).
 *
 * Three things this file is responsible for, none of which the format can be trusted
 * to enforce on its own:
 *
 *   1. NOTHING IDENTIFYING LEAVES. A file pasted into a chat window is a WIDER
 *      exposure than an API call, not a narrower one, so the export carries exactly
 *      the `commentFactsOf` whitelist — keyed by reportId, never a name, roll or
 *      phone — and `assertDeidentified` runs per child before a byte is written.
 *   2. THE RULES ARE NOT COPIED. The instruction block is `commentRules()`, the same
 *      string the in-app prompt is built from. Two copies would drift within a month.
 *   3. AN UPLOAD IS UNVERIFIED TEXT. That a person pasted it does not make its numbers
 *      real, so on the way back in every row faces exactly what a generated draft
 *      faces, plus the revision binding — see `importComments`.
 */
import { Types } from "mongoose";
import { MonthlyReport, type IMonthlyReport } from "../models/MonthlyReport";
import { Class } from "../../foundation/models/Class";
import {
  commentFactsOf,
  commentRules,
  assertDeidentified,
  looksLikeProse,
  validateNumerals,
  monthLabelBn,
  type CommentFacts,
} from "./MonthlyCommentService";
import { figuresHashOf, type MonthlySnapshot } from "./MonthlyReportService";
import { writeAudit } from "../../platform/services/AuditService";

/** Bumped when the export's SHAPE changes, so a stale file pasted back is legible as
 *  stale rather than mysteriously wrong. Distinct from the prompt version. */
export const MONTHLY_COMMENT_EXCHANGE_VERSION = "mr8-1";

// ---------------------------------------------------------------------------
// Export — Markdown, de-identified
// ---------------------------------------------------------------------------

/** One child's block, before it is rendered. `assertDeidentified` has already run. */
export interface ExportBlock {
  reportId: string;
  revision: number;
  figuresHash: string;
  facts: CommentFacts;
}

/**
 * The class level per report, batched.
 *
 * `classLevel` is NOT in the snapshot — the in-app lane resolves it from the Class
 * (`MonthlyReportService.draftMonthlyComment`), and reading a non-existent snapshot
 * field here silently sent the model `null` where the other lane sent a number. That
 * is the two lanes disagreeing about the facts, which is the whole thing this module
 * claims not to do, so both directions now resolve it the same way.
 *
 * It also matters on the way back: `classLevel` is one of `allowedNumbers`, so a
 * paragraph that legitimately mentions the class would be refused as an invented
 * numeral if import resolved it differently from export.
 */
export async function classLevelsFor(
  reports: readonly IMonthlyReport[],
): Promise<Map<string, number | null>> {
  const classIds = [...new Set(reports.map((r) => r.classId?.toString()).filter(Boolean))];
  const classes = (await Class.find({ _id: { $in: classIds } })
    .select("level")
    .lean()) as unknown as Array<{ _id: { toString(): string }; level: number }>;
  const levelByClass = new Map(classes.map((c) => [c._id.toString(), c.level ?? null]));
  return new Map(
    reports.map((r) => [r._id.toString(), levelByClass.get(r.classId?.toString() ?? "") ?? null]),
  );
}

/** PURE. Snapshot rows → the blocks the file is rendered from. Reports whose comment
 *  is already reviewed are the caller's business to filter; this maps what it is given. */
export function exportBlocksOf(
  reports: readonly IMonthlyReport[],
  levels: ReadonlyMap<string, number | null>,
): ExportBlock[] {
  return reports.map((r) => {
    const snapshot = r.snapshot as unknown as MonthlySnapshot;
    const facts = commentFactsOf(snapshot, levels.get(r._id.toString()) ?? null);
    // Fail CLOSED: if the whitelist ever regresses, no file is written at all.
    assertDeidentified(facts);
    return {
      reportId: r._id.toString(),
      revision: r.revision,
      figuresHash: figuresHashOf(snapshot),
      facts,
    };
  });
}

/**
 * PURE. Blocks → the `.md` a person opens in Desktop.
 *
 * The per-child metadata lives INSIDE the fenced JSON rather than in the heading:
 * headings are the part of a Markdown file a human edits, and a reportId that can be
 * broken by a stray keystroke is a reportId that will be. The heading carries only a
 * counter, which is safe to mangle.
 */
export function buildCommentExportMarkdown(
  blocks: readonly ExportBlock[],
  opts: { periodKey: string; sectionLabel: string; sectionId: string | null },
): string {
  // The return rows ECHO `revision` + `figuresHash`. §8b.2 sketches the envelope with
  // only reportId + text, but §8b.4's binding cannot run on what does not come back —
  // without the echo the drift guard silently never fires, which is the exact failure
  // that section exists to prevent. Missing stamps refuse the ROW, so an older file
  // degrades to a named refusal rather than an unchecked import.
  const envelope = {
    periodKey: opts.periodKey,
    sectionId: opts.sectionId,
    comments: [{ reportId: "…", revision: 1, figuresHash: "…", text: "…" }],
  };

  const head = [
    `# মাসিক মন্তব্য — ${opts.sectionLabel} — ${monthLabelBn(opts.periodKey)}`,
    "",
    `<!-- exchangeVersion: ${MONTHLY_COMMENT_EXCHANGE_VERSION} -->`,
    "",
    `নিচে ${blocks.length} জন শিক্ষার্থীর তথ্য আছে। প্রত্যেকের জন্য একটি করে অনুচ্ছেদ লিখুন।`,
    "শিক্ষার্থীর নাম এখানে নেই — অ্যাপ ফেরত নেওয়ার সময় নাম বসিয়ে নেবে।",
    "",
    "## নিয়ম",
    "",
    commentRules(opts.periodKey),
    "",
    "## ফেরত দেওয়ার নিয়ম",
    "",
    "সব অনুচ্ছেদ লেখা হলে নিচের আকারে **শুধু JSON** ফেরত দিন — কোনো বাড়তি লেখা নয়।",
    "প্রতিটি সারিতে `reportId`, `revision` ও `figuresHash` উপরের ব্লক থেকে **হুবহু** কপি করুন —",
    "এগুলো দিয়েই অ্যাপ যাচাই করে যে এর মধ্যে সংখ্যা বদলায়নি। বদলে ফেললে সারিটি বাতিল হবে।",
    "",
    "```json",
    JSON.stringify(envelope, null, 2),
    "```",
    "",
    "---",
    "",
  ].join("\n");

  const body = blocks
    .map((b, i) =>
      [
        `## ${i + 1} / ${blocks.length}`,
        "",
        "```json",
        JSON.stringify(
          { reportId: b.reportId, revision: b.revision, figuresHash: b.figuresHash, facts: b.facts },
          null,
          2,
        ),
        "```",
        "",
      ].join("\n"),
    )
    .join("\n");

  return `${head}${body}`;
}

// ---------------------------------------------------------------------------
// Import — JSON, validated
// ---------------------------------------------------------------------------

export interface ImportedComment {
  reportId: string;
  text: string;
  /** Echoed from the export block — the revision binding (§8b.4). Null when the file
   *  predates the echo, which refuses the row rather than importing it unchecked. */
  revision: number | null;
  figuresHash: string | null;
}

export interface CommentImportEnvelope {
  periodKey: string;
  sectionId?: string | null;
  comments: ImportedComment[];
}

/** One row's verdict. A failure NAMES the row and states the remedy — never a silent
 *  drop, and never an all-or-nothing rejection of the batch. */
export interface ImportOutcome {
  reportId: string;
  imported: boolean;
  reason: string | null;
}

export class CommentImportError extends Error {}

/**
 * PURE. Parse and shape-check the pasted envelope.
 *
 * Refuses the WHOLE payload only for structural faults — bad JSON, missing period,
 * no comments, a duplicate reportId — because those mean the file itself is wrong and
 * importing half of it would leave the operator guessing which half. Per-row content
 * faults are handled downstream, where they can be reported individually.
 */
export function parseImportEnvelope(raw: string): CommentImportEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CommentImportError("JSON পড়া যায়নি — শুধু JSON অংশটুকু কপি করুন।");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new CommentImportError("JSON অবজেক্ট হতে হবে।");

  const env = parsed as Record<string, unknown>;
  const periodKey = typeof env.periodKey === "string" ? env.periodKey : "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey))
    throw new CommentImportError("periodKey নেই বা ভুল (YYYY-MM)।");

  if (!Array.isArray(env.comments) || env.comments.length === 0)
    throw new CommentImportError("comments তালিকা খালি।");

  const comments: ImportedComment[] = [];
  const seen = new Set<string>();
  for (const [i, c] of (env.comments as unknown[]).entries()) {
    if (!c || typeof c !== "object")
      throw new CommentImportError(`comments[${i}] অবজেক্ট নয়।`);
    const row = c as Record<string, unknown>;
    const reportId = typeof row.reportId === "string" ? row.reportId.trim() : "";
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!reportId) throw new CommentImportError(`comments[${i}] — reportId নেই।`);
    if (!Types.ObjectId.isValid(reportId))
      throw new CommentImportError(`comments[${i}] — reportId ভুল: ${reportId}`);
    if (seen.has(reportId))
      throw new CommentImportError(`একই reportId দুইবার আছে: ${reportId}`);
    if (!text) throw new CommentImportError(`${reportId} — text খালি।`);
    seen.add(reportId);
    comments.push({
      reportId,
      text,
      revision: typeof row.revision === "number" ? row.revision : null,
      figuresHash: typeof row.figuresHash === "string" ? row.figuresHash.trim() || null : null,
    });
  }

  return {
    periodKey,
    sectionId: typeof env.sectionId === "string" ? env.sectionId : null,
    comments,
  };
}

/**
 * PURE. Everything a single row must survive, given the report it claims to describe.
 * Separated from the write so the whole guard set is testable without a database.
 *
 * Order matters: cheapest and most fundamental first, so the reason an operator reads
 * is the ROOT one. A released report is refused before its numerals are checked,
 * because "this document is immutable" is the useful sentence, not "৪২ is not in the
 * facts" about a document that could not be edited anyway.
 */
export function checkImportedComment(
  text: string,
  report: Pick<IMonthlyReport, "status" | "revision" | "snapshot">,
  expected: { revision?: number | null; figuresHash?: string | null },
  /** Resolved the same way the export resolved it — see `classLevelsFor`. */
  classLevel: number | null = null,
): string | null {
  if (report.status === "RELEASED" || report.status === "SUPERSEDED")
    return `রিপোর্টটি ${report.status} — প্রকাশিত রিপোর্ট বদলানো যায় না।`;

  // Absent stamps are a REFUSAL, not a pass. Treating "no stamp" as "nothing to check"
  // would let an old or hand-written envelope skip the drift guard entirely — the
  // binding has to fail closed or it is not a binding.
  if (expected.revision == null || !expected.figuresHash)
    return "সারিতে revision/figuresHash নেই — এক্সপোর্ট ফাইল থেকে হুবহু কপি করুন।";

  if (expected.revision !== report.revision)
    return `রিভিশন বদলে গেছে (ফাইলে ${expected.revision}, এখন ${report.revision}) — আবার এক্সপোর্ট করে এই সারিগুলো নতুন করে লিখুন।`;

  const snapshot = report.snapshot as unknown as MonthlySnapshot;
  if (expected.figuresHash !== figuresHashOf(snapshot))
    return "এক্সপোর্টের পর সংখ্যা বদলে গেছে — আবার এক্সপোর্ট করে এই সারিগুলো নতুন করে লিখুন।";

  const shape = looksLikeProse(text);
  if (!shape.ok) return shape.reason ?? "লেখার আকার ঠিক নেই।";

  const verdict = validateNumerals(text, commentFactsOf(snapshot, classLevel));
  if (!verdict.ok)
    return `তথ্যে নেই এমন সংখ্যা আছে: ${verdict.invented.join(", ")} — সংখ্যাগুলো ঠিক করে আবার দিন।`;

  return null;
}

/**
 * Apply a parsed envelope. Each row is judged on its own and a failure NEVER stops the
 * others — an operator who pasted twenty-one paragraphs should keep the twenty that
 * are fine and be told precisely which one is not, rather than losing the batch.
 *
 * Writes `commentDraft` only. An imported comment is still a draft and a person still
 * presses accept in the app (§8b.5): treating the upload itself as the review would
 * mean the release gate could be satisfied by a file.
 */
export async function importComments(
  env: CommentImportEnvelope,
  actorId: string,
): Promise<ImportOutcome[]> {
  const ids = env.comments.map((c) => new Types.ObjectId(c.reportId));
  const reports = await MonthlyReport.find({ _id: { $in: ids } });
  const byId = new Map(reports.map((r) => [r._id.toString(), r]));
  const levels = await classLevelsFor(reports);

  const outcomes: ImportOutcome[] = [];
  for (const row of env.comments) {
    const report = byId.get(row.reportId);
    if (!report) {
      outcomes.push({ reportId: row.reportId, imported: false, reason: "এই reportId পাওয়া যায়নি।" });
      continue;
    }
    if (report.periodKey !== env.periodKey) {
      outcomes.push({
        reportId: row.reportId,
        imported: false,
        reason: `ভিন্ন মাসের রিপোর্ট (${report.periodKey})।`,
      });
      continue;
    }
    if (env.sectionId && report.sectionId.toString() !== env.sectionId) {
      outcomes.push({ reportId: row.reportId, imported: false, reason: "ভিন্ন শাখার রিপোর্ট।" });
      continue;
    }

    const reason = checkImportedComment(
      row.text,
      report,
      { revision: row.revision, figuresHash: row.figuresHash },
      levels.get(row.reportId) ?? null,
    );
    if (reason) {
      outcomes.push({ reportId: row.reportId, imported: false, reason });
      continue;
    }

    report.commentDraft = {
      text: row.text,
      source: "IMPORT",
      // No model wrote this and no prompt produced it. Naming the exchange version
      // rather than inventing a model id keeps the provenance honest — this row came
      // from a person via a file, and the field should say so.
      model: `desktop:${MONTHLY_COMMENT_EXCHANGE_VERSION}`,
      promptVersion: MONTHLY_COMMENT_EXCHANGE_VERSION,
      promptHash: row.figuresHash ?? "",
      generatedAt: new Date(),
      fallback: false,
      fallbackReason: null,
    };
    // A fresh draft is unreviewed by definition — an earlier accept on this revision
    // must not carry over onto text nobody has read.
    report.reviewedAt = null;
    report.reviewedByUserId = null;
    await report.save();
    outcomes.push({ reportId: row.reportId, imported: true, reason: null });
  }

  const imported = outcomes.filter((o) => o.imported).length;
  await writeAudit({
    eventKind: "MONTHLY_COMMENTS_IMPORTED",
    actorId,
    targetKind: "MonthlyReport",
    // ObjectId column — a period key here is silently dropped by writeAudit's
    // never-throw contract, losing the row entirely. periodKey is in `meta`.
    targetId: env.sectionId && Types.ObjectId.isValid(env.sectionId) ? env.sectionId : undefined,
    meta: {
      periodKey: env.periodKey,
      sectionId: env.sectionId,
      submitted: outcomes.length,
      imported,
      refused: outcomes.filter((o) => !o.imported).map((o) => ({ reportId: o.reportId, reason: o.reason })),
    },
  });

  return outcomes;
}

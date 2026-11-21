/**
 * Backfill the QuestionUse ledger (AL-3, D-#1667, docs/prd-academic-loop-2027.md §3.2) from what already exists:
 *
 *   • AssessmentSet.basketItems  (assembled HW / AS / CT sets; CT: the class test's exam date, else the assembled day)
 *   • HomeworkItem.selectedQids  (issued homework, given on its date)
 *   • HomeworkStudentRecord.topupQids  (a top-up to one child)
 *   • every MasteryPaper  (items + perStudentItems; HW / extra HW / AS / CT / RETEST)
 *
 * IDEMPOTENT: each row is keyed by `useKey` (source, item, qid, শাখা, children) and written with $setOnInsert, so a
 * second run — or a run after the live writers — adds nothing, and a row withdrawn on purpose is never revived.
 * `apply: false` (the default) only counts what it would add.
 */
import { AssessmentSet } from "../models/AssessmentSet";
import { QuestionUse, questionUseKey } from "../models/QuestionUse";
import { classTokenOfLevel, recordUses, usesOfPaper, usesOfSet, type UseInput } from "./QuestionUseService";
import { HomeworkItem } from "../../trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../../trackers/models/HomeworkStudentRecord";
import { MasteryPaper } from "../../mastery/models/MasteryPaper";
import { dhakaDayKey } from "../../../lib/dhakaDay";

const BATCH = 500;

export type BackfillTotals = Record<string, { found: number; added: number }>;

/** Which of these rows are not in the ledger yet (live or withdrawn). */
async function missing(uses: UseInput[]): Promise<UseInput[]> {
  const keyed = uses.map((u) => ({ u, key: questionUseKey({ ...u, studentIds: u.studentIds ?? [] }) }));
  const have = new Set(
    (await QuestionUse.find({ useKey: { $in: keyed.map((k) => k.key) } }).select("useKey").lean()).map((r) => r.useKey),
  );
  return keyed.filter((k) => !have.has(k.key)).map((k) => k.u);
}

export async function backfillQuestionUse(opts: { apply?: boolean } = {}): Promise<BackfillTotals> {
  const apply = opts.apply === true;
  const totals: BackfillTotals = {};
  const flush = async (source: string, uses: UseInput[]): Promise<void> => {
    if (uses.length === 0) return;
    const t = (totals[source] ??= { found: 0, added: 0 });
    for (let i = 0; i < uses.length; i += BATCH) {
      const part = uses.slice(i, i + BATCH);
      const fresh = await missing(part);
      t.found += part.length;
      t.added += fresh.length;
      if (apply && fresh.length > 0) await recordUses(fresh, { onlyNew: true });
    }
  };

  // 1. Assembled sets (the legacy pool sets).
  for await (const set of AssessmentSet.find({ status: "assembled" }).select("_id assembledAt createdAt").lean().cursor()) {
    const day = dhakaDayKey(new Date(set.assembledAt ?? set.createdAt ?? new Date()));
    await flush("ASSESSMENT_SET", await usesOfSet(set._id, { givenOn: day }));
  }

  // 2. Issued homework items with picked questions.
  for await (const it of HomeworkItem.find({ status: "issued", "selectedQids.0": { $exists: true } })
    .select("academicYearId sectionId classLevel subject dateGiven selectedQids")
    .lean()
    .cursor()) {
    await flush(
      "HOMEWORK_ITEM",
      [...new Set(it.selectedQids)].map((qid) => ({
        qid,
        kind: "HW" as const,
        sourceType: "HOMEWORK_ITEM" as const,
        sourceId: it._id,
        academicYearId: it.academicYearId,
        sectionId: it.sectionId,
        classToken: classTokenOfLevel(it.classLevel),
        subject: it.subject,
        givenOn: dhakaDayKey(new Date(it.dateGiven)),
      })),
    );
  }

  // 3. Top-ups (one child each).
  const itemCache = new Map<string, { academicYearId: UseInput["academicYearId"]; sectionId: UseInput["sectionId"]; classLevel: number; subject: string } | null>();
  for await (const r of HomeworkStudentRecord.find({ "topupQids.0": { $exists: true } })
    .select("hwItemId studentId topupQids createdAt")
    .lean()
    .cursor()) {
    const key = String(r.hwItemId);
    if (!itemCache.has(key)) {
      itemCache.set(key, (await HomeworkItem.findById(r.hwItemId).select("academicYearId sectionId classLevel subject").lean()) ?? null);
    }
    const it = itemCache.get(key);
    if (!it) continue;
    await flush(
      "HOMEWORK_TOPUP",
      r.topupQids.map((qid) => ({
        qid,
        kind: "HW" as const,
        sourceType: "HOMEWORK_ITEM" as const,
        sourceId: r.hwItemId,
        academicYearId: it.academicYearId,
        sectionId: it.sectionId,
        classToken: classTokenOfLevel(it.classLevel),
        subject: it.subject,
        studentIds: [r.studentId],
        givenOn: dhakaDayKey(new Date(r.createdAt)),
      })),
    );
  }

  // 4. Every mastery paper.
  for await (const p of MasteryPaper.find({ source: { $in: ["HW", "CT", "AS", "RETEST"] } }).cursor()) {
    const kind = p.source === "HW" ? (p.extra ? "EXTRA_HW" : "HW") : p.source === "AS" ? "AS" : p.source === "CT" ? "CT" : "RETEST";
    // An AS / re-test is given when it is SENT (its row day is the creation day, not the due date); HW / CT / extra: their date.
    const given = p.source === "AS" || p.source === "RETEST" ? p.createdAt : p.date;
    await flush("MASTERY_PAPER", usesOfPaper(p, kind, { givenOn: dhakaDayKey(new Date(given)), wholeIfAll: p.source === "AS" }));
  }
  return totals;
}

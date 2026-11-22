/**
 * HomeworkPaperService — AL-4 of the 2027 academic loop (docs/prd-academic-loop-2027.md §3.1, §3.6, §4.7, D-#1669):
 * the homework (and assignment) PAPER that carries per-question marks, and the glue between it and its tracker row.
 *
 *   syncPaperForItem        declare / edit with picked qids → the HW paper (normal, or marks-only when the class ×
 *                           subject has no locked tree, R20); free lines (R22) and the 1.8 min/mark time (R26)
 *   lockPaper / onHomeworkIssued / onPrintCancelled
 *                           the items lock once the sheet goes to print or is issued; the §3.2 ledger rows are
 *                           written at that moment (not at create) and withdrawn if the print is cancelled first
 *   removePaperOfItem / voidConfirmedPaper
 *                           void / undo: withdraw the rows, exclude the evidence ("বাতিল")
 *   assertRecordsAccountedFor / onPaperStudents / writeBackTrackers
 *                           the confirm guards, the child list, and the tracker cache + CHECKED write-back
 *   isTodaySubstituteFor    AC-S1: today's substitute reaches the absent teacher's শাখা × subject
 *
 * Everything here that CHANGES a 2026 behaviour is called only with `academicLoop2027On` (§3.6); the callers read the
 * switch (`isLoop2027On`) and this file never reads it for them, except `syncPaperForItem` which is the declare gate.
 */
import { Types } from "mongoose";
import type { HomeworkFreeLineKind, MasterySubject } from "@scd/shared";
import { HOMEWORK_FREE_LINE_KINDS } from "@scd/shared";
import { MasteryPaper, type IMasteryPaper, type IMasteryPaperItem } from "../models/MasteryPaper";
import { MasteryResult } from "../models/MasteryResult";
import { MasteryOutcome } from "../models/MasteryOutcome";
import { MasteryExclusion } from "../models/MasteryExclusion";
import { MasteryEvidence } from "../models/MasteryEvidence";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { HomeworkItem, type IHomeworkItem, type IHomeworkFreeLine } from "../../trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../../trackers/models/HomeworkStudentRecord";
import { AssignmentStudentRecord } from "../../trackers/models/AssignmentStudentRecord";
import { AssignmentItem } from "../../trackers/models/AssignmentItem";
import { PrintRequest } from "../../printing/models/PrintRequest";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { RoutineSubstitution } from "../../routine/models/RoutineSubstitution";
import { Student } from "../../foundation/models/Student";
import { resolveSubjectTeacher } from "../../trackers/subjectTeacher";
import { writeAudit } from "../../platform/services/AuditService";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { personName } from "../../../lib/personName";
import { isLoop2027On, recordUsesSafe, usesOfPaper, withdrawUsesSafe, withdrawUses } from "../../assessment/services/QuestionUseService";
import { getPolicy, isMasteryEnabled } from "./MasteryCatalogueService";
import { loCodesOf, questionTypeCodeOf } from "../bank";
import { heldRefusal } from "../examHold";
import { assertPicksAllowed } from "./HomeworkPickRules";
import { groupStimulusParts, printPlan, stimulusRefOf } from "../parts";
import { reapplyExclusions } from "../exclusions";
import { childTotals, isTrackerLinked, resultFromPct, roundHalf } from "../paperLink";
import { MasteryWorkError, isSameOrEarlierClass, loadPaperFor, nextPaperId, sectionContext, studentItemsOf, type Auth } from "./MasteryWorkService";
import { dateOnlyISO } from "../../trackers/assignmentCalendar";

const oid = (s: string | Types.ObjectId) => new Types.ObjectId(String(s));
const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const isHalf = (n: number) => Number.isFinite(n) && n > 0 && Math.round(n * 2) === n * 2;

/** Shown when a locked paper's items would change (§3.1 guard 4). */
export const PAPER_LOCKED_MESSAGE =
  "এই বাড়ির কাজের প্রশ্ন প্রিন্টে পাঠানো বা শিক্ষার্থীদের দেওয়া হয়ে গেছে — প্রশ্ন বদলাতে হলে আগে প্রিন্টের অনুরোধ বাতিল করুন।";
export const PRINT_STILL_LIVE_MESSAGE = "এই কাজের প্রিন্টের অনুরোধ এখনো চালু আছে — আগে সেটি বাতিল করুন।";

// ---------------------------------------------------------------------------
// R26 — the time of a homework
// ---------------------------------------------------------------------------

/** Minutes of a homework: Σ marks × minutesPerMark for bank / teacher items + each free line's own estimate (R26, §4.7). */
export function homeworkMinutes(marks: number[], freeLines: { estMinutes: number }[], minutesPerMark: number): number {
  const m = marks.reduce((s, x) => s + x, 0) * minutesPerMark + freeLines.reduce((s, l) => s + l.estMinutes, 0);
  return Math.round(m);
}

export async function minutesPerMarkOf(): Promise<number> {
  const v = Number((await getPolicy(null, null)).resolved.minutesPerMark);
  return Number.isFinite(v) && v > 0 ? v : 1.8;
}

// ---------------------------------------------------------------------------
// Free lines + teacher items (declare inputs)
// ---------------------------------------------------------------------------

export interface FreeLineInput {
  kind: string;
  textBn: string;
  estMinutes: number;
}
export interface TeacherItemInput {
  textBn: string;
  marks: number;
}

/** Validate the free lines a teacher typed (R22): a known kind, a sentence, a whole number of minutes ≥ 0. */
export function normalizeFreeLines(input: FreeLineInput[] | null | undefined): IHomeworkFreeLine[] {
  const out: IHomeworkFreeLine[] = [];
  for (const l of input ?? []) {
    if (!(HOMEWORK_FREE_LINE_KINDS as readonly string[]).includes(l.kind)) throw new MasteryWorkError("অচেনা কাজের ধরন।");
    const textBn = (l.textBn ?? "").trim();
    if (!textBn) throw new MasteryWorkError("কাজের লাইনের লেখা দিন।");
    if (!Number.isInteger(l.estMinutes) || l.estMinutes < 0 || l.estMinutes > 240) throw new MasteryWorkError("মিনিট ০ থেকে ২৪০-এর মধ্যে পূর্ণ সংখ্যা দিন।");
    out.push({ kind: l.kind as HomeworkFreeLineKind, textBn, estMinutes: l.estMinutes });
  }
  return out;
}

function normalizeTeacherItems(input: TeacherItemInput[] | null | undefined): TeacherItemInput[] {
  return (input ?? []).map((t) => {
    const textBn = (t.textBn ?? "").trim();
    if (!textBn) throw new MasteryWorkError("নিজের প্রশ্নের লেখা দিন।");
    if (!isHalf(t.marks)) throw new MasteryWorkError("নম্বর ০.৫-এর ধাপে, ০-র বেশি দিন।");
    return { textBn, marks: t.marks };
  });
}

// ---------------------------------------------------------------------------
// Declare / edit → the paper
// ---------------------------------------------------------------------------

async function pickedItems(
  item: IHomeworkItem,
  qids: string[],
  teacher: TeacherItemInput[],
  enabled: boolean,
  ctx: Awaited<ReturnType<typeof sectionContext>>,
  onSheet: ReadonlySet<string>,
): Promise<IMasteryPaperItem[]> {
  const classToken = ctx.classToken;
  const built: Omit<IMasteryPaperItem, "itemNo">[] = [];
  const objectiveOf = new Map<string, string>();
  const arts = qids.length
    ? await ContentArtifact.find({ docType: "question", current: true, retiredAt: null, reviewStatus: "gold", "envelopeJson.payload.qid": { $in: qids } }).lean()
    : [];
  const byQid = new Map(arts.map((a) => [String((a.envelopeJson as Record<string, unknown>).payload && ((a.envelopeJson as Record<string, unknown>).payload as Record<string, unknown>).qid), a]));
  // Outcome codes usable for evidence: LOCKED, this subject, this class or an earlier one (D-#1314).
  const allCodes = new Set<string>();
  const loOf = new Map<string, string[]>();
  if (enabled) {
    for (const qid of qids) {
      const a = byQid.get(qid);
      if (!a) continue;
      const env = a.envelopeJson as Record<string, unknown>;
      const los = loCodesOf(env.tags as Record<string, unknown>, env.payload as Record<string, unknown>);
      loOf.set(qid, los);
      los.forEach((c) => allCodes.add(c));
    }
  }
  const outcomes = allCodes.size ? await MasteryOutcome.find({ code: { $in: [...allCodes] } }).lean() : [];
  const usable = new Map(
    outcomes.filter((o) => o.status === "LOCKED" && o.subject === item.subject && isSameOrEarlierClass(o.classToken, classToken)).map((o) => [o.code, o]),
  );
  for (const qid of qids) {
    const art = byQid.get(qid);
    if (!art) throw new MasteryWorkError(`প্রশ্ন ${qid} গোল্ড ব্যাংকে পাওয়া যায়নি।`);
    if (art.subject !== item.subject) throw new MasteryWorkError(`প্রশ্ন ${qid} এই বিষয়ের নয়।`);
    if (typeof art.classLevel === "number" && art.classLevel > item.classLevel) throw new MasteryWorkError(`প্রশ্ন ${qid} পরের শ্রেণির।`);
    const payload = ((art.envelopeJson as Record<string, unknown>).payload ?? {}) as Record<string, unknown>;
    if (art.examPoolAt || stimulusRefOf(payload)) {
      const why = await heldRefusal([String(art._id)]);
      if (why) throw new MasteryWorkError(why);
    }
    const marks = typeof payload.marks === "number" && payload.marks > 0 ? payload.marks : 1;
    const codes = (loOf.get(qid) ?? []).filter((c) => usable.has(c));
    if (codes[0]) objectiveOf.set(qid, codes[0]);
    const stim = stimulusRefOf(payload);
    built.push({
      origin: "BANK",
      artifactId: art._id as Types.ObjectId,
      qid,
      loCodes: enabled ? codes : [],
      chapterNumber: enabled && codes[0] ? (usable.get(codes[0])!.chapterNumber ?? null) : null,
      questionTypeCode: enabled ? (questionTypeCodeOf(payload) ?? "") : "",
      marks,
      ...(stim ? { stimulusRef: stim } : {}),
    });
  }
  // The draft's own exclusions apply to a hand pick too (§4.3, §4.7, R21, R23): only what this save ADDS is checked.
  await assertPicksAllowed(ctx, item.subject as MasterySubject, dhakaDayKey(item.dateGiven), qids.filter((q) => !onSheet.has(q)), objectiveOf);
  for (const t of teacher) {
    built.push({ origin: "TEACHER", textBn: t.textBn, loCodes: [], chapterNumber: null, questionTypeCode: "", marks: t.marks });
  }
  const grouped = groupStimulusParts(built);
  const labels = printPlan(grouped).map((l) => l.partLabel);
  return grouped.map((x, i) => ({ ...x, itemNo: i + 1, ...(labels[i] ? { partLabel: labels[i]! } : {}) }));
}

const sameItems = (a: IMasteryPaperItem[], b: IMasteryPaperItem[]) =>
  a.length === b.length && a.every((x, i) => x.qid === b[i]!.qid && (x.textBn ?? "") === (b[i]!.textBn ?? "") && x.marks === b[i]!.marks);

async function hasLivePrint(paperId: Types.ObjectId): Promise<boolean> {
  return Boolean(await PrintRequest.exists({ masteryPaperId: paperId, status: { $ne: "CANCELLED" } }));
}

/**
 * Declare / edit (switch ON): make, replace or drop the item's paper from its picked qids and teacher items, and set
 * the item's time (R26). Returns nothing; the item doc is mutated and saved here. Free lines only → no paper.
 * Refuses a change to a locked paper (§3.1 guard 4) and a replace once results have been typed.
 */
export async function syncPaperForItem(
  item: IHomeworkItem,
  opts: { teacherItems?: TeacherItemInput[] | null; freeLines?: FreeLineInput[] | null; actorId: string; touchedItems: boolean },
): Promise<void> {
  if (!(await isLoop2027On())) return;
  const ctx = await sectionContext(String(item.sectionId));
  const qids = [...new Set((item.selectedQids ?? []).filter(Boolean))];
  const existing = item.paperId ? await MasteryPaper.findById(item.paperId) : null;
  if (opts.freeLines !== undefined && opts.freeLines !== null) {
    item.freeLines = normalizeFreeLines(opts.freeLines);
  }
  // Teacher items: given → replace; omitted on an edit that only touches other fields → keep what the paper has.
  const teacher =
    opts.teacherItems !== undefined && opts.teacherItems !== null
      ? normalizeTeacherItems(opts.teacherItems)
      : existing
        ? existing.items.filter((i) => i.origin === "TEACHER").map((i) => ({ textBn: i.textBn ?? "", marks: i.marks }))
        : [];
  const wantsPaper = qids.length > 0 || teacher.length > 0;

  if (!wantsPaper) {
    if (existing) {
      if (!opts.touchedItems) return;
      await removePaper(existing, item);
    }
  } else if (opts.touchedItems || !existing) {
    const enabled = await isMasteryEnabled(ctx.academicYearId, ctx.classToken, item.subject);
    const items = await pickedItems(item, qids, teacher, enabled, ctx, new Set((existing?.items ?? []).map((i) => i.qid ?? "").filter(Boolean)));
    if (existing) {
      if (sameItems(existing.items, items) && Boolean(existing.marksOnly) === !enabled) {
        /* unchanged */
      } else {
        if (existing.lockedAt) throw new MasteryWorkError(PAPER_LOCKED_MESSAGE);
        if (await MasteryResult.exists({ paperId: existing._id })) throw new MasteryWorkError("নম্বর তোলা শুরু হয়েছে — প্রশ্ন বদলানো যায় না।");
        existing.items = items as never;
        existing.marksOnly = !enabled;
        await existing.save();
      }
    } else {
      const paper = await MasteryPaper.create({
        paperId: await nextPaperId(ctx.classToken, item.subject),
        source: "HW",
        extra: false,
        trackerLinked: true,
        marksOnly: !enabled,
        sectionId: ctx.sectionId,
        classId: ctx.classId,
        academicYearId: ctx.academicYearId,
        classToken: ctx.classToken,
        subject: item.subject,
        date: new Date(`${dhakaDayKey(item.dateGiven)}T00:00:00.000Z`),
        links: { hwItemId: item._id },
        items,
        entryState: "OPEN",
        createdBy: Types.ObjectId.isValid(opts.actorId) ? oid(opts.actorId) : undefined,
      });
      item.paperId = paper._id as Types.ObjectId;
      void writeAudit({
        eventKind: "MASTERY_PAPER_CREATED",
        actorId: opts.actorId,
        targetKind: "MasteryPaper",
        targetId: paper._id,
        meta: { paperId: paper.paperId, source: "HW", items: items.length, marksOnly: !enabled, viaDeclare: true, hwId: item.hwId },
      });
    }
  }

  // R26: the item's time and count follow the paper + the free lines (only when this call changed them).
  const paper = item.paperId ? await MasteryPaper.findById(item.paperId).select("items").lean() : null;
  const lines = item.freeLines ?? [];
  if ((opts.touchedItems || (opts.freeLines !== undefined && opts.freeLines !== null)) && (paper || lines.length > 0)) {
    item.timeDecl = homeworkMinutes((paper?.items ?? []).map((i) => i.marks), lines, await minutesPerMarkOf());
    item.qCount = (paper?.items.length ?? 0) + lines.length;
  }
  await item.save();
}

async function removePaper(paper: IMasteryPaper, item: IHomeworkItem | null): Promise<void> {
  if (await hasLivePrint(paper._id)) throw new MasteryWorkError(PRINT_STILL_LIVE_MESSAGE);
  if (await MasteryResult.exists({ paperId: paper._id })) throw new MasteryWorkError("নম্বর তোলা শুরু হয়েছে — মুছে ফেলা যায় না।");
  if (paper.entryState === "CONFIRMED") throw new MasteryWorkError("নিশ্চিত করা কাজ মুছে ফেলা যায় না।");
  await MasteryPaper.deleteOne({ _id: paper._id, entryState: "OPEN" });
  await withdrawUses("MASTERY_PAPER", paper._id);
  if (item) item.paperId = undefined;
  await HomeworkItem.updateOne({ paperId: paper._id }, { $unset: { paperId: "" } });
}

/** deleteAssignmentItem (a DRAFT, no records): an AL-4 AS paper goes with it, its ledger rows withdrawn (AC-B11). */
export async function removePaperOfAsItem(asItemId: Types.ObjectId | string): Promise<void> {
  const paper = await MasteryPaper.findOne({ "links.asItemId": oid(asItemId), trackerLinked: true });
  if (paper) await removePaper(paper, null);
}

/** deleteHomeworkItem / voidHomeworkItem: a declared item's paper goes with it (nothing was given; AC-B11). */
export async function removePaperOfItem(itemId: Types.ObjectId | string): Promise<void> {
  const paper = await MasteryPaper.findOne({ "links.hwItemId": oid(itemId), extra: { $ne: true } });
  if (paper) await removePaper(paper, null);
}

// ---------------------------------------------------------------------------
// Lock + the §3.2 ledger rows
// ---------------------------------------------------------------------------

/** Lock the paper (once) and write its ledger rows; idempotent. Rows are keyed on the paper, kind HW (AS: AS). */
export async function lockPaper(paper: IMasteryPaper, printRequestId?: Types.ObjectId | string | null): Promise<void> {
  const set: Record<string, unknown> = {};
  if (!paper.lockedAt) set.lockedAt = new Date();
  if (printRequestId && !paper.printRequestId) set.printRequestId = oid(printRequestId);
  if (Object.keys(set).length > 0) await MasteryPaper.updateOne({ _id: paper._id }, { $set: set });
  const kind = paper.source === "AS" ? "AS" : "HW";
  await recordUsesSafe(usesOfPaper(paper, kind, { givenOn: dhakaDayKey(paper.date), wholeIfAll: kind === "AS" }));
}

/**
 * issueHomeworkItem hook: an item with a linked paper locks it and writes its rows. Returns the qids the PAPER carries
 * (the item's own HOMEWORK_ITEM rows are skipped for those: no double counting), or null when there is no paper.
 */
export async function onHomeworkIssued(item: Pick<IHomeworkItem, "paperId">): Promise<Set<string> | null> {
  if (!item.paperId) return null;
  const paper = await MasteryPaper.findById(item.paperId);
  if (!paper) return null;
  await lockPaper(paper);
  return new Set(paper.items.flatMap((i) => (i.qid ? [i.qid] : [])));
}

/** A MASTERY_PAPER print was cancelled before printing: unlock + withdraw, unless it was issued meanwhile or another print is live. */
export async function onPrintCancelled(paperId: Types.ObjectId | string, printRequestId: Types.ObjectId | string): Promise<void> {
  try {
    const paper = await MasteryPaper.findById(paperId);
    if (!paper) return;
    const live = await PrintRequest.exists({ masteryPaperId: paper._id, _id: { $ne: oid(printRequestId) }, status: { $ne: "CANCELLED" } });
    if (live) return;
    const item = paper.links?.hwItemId ? await HomeworkItem.findById(paper.links.hwItemId).select("status").lean() : null;
    if (item?.status === "issued") return; // the children have it — the issue keeps the lock and the rows
    // An AS item exists only once it was delivered: the children have the packet, so the lock and the rows stay.
    if (paper.links?.asItemId && (await AssignmentItem.exists({ _id: paper.links.asItemId }))) return;
    await MasteryPaper.updateOne({ _id: paper._id }, { $unset: { lockedAt: "", printRequestId: "" } });
    await withdrawUses("MASTERY_PAPER", paper._id);
  } catch (err) {
    console.error("[homework-paper] unlock on print cancel failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Void a CONFIRMED paper (AC-B11): exclude its evidence, withdraw its rows
// ---------------------------------------------------------------------------

export async function voidConfirmedPaper(paperId: string, auth: Auth, reason = "বাতিল"): Promise<{ excluded: number }> {
  // The 2027 void: switch on, an AL-4 tracker paper (HW / AS only), through the row scope.
  if (!(await isLoop2027On())) throw new MasteryWorkError("এই সুবিধা এখনো চালু হয়নি।");
  const paper = await loadPaperFor(paperId, auth);
  if (paper.extra || (paper.source !== "HW" && paper.source !== "AS") || !isTrackerLinked(paper)) {
    throw new MasteryWorkError("এই কাজটি এখান থেকে বাতিল করা যায় না।");
  }
  if (paper.entryState !== "CONFIRMED") throw new MasteryWorkError("নিশ্চিত না করা কাজ মুছে ফেলুন — বাতিলের দরকার নেই।");
  const now = new Date();
  const by = oid(auth.userId);
  let excluded = 0;
  for (const it of paper.items) {
    const dup = await MasteryExclusion.exists({ paperId: paper._id, itemNo: it.itemNo, scope: "ITEM", revokedAt: null });
    if (dup) continue;
    await MasteryExclusion.create({ sectionId: paper.sectionId, subject: paper.subject, scope: "ITEM", paperId: paper._id, itemNo: it.itemNo, reason, by, at: now });
    excluded += 1;
  }
  await reapplyExclusions(paper.sectionId, { paperId: paper._id });
  await withdrawUses("MASTERY_PAPER", paper._id, { at: now });
  // The child's total on the tracker is the paper's — it goes too (the record keeps its state).
  // Only what THIS paper's write-back wrote (provenance `marksPaperId`) — a teacher's own marks stay.
  if (paper.links?.hwItemId) await HomeworkStudentRecord.updateMany({ hwItemId: paper.links.hwItemId, marksPaperId: paper._id }, { $unset: { earnedMarks: "", availableMarks: "", marksPaperId: "" } });
  if (paper.links?.asItemId) await AssignmentStudentRecord.updateMany({ asItemId: paper.links.asItemId, marksPaperId: paper._id }, { $unset: { marks: "", availableMarks: "", marksPaperId: "" } });
  void writeAudit({
    eventKind: "MASTERY_PAPER_DELETED",
    actorId: auth.userId, actorRole: auth.role, targetKind: "MasteryPaper", targetId: paper._id,
    meta: { paperId, voided: true, reason, excludedItems: excluded },
  });
  return { excluded };
}

// ---------------------------------------------------------------------------
// AC-S1 — today's substitute
// ---------------------------------------------------------------------------

/**
 * True when `userId` is today's active `RoutineSubstitution` cover on a slot of this শাখা whose absent teacher is the
 * subject teacher of the শাখা × subject — the rule `MarkReminderService` uses for the due day (§7).
 */
export async function isTodaySubstituteFor(userId: string, sectionId: Types.ObjectId | string, subject: string, now: Date = new Date()): Promise<boolean> {
  if (!Types.ObjectId.isValid(userId)) return false;
  const today = dhakaDayKey(now);
  const DAY = 86_400_000;
  const subs = (
    await RoutineSubstitution.find({
      active: true,
      coverTeacherId: oid(userId),
      date: { $gte: new Date(now.getTime() - 3 * DAY), $lte: new Date(now.getTime() + 3 * DAY) },
    })
      .select("slotId date absentTeacherId")
      .lean()
  ).filter((s) => s.absentTeacherId && (dhakaDayKey(new Date(s.date)) === today || dateOnlyISO(new Date(s.date)).slice(0, 10) === today));
  if (subs.length === 0) return false;
  const slots = await RoutineSlot.find({ _id: { $in: subs.map((s) => s.slotId) }, groupType: "section", groupId: oid(sectionId) }).select("_id").lean();
  const onSection = new Set(slots.map((s) => String(s._id)));
  const absent = subs.filter((s) => onSection.has(String(s.slotId))).map((s) => String(s.absentTeacherId));
  if (absent.length === 0) return false;
  const teacher = await resolveSubjectTeacher(String(sectionId), subject, now);
  return Boolean(teacher && absent.includes(teacher));
}

// ---------------------------------------------------------------------------
// Confirm guards + write-back (§3.1)
// ---------------------------------------------------------------------------

type TrackerRec = { _id: Types.ObjectId; studentId: Types.ObjectId; state: string };

async function originalRecords(paper: IMasteryPaper): Promise<TrackerRec[]> {
  if (paper.links?.hwItemId) return (await HomeworkStudentRecord.find({ hwItemId: paper.links.hwItemId, resubOf: null }).select("studentId state").lean()) as unknown as TrackerRec[];
  if (paper.links?.asItemId) return (await AssignmentStudentRecord.find({ asItemId: paper.links.asItemId, resubOf: null }).select("studentId state").lean()) as unknown as TrackerRec[];
  return [];
}

/** §3.1 guard 1: refuse confirm while any original roster record is GIVEN or DUE; the message names the children. */
export async function assertRecordsAccountedFor(paper: IMasteryPaper): Promise<void> {
  const open = (await originalRecords(paper)).filter((r) => r.state === "GIVEN" || r.state === "DUE");
  if (open.length === 0) return;
  const kids = await Student.find({ _id: { $in: open.map((r) => r.studentId) } }).select("name nameBn schoolId").lean(); // bounded: one section
  const names = kids.map((k) => personName(k) || String(k.schoolId ?? "")).filter(Boolean).sort();
  throw new MasteryWorkError(`আগে জমা নেওয়ার হিসাব শেষ করুন: ${names.join(", ")} (${bn(open.length)} জন)`);
}

/** §3.1 guard 2: a roster child with no tracker record is left off the paper (no result row, no evidence, never full marks). */
export async function onPaperStudents(paper: IMasteryPaper, rosterIds: string[]): Promise<string[]> {
  const have = new Set((await originalRecords(paper)).map((r) => String(r.studentId)));
  const given = studentItemsOf(paper);
  return rosterIds.filter((id) => have.has(id) && (!given || given.has(id)));
}

/**
 * Write the children's totals back to their tracker records (§3.1 cache): earned / available (HW:
 * `earnedMarks` / `availableMarks`; AS: `marks` / `availableMarks` on the child's own items, ½ marks), every
 * SUBMITTED record → CHECKED, and the internal `result` from the policy thresholds. Writes the records DIRECTLY —
 * never through `checkRecord`, so a derived WRONG does NOT spawn a resubmission (D-#43's spawn is the manual tick's).
 * A child who resolves to ABSENT / NOT_SUBMITTED / VOID has no total: their cache is cleared, the state untouched.
 */
export async function writeBackTrackers(paper: IMasteryPaper, studentIds: string[], actorId: string, now: Date = new Date()): Promise<number> {
  if (studentIds.length === 0) return 0;
  const policy = (await getPolicy(paper.classToken, paper.subject)).resolved;
  const results = await MasteryResult.find({ paperId: paper._id, studentId: { $in: studentIds.map(oid) } }).lean();
  const byStudent = new Map(results.map((r) => [String(r.studentId), r]));
  const recs = await originalRecords(paper);
  const defaults = new Map(recs.map((r) => [String(r.studentId), r.state === "ABSENT_REDELIVER" ? "ABSENT" : r.state === "CHASE" || r.state === "GIVEN" || r.state === "DUE" ? "NOT_SUBMITTED" : "PRESENT"]));
  const given = studentItemsOf(paper);
  const by = Types.ObjectId.isValid(actorId) ? oid(actorId) : undefined;
  let written = 0;
  for (const sid of studentIds) {
    const r = byStudent.get(sid);
    const status = r?.status ?? defaults.get(sid) ?? "PRESENT";
    const own = recs.filter((x) => String(x.studentId) === sid);
    if (own.length === 0) continue;
    const Model = paper.links?.hwItemId ? HomeworkStudentRecord : AssignmentStudentRecord;
    const idFilter = { _id: { $in: own.map((x) => x._id) } };
    if (status !== "PRESENT") {
      // Clear only what this paper wrote (provenance), never a teacher's own figure.
      await (Model as typeof HomeworkStudentRecord).updateMany(
        { ...idFilter, marksPaperId: paper._id },
        { $unset: paper.links?.hwItemId ? { earnedMarks: "", availableMarks: "", marksPaperId: "" } : { marks: "", availableMarks: "", marksPaperId: "" } },
      );
      continue;
    }
    const earnedBy = new Map<number, number | undefined>((r?.items ?? []).map((i) => [i.itemNo, i.marks ?? undefined]));
    const { earned, available } = childTotals(paper.items, earnedBy, given?.get(sid));
    const result = resultFromPct(earned, available, Number(policy.masteredAtPct), Number(policy.weakBelowPct));
    const docs = paper.links?.hwItemId ? await HomeworkStudentRecord.find(idFilter) : await AssignmentStudentRecord.find(idFilter);
    for (const d of docs) {
      if (paper.links?.hwItemId) {
        const h = d as InstanceType<typeof HomeworkStudentRecord>;
        h.earnedMarks = earned;
        h.availableMarks = available;
        h.marksPaperId = paper._id as Types.ObjectId;
      } else {
        const a = d as InstanceType<typeof AssignmentStudentRecord>;
        a.marks = earned;
        a.availableMarks = available;
        a.marksPaperId = paper._id as Types.ObjectId;
      }
      if (result) d.result = result;
      if (d.state === "SUBMITTED") {
        d.state = "CHECKED";
        d.stateDates.push({ state: "CHECKED", at: now, ...(by ? { by } : {}) } as never);
      }
      await d.save();
      written += 1;
    }
  }
  return written;
}

/** Evidence rows of a paper (test seam / the void check). */
export async function liveEvidenceCount(paperId: Types.ObjectId): Promise<number> {
  return MasteryEvidence.countDocuments({ paperId, supersededAt: null });
}

export { isTrackerLinked, roundHalf };

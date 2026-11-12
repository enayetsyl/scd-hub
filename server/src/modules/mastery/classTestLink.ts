/**
 * PR-C (docs/prd-mastery-class-test-link.md, D-#1317–#1320) — a class test and its question sheet are
 * one entry. A CT-source MasteryPaper may name ONE section-anchored class test (`links.classTestId`);
 * the sheet then owns that test's per-student total:
 *
 *   - `ctOutcomeOf`            — pure: a student's sheet row → the class-test status + total.
 *   - `lockedChangeMessage`    — a change that would alter a SUBMITTED / PUBLISHED result is refused
 *                                with the class-test's own "recall / unpublish first" message.
 *   - `syncClassTestResults`   — writes each changed student's total through `enterResult`, keeping
 *                                the comments and the AI-check stamp already on the result.
 *   - `classTestEntryGuard`    — the class-test marks path: while a sheet is linked, a mark / status
 *                                that differs from the sheet's is refused (comments still save).
 *
 * This file imports the trackers service; the trackers resolver reaches it by a LAZY import, so the
 * two modules never import each other at load time.
 */
import { Types } from "mongoose";
import { MasteryPaper, type IMasteryPaper } from "./models/MasteryPaper";
import { MasteryResult, type MasteryResultStatus } from "./models/MasteryResult";
import { ClassTest, type IClassTest } from "../trackers/models/ClassTest";
import { ClassTestResult } from "../trackers/models/ClassTestResult";
import { enterResult } from "../trackers/services/ClassTestResultService";

/** The class-test side of one student's sheet row. */
export interface CtOutcome {
  status: "PRESENT" | "ABSENT";
  /** Total earned on the sheet (PRESENT only). */
  marks: number | null;
}

/** What one student's row looks like to the total (the stored row, or an incoming save). */
export interface SheetRowLike {
  status?: MasteryResultStatus | null;
  items?: { itemNo: number; marks?: number | null }[] | null;
}

/** ABSENT → ABSENT with no marks; anyone else → PRESENT with the total earned (full marks with no row). */
export function ctOutcomeOf(paper: Pick<IMasteryPaper, "items">, row: SheetRowLike | null | undefined): CtOutcome {
  if (row?.status === "ABSENT") return { status: "ABSENT", marks: null };
  let total = 0;
  for (const item of paper.items) {
    const m = row?.items?.find((x) => x.itemNo === item.itemNo)?.marks;
    total += m === null || m === undefined ? item.marks : Math.min(item.marks, Math.max(0, m));
  }
  return { status: "PRESENT", marks: Math.round(total * 100) / 100 };
}

const sameOutcome = (a: CtOutcome, b: { status?: string | null; marks?: number | null } | null | undefined): boolean =>
  Boolean(b) && a.status === b!.status && (a.status === "ABSENT" || Number(a.marks) === Number(b!.marks ?? NaN));

/** The class test a linked sheet names (null when the sheet has none). */
export async function linkedTestOf(paper: Pick<IMasteryPaper, "links">): Promise<IClassTest | null> {
  const id = paper.links?.classTestId;
  return id ? ((await ClassTest.findById(id).lean()) as IClassTest | null) : null;
}

/** The existing class-test result rows of these students, by studentId. */
async function currentRows(testId: Types.ObjectId, studentIds: string[]) {
  const rows = await ClassTestResult.find({ testId, studentId: { $in: studentIds.map((s) => new Types.ObjectId(s)) } })
    .select("studentId status marks submittedAt publishedAt weakness teacherAction guardianAction")
    .lean(); // bounded: one section's roster
  return new Map(rows.map((r) => [String(r.studentId), r]));
}

/**
 * Refuse a sheet change that would alter a student's class-test total or status while that student's
 * result is submitted for approval or published (the class-test's own messages). An unchanged
 * total/status is allowed — tag-only corrections go through.
 */
export async function lockedChangeMessage(testId: Types.ObjectId, next: Map<string, CtOutcome>): Promise<string | null> {
  const cur = await currentRows(testId, [...next.keys()]);
  for (const [sid, o] of next) {
    const r = cur.get(sid);
    if (!r || sameOutcome(o, r)) continue;
    if (r.publishedAt) return "This result is published — unpublish it before editing (guardians have already been notified)";
    if (r.submittedAt) return "This result is submitted for approval — recall it (or ask the office to send it back) before editing";
  }
  return null;
}

/**
 * Write each student's sheet total into the class test through `enterResult` (the class-test's own
 * path: printed, on/after the exam date, bounds). A student whose total and status already match is
 * left untouched. The comments already on a PRESENT result are passed back unchanged and no new AI
 * stamp is sent, so both stay; an ABSENT write clears comments as the class test always does.
 */
export async function syncClassTestResults(
  testId: Types.ObjectId,
  next: Map<string, CtOutcome>,
  actorId: string,
): Promise<number> {
  const cur = await currentRows(testId, [...next.keys()]);
  let written = 0;
  for (const [sid, o] of next) {
    const r = cur.get(sid);
    if (sameOutcome(o, r)) continue;
    await enterResult({
      testId: String(testId),
      studentId: sid,
      status: o.status,
      marks: o.status === "PRESENT" ? (o.marks ?? 0) : undefined,
      ...(o.status === "PRESENT"
        ? {
            weakness: r?.weakness ?? undefined,
            teacherAction: r?.teacherAction ?? undefined,
            guardianAction: r?.guardianAction ?? undefined,
          }
        : {}),
      actorId,
    });
    written += 1;
  }
  return written;
}

/** Every roster student's class-test outcome from the STORED sheet rows. */
export async function storedOutcomes(paper: IMasteryPaper, rosterIds: string[]): Promise<Map<string, CtOutcome>> {
  const rows = await MasteryResult.find({ paperId: paper._id }).select("studentId status items").lean();
  const by = new Map(rows.map((r) => [String(r.studentId), r]));
  return new Map(
    rosterIds.map((sid) => {
      const r = by.get(sid);
      return [sid, ctOutcomeOf(paper, r ? { status: r.status as MasteryResultStatus, items: r.items } : null)];
    }),
  );
}

/** The confirm-time check: the test must be printed and its exam date reached. Null = ready. */
export function testNotReadyMessage(test: IClassTest, now: Date = new Date()): string | null {
  if (test.status !== "PRINTED") return "ক্লাস টেস্টটি এখনো ছাপা হয়নি — ছাপা হওয়ার পর শিট নিশ্চিত করুন।";
  // The class test's own rule (J3): the exam day itself counts (date-only comparison).
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (day(now) < day(new Date(test.examDate))) return "পরীক্ষার তারিখ এখনো আসেনি — সেদিন বা পরে শিট নিশ্চিত করুন।";
  return null;
}

/**
 * The class-test marks path while a sheet is linked: before the sheet is confirmed nothing can be
 * typed; after, a mark or status that differs from what the sheet wrote is refused. Saving the three
 * comments with the same mark is allowed. Null = no sheet, or allowed.
 */
export async function classTestEntryGuard(
  testId: string,
  studentId: string,
  status: string,
  marks: number | null | undefined,
): Promise<string | null> {
  if (!Types.ObjectId.isValid(testId) || !Types.ObjectId.isValid(studentId)) return null;
  const paper = await MasteryPaper.findOne({ "links.classTestId": new Types.ObjectId(testId) }).select("entryState paperId").lean();
  if (!paper) return null;
  if (paper.entryState !== "CONFIRMED") return "আগে প্রশ্নভিত্তিক শিট নিশ্চিত করুন — এই ক্লাস টেস্টের নম্বর শিট থেকে আসে।";
  const r = await ClassTestResult.findOne({ testId: new Types.ObjectId(testId), studentId: new Types.ObjectId(studentId) })
    .select("status marks")
    .lean();
  const same =
    r &&
    r.status === status &&
    (status === "ABSENT" || (marks !== null && marks !== undefined && Number(r.marks) === Number(marks)));
  return same ? null : `এই ক্লাস টেস্টের নম্বর ও উপস্থিতি প্রশ্নভিত্তিক শিট (${paper.paperId}) থেকে আসে — শিটে বদলান; এখানে শুধু মন্তব্য লেখা যায়।`;
}

/** Students whose class-test mark differs from the sheet total (recheck / hold / correction flows). */
export async function classTestMismatches(
  paper: IMasteryPaper,
  rosterIds: string[],
): Promise<{ studentId: string; sheetStatus: string; sheetMarks: number | null; classTestStatus: string | null; classTestMarks: number | null }[]> {
  if (!paper.links?.classTestId || paper.entryState !== "CONFIRMED") return [];
  const [want, cur] = await Promise.all([storedOutcomes(paper, rosterIds), currentRows(paper.links.classTestId, rosterIds)]);
  const out = [];
  for (const [sid, o] of want) {
    const r = cur.get(sid);
    if (sameOutcome(o, r)) continue;
    out.push({
      studentId: sid,
      sheetStatus: o.status,
      sheetMarks: o.marks,
      classTestStatus: (r?.status as string) ?? null,
      classTestMarks: r?.marks ?? null,
    });
  }
  return out;
}

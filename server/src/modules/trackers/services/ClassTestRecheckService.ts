/**
 * ClassTestRecheckService (CT-RC, docs/prd-ct-mark-recheck.md) — the unusual-mark
 * recheck around the CT-8 approval gate:
 *
 *   recheckRules / saveRecheckRules — the % thresholds (one singleton, read-time defaults).
 *   recheckView      — every flagged mark on a test, with the teacher's tick + the hold.
 *   confirmRecheck   — the teacher's "I checked the script again, the mark is right"
 *                      (one student, or the whole class for rule R4).
 *   submitBlockers   — what still needs a tick; submitExam refuses while any remain.
 *   approvalFlagCount — how many flagged marks the approver must confirm they reviewed.
 *
 * Flags are DERIVED on every read (D-#85) from the student's cumulative published
 * history this academic year; nothing about a flag is stored. Only the ticks and the
 * hold are stamps. The resolver enforces RBAC; this service trusts the actor.
 * Identity plane (studentIds, names); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { writeAudit } from "../../platform/services/AuditService";
import { ClassTest, type IClassTest } from "../models/ClassTest";
import { ClassTestResult, type IClassTestResult } from "../models/ClassTestResult";
import { ClassTestRecheckSettings, DEFAULT_CT_RECHECK_SETTINGS } from "../models/ClassTestRecheckSettings";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import {
  deriveClassFlag,
  deriveRowFlag,
  marksKeyOf,
  percentOf,
  rowTickValid,
  type AverageBasis,
  type MarkFlagKind,
  type RecheckRules,
  type StudentHistory,
} from "../classTestRecheck";
import { ClassTestResultError } from "./ClassTestResultService";
import { bnNum } from "../../../lib/bnNum";

// ---------------------------------------------------------------------------
// Rules (the configurable % range)
// ---------------------------------------------------------------------------

export type RecheckRulesShape = RecheckRules & { isDefault: boolean };

const BOUNDS: Record<Exclude<keyof RecheckRules, "enabled">, [number, number]> = {
  highPct: [5, 100],
  lowPct: [5, 100],
  fullMarksBelowPct: [0, 100],
  classHighPct: [5, 100],
  minPriorTests: [1, 20],
};

export async function recheckRules(): Promise<RecheckRulesShape> {
  const row = (await ClassTestRecheckSettings.findOne({ key: "singleton" }).lean()) as Record<string, unknown> | null;
  const out: RecheckRules = { ...DEFAULT_CT_RECHECK_SETTINGS };
  if (row) {
    for (const k of Object.keys(DEFAULT_CT_RECHECK_SETTINGS) as (keyof RecheckRules)[]) {
      const v = row[k];
      if (v !== undefined && v !== null) (out as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return { ...out, isDefault: !row };
}

export async function saveRecheckRules(
  patch: Partial<Record<keyof RecheckRules, number | boolean | null | undefined>>,
  actorId: string,
): Promise<RecheckRulesShape> {
  const set: Record<string, unknown> = { updatedBy: new Types.ObjectId(actorId) };
  for (const [k, [lo, hi]] of Object.entries(BOUNDS)) {
    const v = patch[k as keyof RecheckRules];
    if (v === undefined || v === null) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) {
      throw new ClassTestResultError(`মান ${bnNum(lo)} থেকে ${bnNum(hi)} এর মধ্যে পূর্ণ সংখ্যা দিন`);
    }
    set[k] = v;
  }
  if (typeof patch.enabled === "boolean") set.enabled = patch.enabled;
  const before = await recheckRules();
  await ClassTestRecheckSettings.updateOne({ key: "singleton" }, { $set: set }, { upsert: true });
  const after = await recheckRules();
  await writeAudit({
    eventKind: "CLASS_TEST_RECHECK_RULES_CHANGED",
    actorId,
    targetKind: "ClassTestRecheckSettings",
    meta: { before: { ...before, isDefault: undefined }, after: { ...after, isDefault: undefined } },
  });
  return after;
}

// ---------------------------------------------------------------------------
// History (cumulative, this academic year, published + present only)
// ---------------------------------------------------------------------------

type TestLite = Pick<IClassTest, "_id" | "subject" | "totalMarks" | "academicYearId" | "sectionId" | "subjectGroupId">;
type RowLite = Pick<IClassTestResult, "_id" | "studentId" | "status" | "marks" | "submittedAt" | "publishedAt" | "recheck" | "recheckHold" | "enteredBy" | "submittedBy">;

async function priorTests(test: TestLite): Promise<Map<string, TestLite>> {
  const tests = (await ClassTest.find({
    academicYearId: test.academicYearId,
    status: "PRINTED",
    _id: { $ne: test._id },
  })
    .select("_id subject totalMarks academicYearId sectionId subjectGroupId")
    .lean()) as unknown as TestLite[];
  return new Map(tests.map((t) => [t._id.toString(), t]));
}

async function historyFor(test: TestLite, studentIds: Types.ObjectId[], prior: Map<string, TestLite>): Promise<Map<string, StudentHistory>> {
  const out = new Map<string, StudentHistory>();
  for (const id of studentIds) out.set(id.toString(), { subjectPcts: [], allPcts: [] });
  if (studentIds.length === 0 || prior.size === 0) return out;
  const rows = (await ClassTestResult.find({
    studentId: { $in: studentIds },
    testId: { $in: [...prior.keys()].map((id) => new Types.ObjectId(id)) },
    status: "PRESENT",
    publishedAt: { $ne: null },
  })
    .select("studentId testId marks")
    .lean()) as unknown as Array<{ studentId: Types.ObjectId; testId: Types.ObjectId; marks?: number }>;
  for (const r of rows) {
    const t = prior.get(r.testId.toString());
    const h = out.get(r.studentId.toString());
    if (!t || !h || r.marks === undefined || r.marks === null || !t.totalMarks) continue;
    const pct = percentOf(r.marks, t.totalMarks);
    h.allPcts.push(pct);
    if (t.subject === test.subject) h.subjectPcts.push(pct);
  }
  return out;
}

/** The class's usual level in this subject: every published present mark on the
 *  earlier tests of the SAME unit (section or group) in the same subject. */
async function usualFor(test: TestLite, prior: Map<string, TestLite>): Promise<{ pcts: number[]; tests: number }> {
  const sameUnit = [...prior.values()].filter(
    (t) =>
      t.subject === test.subject &&
      ((test.sectionId && t.sectionId && t.sectionId.toString() === test.sectionId.toString()) ||
        (test.subjectGroupId && t.subjectGroupId && t.subjectGroupId.toString() === test.subjectGroupId.toString())),
  );
  if (sameUnit.length === 0) return { pcts: [], tests: 0 };
  const byId = new Map(sameUnit.map((t) => [t._id.toString(), t]));
  const rows = (await ClassTestResult.find({
    testId: { $in: sameUnit.map((t) => t._id) },
    status: "PRESENT",
    publishedAt: { $ne: null },
  })
    .select("testId marks")
    .lean()) as unknown as Array<{ testId: Types.ObjectId; marks?: number }>;
  const pcts: number[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const t = byId.get(r.testId.toString());
    if (!t || r.marks === undefined || r.marks === null || !t.totalMarks) continue;
    pcts.push(percentOf(r.marks, t.totalMarks));
    seen.add(r.testId.toString());
  }
  return { pcts, tests: seen.size };
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export interface RecheckRowView {
  studentId: string;
  studentName: string;
  marks: number;
  totalMarks: number;
  percent: number;
  averagePct: number | null;
  basis: AverageBasis;
  priorCount: number;
  kinds: MarkFlagKind[];
  confirmed: boolean;
  confirmedAt: string | null;
  confirmedByName: string | null;
  note: string | null;
  /** R4 is up and this mark is only high / full: the ONE class tick covers it (no own tick). */
  classCovers: boolean;
  submitted: boolean;
  published: boolean;
  held: boolean;
  heldAt: string | null;
}

export interface RecheckClassView {
  classPct: number;
  usualPct: number;
  usualTests: number;
  confirmed: boolean;
  confirmedAt: string | null;
  confirmedByName: string | null;
  note: string | null;
}

export interface RecheckView {
  testId: string;
  rules: RecheckRulesShape;
  rows: RecheckRowView[];
  classFlag: RecheckClassView | null;
  /** Flagged, still-unpublished marks with no valid tick (+1 for an unticked class flag). */
  unconfirmedCount: number;
  /** Flagged marks waiting for approval (submitted, unpublished) — what the approver reviews. */
  awaitingApprovalCount: number;
}

interface Computed {
  test: IClassTest;
  rules: RecheckRulesShape;
  rows: RowLite[];
  flags: Map<string, ReturnType<typeof deriveRowFlag>>;
  classFlag: ReturnType<typeof deriveClassFlag>;
  classTickValid: boolean;
}

async function compute(testId: string): Promise<Computed> {
  const test = (await ClassTest.findById(testId).lean()) as IClassTest | null;
  if (!test) throw new ClassTestResultError("Class test not found");
  const rules = await recheckRules();
  const rows = (await ClassTestResult.find({ testId: test._id })
    .select("_id studentId status marks submittedAt publishedAt recheck recheckHold enteredBy submittedBy")
    .lean()) as unknown as RowLite[];
  const flags = new Map<string, ReturnType<typeof deriveRowFlag>>();
  let classFlag: ReturnType<typeof deriveClassFlag> = null;
  if (rules.enabled && rows.length > 0) {
    const prior = await priorTests(test);
    const history = await historyFor(test, rows.map((r) => r.studentId), prior);
    for (const r of rows) {
      const f = deriveRowFlag(
        { studentId: r.studentId.toString(), status: r.status, marks: r.marks ?? null },
        test.totalMarks,
        history.get(r.studentId.toString()) ?? { subjectPcts: [], allPcts: [] },
        rules,
      );
      if (f) flags.set(r.studentId.toString(), f);
    }
    classFlag = deriveClassFlag(rows, test.totalMarks, await usualFor(test, prior), rules);
  }
  const key = marksKeyOf(rows.map((r) => ({ studentId: r.studentId.toString(), status: r.status, marks: r.marks ?? null })));
  const classTickValid = !!test.classRecheck && test.classRecheck.marksKey === key;
  return { test, rules, rows, flags, classFlag, classTickValid };
}

async function namesOf(ids: Types.ObjectId[], kind: "student" | "user"): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  if (kind === "student") {
    const docs = (await Student.find({ _id: { $in: ids } }).select("name nameBn").lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; nameBn?: string }>;
    return new Map(docs.map((d) => [d._id.toString(), d.nameBn || d.name]));
  }
  const docs = (await User.find({ _id: { $in: ids } }).select("name").lean()) as unknown as Array<{ _id: Types.ObjectId; name: string }>;
  return new Map(docs.map((d) => [d._id.toString(), d.name]));
}

/** Under a whole-class flag (R4) a mark that is only HIGH / FULL is the class's story, so the
 *  one class tick covers it; a LOW mark in an inflated class still needs its own look. */
function classCovers(c: Computed, r: RowLite): boolean {
  const f = c.flags.get(r.studentId.toString());
  return !!c.classFlag && !!f && f.kinds.every((k) => k !== "LOW");
}

function rowValid(c: Computed, r: RowLite): boolean {
  return rowTickValid(r) || (classCovers(c, r) && c.classTickValid);
}

function unpublishedUnconfirmed(c: Computed): RowLite[] {
  // A covered row is owed through the class tick (counted once by classOpen), not per child.
  return c.rows.filter((r) => !r.publishedAt && c.flags.has(r.studentId.toString()) && !rowValid(c, r) && !classCovers(c, r));
}

const classOpen = (c: Computed): boolean => !!c.classFlag && !c.classTickValid && c.rows.some((r) => !r.publishedAt);

export async function recheckView(testId: string): Promise<RecheckView> {
  const c = await compute(testId);
  const flaggedRows = c.rows.filter((r) => c.flags.has(r.studentId.toString()));
  const studentNames = await namesOf(flaggedRows.map((r) => r.studentId), "student");
  const userIds = flaggedRows.filter((r) => r.recheck).map((r) => r.recheck!.confirmedBy);
  if (c.test.classRecheck) userIds.push(c.test.classRecheck.confirmedBy);
  const userNames = await namesOf(userIds, "user");

  const rows: RecheckRowView[] = flaggedRows.map((r) => {
    const f = c.flags.get(r.studentId.toString())!;
    const own = rowTickValid(r);
    const viaClass = !own && classCovers(c, r) && c.classTickValid;
    const valid = own || viaClass;
    const cr0 = c.test.classRecheck;
    return {
      studentId: r.studentId.toString(),
      studentName: studentNames.get(r.studentId.toString()) ?? "শিক্ষার্থী",
      marks: r.marks ?? 0,
      totalMarks: c.test.totalMarks,
      percent: f.percent,
      averagePct: f.averagePct,
      basis: f.basis,
      priorCount: f.priorCount,
      kinds: f.kinds,
      confirmed: valid,
      confirmedAt: own ? new Date(r.recheck!.confirmedAt).toISOString() : viaClass && cr0 ? new Date(cr0.confirmedAt).toISOString() : null,
      confirmedByName: own
        ? userNames.get(r.recheck!.confirmedBy.toString()) ?? null
        : viaClass && cr0
          ? userNames.get(cr0.confirmedBy.toString()) ?? null
          : null,
      note: own ? r.recheck!.note ?? null : viaClass && cr0 ? cr0.note ?? null : null,
      classCovers: classCovers(c, r),
      submitted: !!r.submittedAt,
      published: !!r.publishedAt,
      held: !!r.recheckHold,
      heldAt: r.recheckHold ? new Date(r.recheckHold.at).toISOString() : null,
    };
  });
  // Unconfirmed first (what still needs doing), then by name.
  rows.sort((a, b) => Number(a.confirmed) - Number(b.confirmed) || a.studentName.localeCompare(b.studentName));

  const cr = c.test.classRecheck;
  const classFlag: RecheckClassView | null = c.classFlag
    ? {
        ...c.classFlag,
        confirmed: c.classTickValid,
        confirmedAt: c.classTickValid && cr ? new Date(cr.confirmedAt).toISOString() : null,
        confirmedByName: c.classTickValid && cr ? userNames.get(cr.confirmedBy.toString()) ?? null : null,
        note: c.classTickValid && cr ? cr.note ?? null : null,
      }
    : null;

  return {
    testId,
    rules: c.rules,
    rows,
    classFlag,
    unconfirmedCount: unpublishedUnconfirmed(c).length + (classOpen(c) ? 1 : 0),
    awaitingApprovalCount: approvalCountOf(c),
  };
}

// ---------------------------------------------------------------------------
// The teacher's tick
// ---------------------------------------------------------------------------

export interface ConfirmRecheckInput {
  testId: string;
  /** Null = the whole-class tick (rule R4). */
  studentId?: string | null;
  confirmed: boolean;
  note?: string | null;
  actorId: string;
}

export async function confirmRecheck(input: ConfirmRecheckInput): Promise<RecheckView> {
  const test = (await ClassTest.findById(input.testId).select("_id ctId").lean()) as Pick<IClassTest, "_id" | "ctId"> | null;
  if (!test) throw new ClassTestResultError("Class test not found");
  const note = input.note?.trim() ? input.note.trim().slice(0, 300) : null;
  const actor = new Types.ObjectId(input.actorId);

  if (input.studentId) {
    const row = (await ClassTestResult.findOne({ testId: test._id, studentId: new Types.ObjectId(input.studentId) })
      .select("_id status marks submittedAt publishedAt sendBackAt")
      .lean()) as (RowLite & { sendBackAt?: Date | null }) | null;
    if (!row) throw new ClassTestResultError("এই শিক্ষার্থীর নম্বর এখনো লেখা হয়নি");
    if (row.publishedAt) throw new ClassTestResultError("ফল প্রকাশিত হয়ে গেছে — এখন আর নিশ্চিত করা যাবে না");
    if (row.submittedAt) throw new ClassTestResultError("ফল জমা দেওয়া হয়েছে — বদলাতে আগে ফিরিয়ে নিন");
    if (row.status !== "PRESENT" || row.marks === undefined || row.marks === null) {
      throw new ClassTestResultError("অনুপস্থিত শিক্ষার্থীর নম্বর নিশ্চিত করার কিছু নেই");
    }
    await ClassTestResult.updateOne(
      { _id: row._id },
      input.confirmed
        ? { $set: { recheck: { marks: row.marks, confirmedBy: actor, confirmedAt: new Date(), note } } }
        : { $set: { recheck: null } },
    );
    await writeAudit({
      eventKind: "CLASS_TEST_RECHECK_CONFIRMED",
      actorId: input.actorId,
      targetId: row._id,
      targetKind: "ClassTestResult",
      meta: { ctId: test.ctId, testId: input.testId, studentId: input.studentId, marks: row.marks, confirmed: input.confirmed, note },
    });
  } else {
    const rows = (await ClassTestResult.find({ testId: test._id }).select("studentId status marks publishedAt submittedAt").lean()) as unknown as RowLite[];
    if (rows.length === 0) throw new ClassTestResultError("এখনো কোনো নম্বর লেখা হয়নি");
    if (rows.every((r) => r.publishedAt || r.submittedAt)) {
      throw new ClassTestResultError("ফল জমা দেওয়া হয়েছে — বদলাতে আগে ফিরিয়ে নিন");
    }
    const marksKey = marksKeyOf(rows.map((r) => ({ studentId: r.studentId.toString(), status: r.status, marks: r.marks ?? null })));
    await ClassTest.updateOne(
      { _id: test._id },
      input.confirmed
        ? { $set: { classRecheck: { marksKey, confirmedBy: actor, confirmedAt: new Date(), note } } }
        : { $set: { classRecheck: null } },
    );
    await writeAudit({
      eventKind: "CLASS_TEST_RECHECK_CONFIRMED",
      actorId: input.actorId,
      targetId: test._id,
      targetKind: "ClassTest",
      meta: { ctId: test.ctId, testId: input.testId, wholeClass: true, confirmed: input.confirmed, note },
    });
  }
  return recheckView(input.testId);
}

// ---------------------------------------------------------------------------
// Gates used by the CT-8 submit / approve
// ---------------------------------------------------------------------------

/** Throws the Bangla refusal submitExam shows while any flagged mark is unticked. */
export async function assertNoSubmitBlockers(testId: string): Promise<void> {
  const c = await compute(testId);
  if (!c.rules.enabled) return;
  const open = unpublishedUnconfirmed(c);
  const parts: string[] = [];
  if (open.length > 0) {
    const names = await namesOf(open.map((r) => r.studentId), "student");
    const list = open.map((r) => names.get(r.studentId.toString()) ?? "শিক্ষার্থী").join(", ");
    parts.push(`${bnNum(open.length)} জনের অস্বাভাবিক নম্বর এখনো নিশ্চিত করা হয়নি: ${list}`);
  }
  if (classOpen(c)) parts.push("পুরো শ্রেণির নম্বর অস্বাভাবিক বেশি — সব খাতা আবার দেখে নিশ্চিত করুন");
  if (parts.length > 0) throw new ClassTestResultError(`${parts.join("। ")}। খাতা আবার দেখে টিক দিন, তারপর জমা দিন।`);
}

function approvalCountOf(c: Computed): number {
  const waiting = c.rows.filter((r) => r.submittedAt && !r.publishedAt);
  const rowCount = waiting.filter((r) => c.flags.has(r.studentId.toString())).length;
  return rowCount + (c.classFlag && waiting.length > 0 ? 1 : 0);
}

/** How many flagged marks (+1 for the class flag) sit in the submission awaiting approval. */
export async function approvalFlagCount(testId: string): Promise<number> {
  const c = await compute(testId);
  return c.rules.enabled ? approvalCountOf(c) : 0;
}

/** Flagged marks in the current submission — for the approvers' "submitted" notice. */
export async function submittedFlagCount(testId: string): Promise<number> {
  return approvalFlagCount(testId);
}

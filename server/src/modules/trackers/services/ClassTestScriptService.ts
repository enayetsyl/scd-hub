/**
 * ClassTestScriptService (CS-1..CS-3, docs/prd-ct-scripts.md, D-#715–#719) — the
 * paper's journey after a class test's results are out:
 *
 *   results published ─▶ DUE/OVERDUE (teacher hands the scripts to the Office)
 *     ─▶ receive ─▶ UPLOAD_PENDING / UPLOAD_IN_PROGRESS / UPLOAD_DONE (Office scans + tags)
 *     ─▶ publish ─▶ PUBLISHED (guardians can open their own child's script)
 *     ─▶ hand back ─▶ WITH_TEACHER / RETURN_OVERDUE (teacher returns it in class)
 *     ─▶ returned ─▶ RETURNED.                 waive (any stage before PUBLISHED) ─▶ WAIVED
 *
 * The stage is a THIRD axis beside entry state and publish state (D-#370) and is
 * DERIVED on every read (D-#85) from the `ClassTest.scripts` stamps plus the per-result
 * script fields — so the teacher's Today reminder disappears by itself the moment the
 * Office receives the paper. Overdue is STRICTLY after the due day (D-#715).
 *
 * The resolver enforces RBAC (roster:manage for the Office side; the accountable
 * teacher or roster:manage for "returned"); this service trusts the actor. Every
 * transition writes one audit row (ADR-008). Identity plane (studentIds, scans of
 * named papers); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import {
  CT_SCRIPT_DUE_SCHOOL_DAYS,
  HW_SUBJECT_LABELS_BN,
  ROSTER_CLASS_LABELS_BN,
  type CtScriptStage,
  type RosterClassLevel,
} from "@scd/shared";
import { ClassTest, type IClassTest, type IClassTestScripts } from "../models/ClassTest";
import { ClassTestResult, type IClassTestResult } from "../models/ClassTestResult";
import { Section } from "../../foundation/models/Section";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import { StoredFile } from "../../platform/models/StoredFile";
import { writeAudit } from "../../platform/services/AuditService";
import type { AuditEventKind } from "../../platform/models/Audit";
import { emitCtScriptPublished } from "../../notifications/services/emitters";
import { buildIsOpenDayForRange, deadlineFrom } from "../classTestCalendar";
import { dateKeyOf, parseDateKey } from "../../attendance/dates";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { bnNum } from "../../../lib/bnNum";
import { ClassTestResultError } from "./ClassTestResultService";

const DAY_MS = 86_400_000;
/** A student's script is a handful of pages; the cap only stops a runaway tag. */
export const MAX_SCRIPT_PAGES = 30;

// ---------------------------------------------------------------------------
// Pure stage derivation
// ---------------------------------------------------------------------------

/** How far the scanning has got — over the PRESENT result rows only (an absent
 *  student sat nothing and never blocks UPLOAD_DONE). */
export interface ScriptResolution {
  presentCount: number;
  /** PRESENT rows with ≥1 page OR marked খাতা নেই. */
  resolvedCount: number;
  /** Total scanned pages across the test. */
  pageCount: number;
}

export const EMPTY_RESOLUTION: ScriptResolution = { presentCount: 0, resolvedCount: 0, pageCount: 0 };

type ScriptStamps = Pick<
  IClassTestScripts,
  "dueDateKey" | "receivedAt" | "publishedAt" | "handedBackAt" | "returnDueDateKey" | "returnedAt" | "waivedAt"
>;

/**
 * The script stage, or null when the test is not in the flow (no `scripts` field —
 * its results were never published). `todayKey` is the Dhaka `YYYY-MM-DD` of "now";
 * the comparison is STRICTLY after the due day (D-#715), deliberately unlike the
 * results deadline's on-the-day rule (D-#606): with a 1-day window, `>=` would turn
 * the reminder red on the only day the teacher has.
 */
export function deriveStage(
  s: ScriptStamps | null | undefined,
  r: ScriptResolution,
  todayKey: string,
): CtScriptStage | null {
  if (!s || !s.dueDateKey) return null;
  if (s.waivedAt) return "WAIVED";
  if (s.returnedAt) return "RETURNED";
  if (s.handedBackAt) {
    return s.returnDueDateKey && todayKey > s.returnDueDateKey ? "RETURN_OVERDUE" : "WITH_TEACHER";
  }
  if (s.publishedAt) return "PUBLISHED";
  if (s.receivedAt) {
    if (r.resolvedCount >= r.presentCount) return "UPLOAD_DONE";
    return r.resolvedCount > 0 ? "UPLOAD_IN_PROGRESS" : "UPLOAD_PENDING";
  }
  return todayKey > s.dueDateKey ? "OVERDUE" : "DUE";
}

/** Stages the Office can still tag pages in. */
const TAGGABLE: readonly CtScriptStage[] = ["UPLOAD_PENDING", "UPLOAD_IN_PROGRESS", "UPLOAD_DONE"];
/** Stages a waive is allowed from — anything before guardians can see the scans. */
const WAIVABLE: readonly CtScriptStage[] = ["DUE", "OVERDUE", ...TAGGABLE];

// ---------------------------------------------------------------------------
// Clock — the due day, in school days
// ---------------------------------------------------------------------------

/** The Dhaka day key `days` OPEN school days after `dayKey` (Fri/Sat/holidays skipped,
 *  the ONE D-#50 calendar via the class-test helper). */
export async function schoolDaysAfterKey(dayKey: string, days = CT_SCRIPT_DUE_SCHOOL_DAYS): Promise<string> {
  const from = parseDateKey(dayKey);
  const isOpenDay = await buildIsOpenDayForRange(from, new Date(from.getTime() + 45 * DAY_MS));
  return dateKeyOf(deadlineFrom(from, days, isOpenDay));
}

export function todayKeyOf(now: Date = new Date()): string {
  return dhakaDayKey(now);
}

/**
 * Called by the results publish (per-exam and per-student). The FIRST publish starts
 * the script clock; a re-publish never moves it (the `scripts` field already exists).
 * Best-effort: a calendar hiccup must never fail a results publish that has already
 * reached guardians — it logs, and the test simply enters the flow on the next publish.
 */
export async function startScriptClock(testId: string | Types.ObjectId, at: Date = new Date()): Promise<void> {
  try {
    const oid = new Types.ObjectId(testId.toString());
    const already = await ClassTest.exists({ _id: oid, "scripts.dueDateKey": { $exists: true } });
    if (already) return;
    const dueDateKey = await schoolDaysAfterKey(todayKeyOf(at));
    await ClassTest.updateOne(
      { _id: oid, "scripts.dueDateKey": { $exists: false } },
      { $set: { scripts: { dueDateKey, publishedVersion: 0 } } },
    );
  } catch (err) {
    console.error("[ClassTestScriptService] could not start the script clock (results publish unaffected):", err);
  }
}

// ---------------------------------------------------------------------------
// Batched reads — resolution per test, display rows
// ---------------------------------------------------------------------------

export async function resolutionByTest(testIds: Types.ObjectId[]): Promise<Map<string, ScriptResolution>> {
  if (testIds.length === 0) return new Map();
  const rows = (await ClassTestResult.aggregate([
    { $match: { testId: { $in: testIds }, status: "PRESENT" } },
    {
      $project: {
        testId: 1,
        pages: { $size: { $ifNull: ["$scriptFileIds", []] } },
        missing: { $eq: [{ $ifNull: ["$scriptMissing", false] }, true] },
      },
    },
    {
      $group: {
        _id: "$testId",
        presentCount: { $sum: 1 },
        resolvedCount: { $sum: { $cond: [{ $or: [{ $gt: ["$pages", 0] }, "$missing"] }, 1, 0] } },
        pageCount: { $sum: "$pages" },
      },
    },
  ])) as Array<{ _id: Types.ObjectId; presentCount: number; resolvedCount: number; pageCount: number }>;
  return new Map(
    rows.map((r) => [
      r._id.toString(),
      { presentCount: r.presentCount, resolvedCount: r.resolvedCount, pageCount: r.pageCount },
    ]),
  );
}

/** Stage per test for a set of already-loaded tests (the reports-status rows). */
export async function stagesForTests(tests: IClassTest[], now: Date = new Date()): Promise<Map<string, CtScriptStage>> {
  const inFlow = tests.filter((t) => t.scripts?.dueDateKey);
  if (inFlow.length === 0) return new Map();
  const res = await resolutionByTest(inFlow.map((t) => t._id));
  const todayKey = todayKeyOf(now);
  const out = new Map<string, CtScriptStage>();
  for (const t of inFlow) {
    const stage = deriveStage(t.scripts, res.get(t._id.toString()) ?? EMPTY_RESOLUTION, todayKey);
    if (stage) out.set(t._id.toString(), stage);
  }
  return out;
}

export interface ScriptTestRow {
  testId: string;
  ctId: string;
  subject: string;
  subjectBn: string;
  testNumber: number;
  examDate: string;
  classLevel: number | null;
  sectionId: string | null;
  subjectGroupId: string | null;
  /** "৪র্থ শ্রেণি · খ" for a section exam; the group's name for a group exam. */
  unitLabelBn: string;
  teacherId: string;
  teacherName: string;
  stage: CtScriptStage;
  dueDateKey: string;
  returnDueDateKey: string | null;
  presentCount: number;
  resolvedCount: number;
  pageCount: number;
  receivedCount: number | null;
  receivedAt: string | null;
  publishedAt: string | null;
  handedBackAt: string | null;
  returnedAt: string | null;
  waivedAt: string | null;
  waiveReason: string | null;
  backfilled: boolean;
}

function classBn(level: number): string {
  return (ROSTER_CLASS_LABELS_BN as Record<number, string>)[level as RosterClassLevel] ?? `ক্লাস ${bnNum(level)}`;
}

function subjectBnOf(subject: string): string {
  return (HW_SUBJECT_LABELS_BN as Record<string, string>)[subject] ?? subject;
}

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

async function buildRows(tests: IClassTest[], now: Date): Promise<ScriptTestRow[]> {
  const inFlow = tests.filter((t) => t.scripts?.dueDateKey);
  if (inFlow.length === 0) return [];
  const todayKey = todayKeyOf(now);
  const res = await resolutionByTest(inFlow.map((t) => t._id));

  const sectionIds = [...new Set(inFlow.filter((t) => t.sectionId).map((t) => t.sectionId!.toString()))];
  const groupIds = [...new Set(inFlow.filter((t) => t.subjectGroupId).map((t) => t.subjectGroupId!.toString()))];
  const teacherIds = [...new Set(inFlow.map((t) => (t.teacherId ?? t.requestedBy).toString()))];
  const [sections, groups, users] = await Promise.all([
    sectionIds.length
      ? (Section.find({ _id: { $in: sectionIds.map((id) => new Types.ObjectId(id)) } })
          .select("nameBn")
          .lean() as unknown as Promise<Array<{ _id: Types.ObjectId; nameBn: string }>>)
      : Promise.resolve([]),
    groupIds.length
      ? (SubjectGroup.find({ _id: { $in: groupIds.map((id) => new Types.ObjectId(id)) } })
          .select("nameBn")
          .lean() as unknown as Promise<Array<{ _id: Types.ObjectId; nameBn: string }>>)
      : Promise.resolve([]),
    User.find({ _id: { $in: teacherIds.map((id) => new Types.ObjectId(id)) } })
      .select("name")
      .lean() as unknown as Promise<Array<{ _id: Types.ObjectId; name: string }>>,
  ]);
  const sectionName = new Map(sections.map((s) => [s._id.toString(), s.nameBn]));
  const groupName = new Map(groups.map((g) => [g._id.toString(), g.nameBn]));
  const userName = new Map(users.map((u) => [u._id.toString(), u.name]));

  const rows: ScriptTestRow[] = [];
  for (const t of inFlow) {
    const s = t.scripts!;
    const r = res.get(t._id.toString()) ?? EMPTY_RESOLUTION;
    const stage = deriveStage(s, r, todayKey);
    if (!stage) continue;
    const teacherId = (t.teacherId ?? t.requestedBy).toString();
    const unitLabelBn = t.subjectGroupId
      ? groupName.get(t.subjectGroupId.toString()) ?? "দল"
      : [
          typeof t.classLevel === "number" ? classBn(t.classLevel) : null,
          t.sectionId ? sectionName.get(t.sectionId.toString()) ?? null : null,
        ]
          .filter(Boolean)
          .join(" · ");
    rows.push({
      testId: t._id.toString(),
      ctId: t.ctId,
      subject: t.subject,
      subjectBn: subjectBnOf(t.subject),
      testNumber: t.testNumber,
      examDate: new Date(t.examDate).toISOString(),
      classLevel: t.classLevel ?? null,
      sectionId: t.sectionId ? t.sectionId.toString() : null,
      subjectGroupId: t.subjectGroupId ? t.subjectGroupId.toString() : null,
      unitLabelBn,
      teacherId,
      teacherName: userName.get(teacherId) ?? "শিক্ষক",
      stage,
      dueDateKey: s.dueDateKey,
      returnDueDateKey: s.returnDueDateKey ?? null,
      presentCount: r.presentCount,
      resolvedCount: r.resolvedCount,
      pageCount: r.pageCount,
      receivedCount: s.receivedCount ?? null,
      receivedAt: iso(s.receivedAt),
      publishedAt: iso(s.publishedAt),
      handedBackAt: iso(s.handedBackAt),
      returnedAt: iso(s.returnedAt),
      waivedAt: iso(s.waivedAt),
      waiveReason: s.waiveReason ?? null,
      backfilled: !!s.backfilled,
    });
  }
  // Oldest due first — the longest-waiting paper is the most urgent.
  rows.sort((a, b) => a.dueDateKey.localeCompare(b.dueDateKey) || a.ctId.localeCompare(b.ctId));
  return rows;
}

/** Live (PRINTED) tests in the flow that are not finished (RETURNED / WAIVED). */
const OPEN_FLOW = {
  status: "PRINTED",
  "scripts.dueDateKey": { $exists: true },
  "scripts.returnedAt": null,
  "scripts.waivedAt": null,
};

function accountableTeacherFilter(userId: string): Record<string, unknown> {
  const uid = new Types.ObjectId(userId);
  return { $or: [{ teacherId: uid }, { teacherId: { $exists: false }, requestedBy: uid }] };
}

/**
 * The teacher's two reminders (Today): scripts still to hand in (DUE/OVERDUE) and
 * scripts the Office handed back to return in class (WITH_TEACHER/RETURN_OVERDUE).
 */
export async function teacherScriptTasks(userId: string, now: Date = new Date()): Promise<ScriptTestRow[]> {
  const tests = (await ClassTest.find({
    ...OPEN_FLOW,
    $and: [
      accountableTeacherFilter(userId),
      { $or: [{ "scripts.receivedAt": null }, { "scripts.handedBackAt": { $ne: null } }] },
    ],
  }).lean()) as unknown as IClassTest[];
  const rows = await buildRows(tests, now);
  return rows.filter((r) => ["DUE", "OVERDUE", "WITH_TEACHER", "RETURN_OVERDUE"].includes(r.stage));
}

/** The Office queue: every unfinished test in the flow, any stage. */
export async function officeScriptQueue(now: Date = new Date()): Promise<ScriptTestRow[]> {
  const tests = (await ClassTest.find(OPEN_FLOW).lean()) as unknown as IClassTest[];
  return buildRows(tests, now);
}

/** One test's row (any stage, including finished) — the upload screen's header. */
export async function scriptTestRow(testId: string, now: Date = new Date()): Promise<ScriptTestRow | null> {
  const test = (await ClassTest.findById(testId).lean()) as unknown as IClassTest | null;
  if (!test) return null;
  const rows = await buildRows([test], now);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// The per-student sheet (the Office's scan & tag screen)
// ---------------------------------------------------------------------------

export interface ScriptPage {
  fileId: string;
  mime: string;
  originalName: string;
}

export interface ScriptSheetStudent {
  studentId: string;
  name: string;
  nameBn: string | null;
  rollNumber: string | null;
  status: string;
  marks: number | null;
  pages: ScriptPage[];
  missing: boolean;
  missingReason: string | null;
}

export interface ScriptSheet {
  test: ScriptTestRow;
  totalMarks: number;
  students: ScriptSheetStudent[];
}

function rollOrder(a: ScriptSheetStudent, b: ScriptSheetStudent): number {
  const ra = a.rollNumber ? Number(a.rollNumber) : NaN;
  const rb = b.rollNumber ? Number(b.rollNumber) : NaN;
  if (Number.isFinite(ra) && Number.isFinite(rb) && ra !== rb) return ra - rb;
  if (Number.isFinite(ra) !== Number.isFinite(rb)) return Number.isFinite(ra) ? -1 : 1;
  return (a.rollNumber ?? "").localeCompare(b.rollNumber ?? "") || a.name.localeCompare(b.name);
}

export async function scriptSheet(testId: string, now: Date = new Date()): Promise<ScriptSheet> {
  const test = (await ClassTest.findById(testId).lean()) as unknown as IClassTest | null;
  if (!test) throw new ClassTestResultError("ক্লাস টেস্টটি পাওয়া যায়নি");
  const row = (await buildRows([test], now))[0];
  if (!row) throw new ClassTestResultError("এই টেস্টের খাতার ধাপ এখনও শুরু হয়নি — ফলাফল প্রকাশের পরে শুরু হয়");

  const results = (await ClassTestResult.find({ testId: test._id })
    .select("studentId status marks scriptFileIds scriptMissing scriptMissingReason")
    .lean()) as unknown as IClassTestResult[];
  const studentIds = results.map((r) => r.studentId);
  const fileIds = results.flatMap((r) => r.scriptFileIds ?? []);
  const [students, files] = await Promise.all([
    Student.find({ _id: { $in: studentIds } })
      .select("name nameBn rollNumber")
      .lean() as unknown as Promise<Array<{ _id: Types.ObjectId; name: string; nameBn?: string; rollNumber?: string }>>,
    fileIds.length
      ? (StoredFile.find({ _id: { $in: fileIds } })
          .select("mime originalName")
          .lean() as unknown as Promise<Array<{ _id: Types.ObjectId; mime: string; originalName: string }>>)
      : Promise.resolve([]),
  ]);
  const studentById = new Map(students.map((s) => [s._id.toString(), s]));
  const fileById = new Map(files.map((f) => [f._id.toString(), f]));

  const out: ScriptSheetStudent[] = results.map((r) => {
    const s = studentById.get(r.studentId.toString());
    return {
      studentId: r.studentId.toString(),
      name: s?.name ?? "শিক্ষার্থী",
      nameBn: s?.nameBn ?? null,
      rollNumber: s?.rollNumber ?? null,
      status: r.status,
      marks: r.status === "PRESENT" ? r.marks ?? null : null,
      pages: (r.scriptFileIds ?? []).map((id) => {
        const f = fileById.get(id.toString());
        return { fileId: id.toString(), mime: f?.mime ?? "application/octet-stream", originalName: f?.originalName ?? "" };
      }),
      missing: !!r.scriptMissing,
      missingReason: r.scriptMissingReason ?? null,
    };
  });
  out.sort(rollOrder);
  return { test: row, totalMarks: test.totalMarks, students: out };
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

async function loadFlow(testId: string, now: Date): Promise<{ test: IClassTest; stage: CtScriptStage }> {
  if (!Types.ObjectId.isValid(testId)) throw new ClassTestResultError("ক্লাস টেস্টটি পাওয়া যায়নি");
  const test = (await ClassTest.findById(testId).lean()) as unknown as IClassTest | null;
  if (!test) throw new ClassTestResultError("ক্লাস টেস্টটি পাওয়া যায়নি");
  if (test.status !== "PRINTED") throw new ClassTestResultError("এই ক্লাস টেস্টটি চালু নেই");
  const res = await resolutionByTest([test._id]);
  const stage = deriveStage(test.scripts, res.get(test._id.toString()) ?? EMPTY_RESOLUTION, todayKeyOf(now));
  if (!stage) throw new ClassTestResultError("এই টেস্টের খাতার ধাপ এখনও শুরু হয়নি — ফলাফল প্রকাশের পরে শুরু হয়");
  return { test, stage };
}

function requireStage(stage: CtScriptStage, allowed: readonly CtScriptStage[], message: string): void {
  if (!allowed.includes(stage)) throw new ClassTestResultError(message);
}

async function audit(
  eventKind: AuditEventKind,
  actorId: string,
  test: IClassTest,
  meta: Record<string, unknown> = {},
): Promise<void> {
  await writeAudit({
    eventKind,
    actorId,
    targetId: test._id,
    targetKind: "ClassTest",
    meta: { ctId: test.ctId, testId: test._id.toString(), ...meta },
  });
}

export async function receiveScripts(testId: string, count: number, actorId: string, now = new Date()): Promise<ScriptTestRow> {
  const { test, stage } = await loadFlow(testId, now);
  requireStage(stage, ["DUE", "OVERDUE"], "এই টেস্টের খাতা আগেই গ্রহণ করা হয়েছে");
  if (!Number.isInteger(count) || count < 0 || count > 1000) {
    throw new ClassTestResultError("খাতার সংখ্যা সঠিক নয়");
  }
  await ClassTest.updateOne(
    { _id: test._id },
    {
      $set: {
        "scripts.receivedAt": now,
        "scripts.receivedBy": new Types.ObjectId(actorId),
        "scripts.receivedCount": count,
      },
    },
  );
  await audit("CT_SCRIPTS_RECEIVED", actorId, test, { count, stageBefore: stage });
  return (await scriptTestRow(testId, now))!;
}

export async function undoReceiveScripts(testId: string, actorId: string, now = new Date()): Promise<ScriptTestRow> {
  const { test, stage } = await loadFlow(testId, now);
  requireStage(stage, ["UPLOAD_PENDING"], "স্ক্যান শুরু হয়ে গেছে — গ্রহণ বাতিল করা যাবে না");
  await ClassTest.updateOne(
    { _id: test._id },
    { $set: { "scripts.receivedAt": null, "scripts.receivedBy": null, "scripts.receivedCount": null } },
  );
  await audit("CT_SCRIPTS_RECEIVE_UNDONE", actorId, test, { count: test.scripts?.receivedCount ?? null });
  return (await scriptTestRow(testId, now))!;
}

export async function waiveScripts(testId: string, reason: string, actorId: string, now = new Date()): Promise<ScriptTestRow> {
  const { test, stage } = await loadFlow(testId, now);
  requireStage(stage, WAIVABLE, "প্রকাশের পরে আর বাদ দেওয়া যায় না");
  const trimmed = (reason ?? "").trim();
  if (!trimmed) throw new ClassTestResultError("কারণ লিখুন");
  await ClassTest.updateOne(
    { _id: test._id },
    {
      $set: {
        "scripts.waivedAt": now,
        "scripts.waivedBy": new Types.ObjectId(actorId),
        "scripts.waiveReason": trimmed,
      },
    },
  );
  await audit("CT_SCRIPTS_WAIVED", actorId, test, { reason: trimmed, stageBefore: stage });
  return (await scriptTestRow(testId, now))!;
}

export async function unwaiveScripts(testId: string, actorId: string, now = new Date()): Promise<ScriptTestRow> {
  const { test, stage } = await loadFlow(testId, now);
  requireStage(stage, ["WAIVED"], "এই টেস্টটি বাদ দেওয়া হয়নি");
  await ClassTest.updateOne(
    { _id: test._id },
    { $set: { "scripts.waivedAt": null, "scripts.waivedBy": null, "scripts.waiveReason": null } },
  );
  await audit("CT_SCRIPTS_WAIVED", actorId, test, { undone: true, reason: test.scripts?.waiveReason ?? null });
  return (await scriptTestRow(testId, now))!;
}

async function loadPresentRow(test: IClassTest, studentId: string): Promise<IClassTestResult> {
  if (!Types.ObjectId.isValid(studentId)) throw new ClassTestResultError("শিক্ষার্থী পাওয়া যায়নি");
  const row = (await ClassTestResult.findOne({
    testId: test._id,
    studentId: new Types.ObjectId(studentId),
  }).lean()) as unknown as IClassTestResult | null;
  if (!row) throw new ClassTestResultError("এই শিক্ষার্থীর ফলাফল নেই");
  if (row.status !== "PRESENT") throw new ClassTestResultError("অনুপস্থিত শিক্ষার্থীর খাতা লাগে না");
  return row;
}

export async function attachScriptPages(
  testId: string,
  studentId: string,
  fileIds: string[],
  actorId: string,
  now = new Date(),
): Promise<ScriptSheet> {
  const { test, stage } = await loadFlow(testId, now);
  requireStage(stage, TAGGABLE, "এখন খাতা যোগ করা যাবে না — আগে খাতা গ্রহণ করুন, আর প্রকাশের পরে নয়");
  const row = await loadPresentRow(test, studentId);
  const ids = [...new Set(fileIds)];
  if (ids.length === 0) throw new ClassTestResultError("কোনো ফাইল দেওয়া হয়নি");
  if (!ids.every((id) => Types.ObjectId.isValid(id))) throw new ClassTestResultError("ফাইলটি পাওয়া যায়নি");
  const oids = ids.map((id) => new Types.ObjectId(id));
  const files = await StoredFile.countDocuments({ _id: { $in: oids }, kind: "classtest_script" });
  if (files !== oids.length) throw new ClassTestResultError("শুধু খাতার স্ক্যান ফাইল যোগ করা যাবে");
  // A page belongs to exactly one student's script.
  const taken = await ClassTestResult.exists({ scriptFileIds: { $in: oids } });
  if (taken) throw new ClassTestResultError("এই ফাইল আগেই অন্য শিক্ষার্থীর খাতায় যোগ করা হয়েছে");
  const before = (row.scriptFileIds ?? []).length;
  if (before + oids.length > MAX_SCRIPT_PAGES) {
    throw new ClassTestResultError(`একজনের খাতায় সর্বোচ্চ ${bnNum(MAX_SCRIPT_PAGES)} পৃষ্ঠা`);
  }
  await ClassTestResult.updateOne(
    { _id: row._id },
    {
      $push: { scriptFileIds: { $each: oids } },
      $set: {
        scriptMissing: false,
        scriptMissingReason: null,
        scriptTaggedBy: new Types.ObjectId(actorId),
        scriptTaggedAt: now,
      },
    },
  );
  await audit("CT_SCRIPT_TAGGED", actorId, test, {
    studentId,
    action: "add",
    fileIds: ids,
    pagesBefore: before,
    pagesAfter: before + oids.length,
  });
  return scriptSheet(testId, now);
}

export async function removeScriptPage(
  testId: string,
  studentId: string,
  fileId: string,
  actorId: string,
  now = new Date(),
): Promise<ScriptSheet> {
  const { test, stage } = await loadFlow(testId, now);
  requireStage(stage, TAGGABLE, "প্রকাশের পরে খাতা বদলানো যাবে না — আগে প্রকাশ বাতিল করুন");
  const row = await loadPresentRow(test, studentId);
  const has = (row.scriptFileIds ?? []).some((id) => id.toString() === fileId);
  if (!has) throw new ClassTestResultError("এই পৃষ্ঠাটি এই শিক্ষার্থীর খাতায় নেই");
  await ClassTestResult.updateOne(
    { _id: row._id },
    {
      $pull: { scriptFileIds: new Types.ObjectId(fileId) },
      $set: { scriptTaggedBy: new Types.ObjectId(actorId), scriptTaggedAt: now },
    },
  );
  const before = (row.scriptFileIds ?? []).length;
  await audit("CT_SCRIPT_TAGGED", actorId, test, {
    studentId,
    action: "remove",
    fileId,
    pagesBefore: before,
    pagesAfter: before - 1,
  });
  return scriptSheet(testId, now);
}

export async function setScriptMissing(
  testId: string,
  studentId: string,
  missing: boolean,
  reason: string | null | undefined,
  actorId: string,
  now = new Date(),
): Promise<ScriptSheet> {
  const { test, stage } = await loadFlow(testId, now);
  requireStage(stage, TAGGABLE, "এখন বদলানো যাবে না — আগে খাতা গ্রহণ করুন, আর প্রকাশের পরে নয়");
  const row = await loadPresentRow(test, studentId);
  if (missing && (row.scriptFileIds ?? []).length > 0) {
    throw new ClassTestResultError("এই শিক্ষার্থীর খাতায় পৃষ্ঠা আছে — আগে সেগুলো সরান");
  }
  await ClassTestResult.updateOne(
    { _id: row._id },
    {
      $set: {
        scriptMissing: missing,
        scriptMissingReason: missing ? (reason ?? "").trim() || null : null,
        scriptTaggedBy: new Types.ObjectId(actorId),
        scriptTaggedAt: now,
      },
    },
  );
  await audit("CT_SCRIPT_TAGGED", actorId, test, {
    studentId,
    action: missing ? "missing" : "not_missing",
    missingBefore: !!row.scriptMissing,
    missingAfter: missing,
  });
  return scriptSheet(testId, now);
}

export interface ScriptPublishOutcome {
  test: ScriptTestRow;
  notifiedGuardianCount: number;
}

export async function publishScripts(testId: string, actorId: string, now = new Date()): Promise<ScriptPublishOutcome> {
  const { test, stage } = await loadFlow(testId, now);
  requireStage(
    stage,
    ["UPLOAD_DONE"],
    "উপস্থিত সবার খাতা যোগ হলে বা “খাতা নেই” চিহ্নিত হলে প্রকাশ করা যাবে",
  );
  const updated = (await ClassTest.findOneAndUpdate(
    { _id: test._id, "scripts.publishedAt": null },
    {
      $set: { "scripts.publishedAt": now, "scripts.publishedBy": new Types.ObjectId(actorId) },
      $inc: { "scripts.publishedVersion": 1 },
    },
    { new: true },
  ).lean()) as unknown as IClassTest | null;
  if (!updated) throw new ClassTestResultError("খাতা আগেই প্রকাশ করা হয়েছে");
  const version = updated.scripts?.publishedVersion ?? 1;

  // Only a student with pages AND a guardian-visible result has anything to open.
  const withPages = (await ClassTestResult.find({
    testId: test._id,
    publishedAt: { $ne: null },
    "scriptFileIds.0": { $exists: true },
  })
    .select("studentId")
    .lean()) as unknown as Array<{ studentId: Types.ObjectId }>;
  const subjectBn = subjectBnOf(test.subject);
  const notified = await emitCtScriptPublished({
    testId: test._id,
    ctId: test.ctId,
    studentIds: withPages.map((r) => r.studentId),
    sectionId: test.sectionId ?? null,
    version,
    titleBn: "ক্লাস টেস্টের খাতা দেখা যাবে",
    bodyBn: `${subjectBn} ক্লাস টেস্ট নং ${bnNum(test.testNumber)}-এর খাতা এখন অ্যাপে দেখা যাবে।`,
  });
  await audit("CT_SCRIPTS_PUBLISHED", actorId, test, {
    version,
    studentCount: withPages.length,
    notifiedCount: notified.length,
  });
  return { test: (await scriptTestRow(testId, now))!, notifiedGuardianCount: notified.length };
}

export async function unpublishScripts(testId: string, actorId: string, now = new Date()): Promise<ScriptTestRow> {
  const { test, stage } = await loadFlow(testId, now);
  requireStage(stage, ["PUBLISHED"], "শুধু প্রকাশিত (এখনও শিক্ষককে না দেওয়া) খাতার প্রকাশ বাতিল করা যায়");
  await ClassTest.updateOne(
    { _id: test._id },
    { $set: { "scripts.publishedAt": null, "scripts.publishedBy": null } },
  );
  await audit("CT_SCRIPTS_UNPUBLISHED", actorId, test, { version: test.scripts?.publishedVersion ?? 0 });
  return (await scriptTestRow(testId, now))!;
}

export async function handBackScripts(testId: string, actorId: string, now = new Date()): Promise<ScriptTestRow> {
  const { test, stage } = await loadFlow(testId, now);
  requireStage(stage, ["PUBLISHED"], "খাতা প্রকাশের পরে শিক্ষককে দেওয়া যায়");
  const returnDueDateKey = await schoolDaysAfterKey(todayKeyOf(now));
  await ClassTest.updateOne(
    { _id: test._id },
    {
      $set: {
        "scripts.handedBackAt": now,
        "scripts.handedBackBy": new Types.ObjectId(actorId),
        "scripts.returnDueDateKey": returnDueDateKey,
      },
    },
  );
  await audit("CT_SCRIPTS_HANDED_BACK", actorId, test, { returnDueDateKey });
  return (await scriptTestRow(testId, now))!;
}

export async function markScriptsReturned(testId: string, actorId: string, now = new Date()): Promise<ScriptTestRow> {
  const { test, stage } = await loadFlow(testId, now);
  requireStage(stage, ["WITH_TEACHER", "RETURN_OVERDUE"], "অফিস খাতা শিক্ষককে দেওয়ার পরে ফেরত চিহ্নিত করা যায়");
  await ClassTest.updateOne(
    { _id: test._id },
    { $set: { "scripts.returnedAt": now, "scripts.returnedBy": new Types.ObjectId(actorId) } },
  );
  await audit("CT_SCRIPTS_RETURNED", actorId, test, { stageBefore: stage });
  return (await scriptTestRow(testId, now))!;
}

/** The accountable teacher of a test (the resolver's "own test" check for returned). */
export async function accountableTeacherId(testId: string): Promise<string | null> {
  if (!Types.ObjectId.isValid(testId)) return null;
  const test = (await ClassTest.findById(testId).select("teacherId requestedBy").lean()) as unknown as Pick<
    IClassTest,
    "teacherId" | "requestedBy"
  > | null;
  if (!test) return null;
  return (test.teacherId ?? test.requestedBy).toString();
}

// ---------------------------------------------------------------------------
// Guardian side + the file read gate's reverse lookup
// ---------------------------------------------------------------------------

export interface GuardianScriptInfo {
  pages: Array<{ fileId: string; mime: string }>;
  /** Received at the office and not yet released: "খাতা স্ক্যান করা হচ্ছে". */
  pending: boolean;
}

/** For the guardian's published result rows: which have a viewable script. */
export async function guardianScriptInfo(
  docs: Array<Pick<IClassTestResult, "testId" | "status" | "scriptFileIds" | "scriptMissing">>,
  tests: Map<string, IClassTest>,
): Promise<Map<string, GuardianScriptInfo>> {
  const out = new Map<string, GuardianScriptInfo>();
  const visibleIds: Types.ObjectId[] = [];
  for (const d of docs) {
    const s = tests.get(d.testId.toString())?.scripts;
    if (s?.publishedAt && !s.waivedAt) visibleIds.push(...(d.scriptFileIds ?? []));
  }
  const files = visibleIds.length
    ? ((await StoredFile.find({ _id: { $in: visibleIds } }).select("mime").lean()) as unknown as Array<{
        _id: Types.ObjectId;
        mime: string;
      }>)
    : [];
  const mimeById = new Map(files.map((f) => [f._id.toString(), f.mime]));
  for (const d of docs) {
    const s = tests.get(d.testId.toString())?.scripts;
    if (!s || s.waivedAt) {
      out.set(d.testId.toString(), { pages: [], pending: false });
      continue;
    }
    if (s.publishedAt) {
      out.set(d.testId.toString(), {
        pages: (d.scriptFileIds ?? []).map((id) => ({
          fileId: id.toString(),
          mime: mimeById.get(id.toString()) ?? "application/octet-stream",
        })),
        pending: false,
      });
      continue;
    }
    out.set(d.testId.toString(), {
      pages: [],
      pending: !!s.receivedAt && d.status === "PRESENT" && !d.scriptMissing,
    });
  }
  return out;
}

/** One child's script info for the guardian's (already published) result rows. */
export async function childScriptInfo(studentId: string, testIds: string[]): Promise<Map<string, GuardianScriptInfo>> {
  if (testIds.length === 0) return new Map();
  const oids = testIds.map((id) => new Types.ObjectId(id));
  const [docs, tests] = await Promise.all([
    ClassTestResult.find({ studentId: new Types.ObjectId(studentId), testId: { $in: oids }, publishedAt: { $ne: null } })
      .select("testId status scriptFileIds scriptMissing")
      .lean() as unknown as Promise<IClassTestResult[]>,
    ClassTest.find({ _id: { $in: oids }, status: "PRINTED" })
      .select("scripts")
      .lean() as unknown as Promise<IClassTest[]>,
  ]);
  return guardianScriptInfo(docs, new Map(tests.map((t) => [t._id.toString(), t])));
}

/** The result row + test owning a scanned page, or null for an untagged upload. */
export async function scriptOwnerOf(
  fileId: Types.ObjectId,
): Promise<{ row: IClassTestResult; test: IClassTest } | null> {
  const row = (await ClassTestResult.findOne({ scriptFileIds: fileId }).lean()) as unknown as IClassTestResult | null;
  if (!row) return null;
  const test = (await ClassTest.findById(row.testId).lean()) as unknown as IClassTest | null;
  if (!test) return null;
  return { row, test };
}

// ---------------------------------------------------------------------------
// Backfill (D-#718) — used by server/scripts/backfill-ct-scripts.ts
// ---------------------------------------------------------------------------

export interface BackfillCandidate {
  testId: string;
  ctId: string;
  teacherId: string;
}

/** PRINTED tests in the given year with ≥1 published result and no `scripts` field. */
export async function backfillCandidates(academicYearId: Types.ObjectId): Promise<BackfillCandidate[]> {
  const tests = (await ClassTest.find({
    academicYearId,
    status: "PRINTED",
    "scripts.dueDateKey": { $exists: false },
  })
    .select("_id ctId teacherId requestedBy")
    .lean()) as unknown as IClassTest[];
  if (tests.length === 0) return [];
  const published = (await ClassTestResult.distinct("testId", {
    testId: { $in: tests.map((t) => t._id) },
    publishedAt: { $ne: null },
  })) as Types.ObjectId[];
  const publishedSet = new Set(published.map((id) => id.toString()));
  return tests
    .filter((t) => publishedSet.has(t._id.toString()))
    .map((t) => ({ testId: t._id.toString(), ctId: t.ctId, teacherId: (t.teacherId ?? t.requestedBy).toString() }));
}

/** Stamp the backfill clock on the given tests (skips any that entered the flow meanwhile). */
export async function applyBackfill(testIds: string[], dueDateKey: string): Promise<number> {
  if (testIds.length === 0) return 0;
  const res = await ClassTest.updateMany(
    {
      _id: { $in: testIds.map((id) => new Types.ObjectId(id)) },
      "scripts.dueDateKey": { $exists: false },
    },
    { $set: { scripts: { dueDateKey, backfilled: true, publishedVersion: 0 } } },
  );
  return (res as { modifiedCount?: number }).modifiedCount ?? 0;
}

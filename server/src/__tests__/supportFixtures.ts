/**
 * Shared fixtures for the support-profile suites (docs/prd-child-support-profile.md §12).
 * Every name here is MADE UP (the repo is public). Seeded with raw inserts so each suite controls
 * exactly the grants, slots and enrolments the scope rules read.
 */
import mongoose, { Types } from "mongoose";
import { graphql, type ExecutionResult } from "graphql";
import { dhakaDayKey } from "../lib/dhakaDay";

export const oid = (): Types.ObjectId => new Types.ObjectId();
export const todayKey = (): string => dhakaDayKey(new Date());
export const daysAgoKey = (n: number): string => dhakaDayKey(new Date(Date.now() - n * 86_400_000));
export const dhakaMidnight = (key: string): Date => new Date(`${key}T00:00:00+06:00`);

export interface SupportFx {
  year: Types.ObjectId;
  cls: Types.ObjectId;
  sec1: Types.ObjectId;
  sec2: Types.ObjectId;
  quranGroup: Types.ObjectId;
  child: Types.ObjectId;
  classmate: Types.ObjectId;
  otherChild: Types.ObjectId;
  principal: Types.ObjectId;
  classTeacher: Types.ObjectId;
  routineTeacher: Types.ObjectId;
  manualTeacher: Types.ObjectId;
  quranTeacher: Types.ObjectId;
  coverTeacher: Types.ObjectId;
  stranger: Types.ObjectId;
  supervisor: Types.ObjectId;
  office: Types.ObjectId;
}

/** Fixture roster (invented): the child, a classmate, guardians, staff. */
export const ROSTER = {
  child: { name: "Rafi Karim", nameBn: "রাফি করিম" },
  classmate: { name: "Tanvir Hasan", nameBn: "তানভীর হাসান" },
  otherChild: { name: "Nusrat Jahan", nameBn: "নুসরাত জাহান" },
  guardian: { name: "Abdul Karim" },
  staff: {
    principal: "Principal Testname",
    classTeacher: "Selina Akter",
    routineTeacher: "Habib Rahman",
    manualTeacher: "Farzana Yasmin",
    quranTeacher: "Mahmud Hasan",
    coverTeacher: "Jamal Uddin",
    stranger: "Rokeya Begum",
    supervisor: "Kamrul Islam",
    office: "Office Person",
  },
};

export async function seedSupport(opts: { switchOn?: boolean } = {}): Promise<SupportFx> {
  const db = mongoose.connection.db!;
  const fx: SupportFx = {
    year: oid(),
    cls: oid(),
    sec1: oid(),
    sec2: oid(),
    quranGroup: oid(),
    child: oid(),
    classmate: oid(),
    otherChild: oid(),
    principal: oid(),
    classTeacher: oid(),
    routineTeacher: oid(),
    manualTeacher: oid(),
    quranTeacher: oid(),
    coverTeacher: oid(),
    stranger: oid(),
    supervisor: oid(),
    office: oid(),
  };
  const users = [
    [fx.principal, "PRINCIPAL", ROSTER.staff.principal],
    [fx.classTeacher, "TEACHER", ROSTER.staff.classTeacher],
    [fx.routineTeacher, "TEACHER", ROSTER.staff.routineTeacher],
    [fx.manualTeacher, "TEACHER", ROSTER.staff.manualTeacher],
    [fx.quranTeacher, "TEACHER", ROSTER.staff.quranTeacher],
    [fx.coverTeacher, "TEACHER", ROSTER.staff.coverTeacher],
    [fx.stranger, "TEACHER", ROSTER.staff.stranger],
    [fx.supervisor, "TEACHER", ROSTER.staff.supervisor],
    [fx.office, "OFFICE", ROSTER.staff.office],
  ] as const;
  await db.collection("users").insertMany(
    users.map(([_id, role, name]) => ({ _id, role, name, passwordHash: "x", active: true, additionalTemplates: [], grantedPermissions: [], revokedPermissions: [] })),
  );
  const yearStart = daysAgoKey(60);
  await db.collection("academicyears").insertOne({ _id: fx.year, label: "TEST", startDate: dhakaMidnight(yearStart), endDate: new Date(Date.now() + 200 * 86_400_000), current: true });
  await db.collection("classes").insertOne({ _id: fx.cls, level: 3, nameBn: "তৃতীয়", academicYearId: fx.year, active: true });
  await db.collection("sections").insertMany([
    { _id: fx.sec1, classId: fx.cls, code: "A", nameBn: "ক", classTeacherId: fx.classTeacher },
    { _id: fx.sec2, classId: fx.cls, code: "B", nameBn: "খ" },
  ]);
  const students = [
    [fx.child, ROSTER.child, fx.sec1, "S-0001"],
    [fx.classmate, ROSTER.classmate, fx.sec1, "S-0002"],
    [fx.otherChild, ROSTER.otherChild, fx.sec2, "S-0003"],
  ] as const;
  await db.collection("students").insertMany(students.map(([_id, n, sectionId, schoolId]) => ({ _id, ...n, schoolId, classId: fx.cls, sectionId, active: true })));
  await db.collection("enrolments").insertMany(
    students.map(([studentId, , sectionId]) => ({ studentId, academicYearId: fx.year, classId: fx.cls, classLevel: 3, sectionId, status: "ACTIVE", startKey: yearStart })),
  );
  const guardianId = oid();
  await db.collection("guardians").insertOne({ _id: guardianId, name: ROSTER.guardian.name });
  await db.collection("guardianlinks").insertOne({ guardianId, studentId: fx.child });
  await db.collection("subjectgroups").insertOne({ _id: fx.quranGroup, track: "quran", level: "L1", gender: "mixed", code: "Q1", nameBn: "কুরআন ১", active: true });
  await db.collection("subjectgroupmemberships").insertOne({ groupId: fx.quranGroup, studentId: fx.child, track: "quran" });
  const today = todayKey();
  await db.collection("routineslots").insertMany([
    { groupType: "section", groupId: fx.sec1, classId: fx.cls, dayOfWeek: "SUN", periodNumber: 2, subject: "MATH", track: "general", teacherId: fx.routineTeacher, effectiveFrom: dhakaMidnight(today), active: true, createdBy: fx.principal },
    { groupType: "subjectgroup", groupId: fx.quranGroup, dayOfWeek: "SUN", periodNumber: 1, subject: "QURAN", track: "quran", teacherId: fx.quranTeacher, effectiveFrom: dhakaMidnight(daysAgoKey(30)), active: true, createdBy: fx.principal },
  ]);
  await db.collection("scopegrants").insertMany([
    { teacherId: fx.routineTeacher, kind: "teaching", source: "routine", classId: fx.cls, sectionId: fx.sec1, subjectId: oid(), active: true, createdBy: fx.principal },
    { teacherId: fx.manualTeacher, kind: "teaching", source: "manual", classId: fx.cls, sectionId: fx.sec1, subjectId: oid(), active: true, createdBy: fx.principal },
    { teacherId: fx.coverTeacher, kind: "proxy", coveringTeacherId: fx.coverTeacher, classId: fx.cls, sectionId: fx.sec1, startDate: dhakaMidnight(today), durationDays: 1, proxyStatus: "active", active: true, createdBy: fx.principal },
    { teacherId: fx.supervisor, kind: "supervisory", extent: "CLASS", classId: fx.cls, active: true, createdBy: fx.principal },
  ]);
  if (opts.switchOn !== false) await db.collection("supportsettings").insertOne({ key: "main", switchedOnKey: daysAgoKey(1), defaultMode: "MANUAL", packBudgetTokens: 60000, batchReminderDays: 7 });
  return fx;
}

export const authOf = (userId: Types.ObjectId, role: string, extra: Record<string, unknown> = {}) => ({ userId: String(userId), role, ...extra });

export function runner(schema: Parameters<typeof graphql>[0]["schema"]) {
  return (source: string, auth: Record<string, unknown> | null, variableValues?: Record<string, unknown>) =>
    graphql({ schema, source, contextValue: { auth }, variableValues }) as Promise<ExecutionResult<Record<string, any>>>;
}

/** A complete, clean report input (F-22-like: a clean positive report). */
export function reportInput(studentId: Types.ObjectId, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    studentId: String(studentId),
    occurredOn: todayKey(),
    groupType: "section",
    subject: "MATH",
    periodNo: 2,
    antecedentTags: ["GROUP_WORK"],
    situation: "দলে অঙ্কের কাজ চলছিল",
    behaviour: "সে নিজের অংশ শেষ করে পাশের জনকে দুটি অঙ্ক দেখিয়ে দিয়েছে",
    tried: "কাজ শুরুর আগে আলাদা করে এক লাইনে বুঝিয়ে দিয়েছি",
    starterKeys: ["REMIND_BEFORE"],
    result: "WORKED",
    resultNote: "পুরো সময় কাজ করেছে",
    goodThingText: "নিজে থেকে বোর্ড মুছে দিয়েছে",
    tone: "POSITIVE",
    ...over,
  };
}

export const SUBMIT = `mutation($input: SupportReportInput!, $reportId: String, $sg: String) {
  submitSupportReport(input: $input, reportId: $reportId, safeguardingAnswer: $sg) {
    outcome signs balanceNudge blocked { field term kind } askHits { field term }
    report { id status round safeguardingHold behaviour }
  }
}`;
export const DRAFT = `mutation($input: SupportReportInput!, $reportId: String) { saveSupportReportDraft(input: $input, reportId: $reportId) { id status } }`;
export const DECIDE = `mutation($id: String!, $d: String!, $reason: String, $edited: SupportEditedTextInput) {
  decideSupportReport(reportId: $id, decision: $d, reasonBn: $reason, edited: $edited) { id status checkSkipped principalEdited }
}`;
export const VIEW = `query($s: String!, $surface: String!, $via: String!) { supportProfileView(studentId: $s, surface: $surface, via: $via) { studentId status versionNo card { dos { textBn } } } }`;
export const MINE = `query { mySupportReportsPage { total rows { id status textVisible behaviour studentName } } }`;
export const QUEUE = `query($status: String) { supportQueuePage(status: $status) { total waiting held rows { id status safeguardingHold studentName } } }`;

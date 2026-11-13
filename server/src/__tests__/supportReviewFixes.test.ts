/**
 * CSP-1 review fixes (PR #1525): safeguarding hold locks the author, list rows carry metadata only,
 * the audit log hides SUPPORT_* / SAFEGUARDING_* from non-holders, the back-date window is for the
 * first submission only, via / surface / ids are validated, a left child has no readers, the chip
 * computes the caller's reach once. Made-up names only (public repo).
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { SafeguardingReferral } from "../modules/platform/safeguarding/SafeguardingReferral";
import { Audit } from "../modules/platform/models/Audit";
import { writeAudit } from "../modules/platform/services/AuditService";
import { currentSupportReaders, studentsReadBy } from "../modules/support-profile/services/supportScope";
import { authOf, daysAgoKey, DECIDE, MINE, oid, QUEUE, reportInput, runner, seedSupport, SUBMIT, todayKey, type SupportFx } from "./supportFixtures";

let mongo: MongoMemoryServer;
const run = runner(builder.toSchema());
let fx: SupportFx;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fx = await seedSupport();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
const T = () => authOf(fx.classTeacher, "TEACHER");
const P = () => authOf(fx.principal, "PRINCIPAL");
const SG_TEXT = "সে বলেছে, \"বাসায় মারে\"।";
const WITHDRAW = `mutation($id: String!) { withdrawSupportReport(reportId: $id) { id status } }`;
const RESOLVE = `mutation($id: String!, $a: String!) { resolveSupportSafeguardingHold(reportId: $id, answer: $a) { id status safeguardingHold behaviour textVisible } }`;
const READ = `query($id: String!, $via: String) { supportReport(reportId: $id, via: $via) { id textVisible behaviour tone occurredOn studentName } }`;

describe("1 — the safeguarding hold locks the author; the queue always lists held reports", () => {
  let heldId = "";
  it("author can neither edit nor withdraw while the hold is OPEN", async () => {
    const r = await run(SUBMIT, T(), { input: reportInput(fx.child, { settingNote: SG_TEXT, tone: "CONCERN" }), sg: "NO" });
    heldId = r.data?.submitSupportReport.report.id;
    expect((await SupportReport.findById(heldId).lean())?.safeguardingHold).toBe("OPEN");
    expect((await run(WITHDRAW, T(), { id: heldId })).errors).toBeDefined();
    expect((await run(SUBMIT, T(), { input: reportInput(fx.child, { settingNote: SG_TEXT, tone: "CONCERN" }), reportId: heldId, sg: "NO" })).errors).toBeDefined();
    expect((await SupportReport.findById(heldId).lean())?.status).toBe("TO_PROCESS");
  });
  it("a held report is listed and counted whatever its status or filter", async () => {
    await SupportReport.updateOne({ _id: heldId }, { $set: { status: "NEEDS_REWRITE" } });
    for (const status of [null, "PROCESSED", "TO_PROCESS"]) {
      const q = await run(QUEUE, P(), { status });
      expect(q.data?.supportQueuePage.rows.map((x: any) => x.id)).toContain(heldId);
      expect(q.data?.supportQueuePage.held).toBe(1);
    }
    await SupportReport.updateOne({ _id: heldId }, { $set: { status: "WITHDRAWN" } });
    expect((await run(QUEUE, P(), {})).data?.supportQueuePage.held).toBe(1);
    await SupportReport.updateOne({ _id: heldId }, { $set: { status: "TO_PROCESS" } });
  });
  it("the Principal clears the hold; the payload carries no text", async () => {
    const r = await run(RESOLVE, P(), { id: heldId, a: "NO" });
    expect(r.data?.resolveSupportSafeguardingHold.safeguardingHold).toBe("CLEARED");
    expect(r.data?.resolveSupportSafeguardingHold.textVisible).toBe(false);
    expect(r.data?.resolveSupportSafeguardingHold.behaviour).toBeNull();
  });
});

describe("4 — list rows and mutation payloads are metadata only; text only through the audited read", () => {
  it("my reports and the queue carry child, date, tone, status — no text", async () => {
    const s = await run(SUBMIT, T(), { input: reportInput(fx.child) });
    const id = s.data?.submitSupportReport.report.id;
    const mine = await run(`query { mySupportReportsPage { rows { id textVisible behaviour situation studentName tone occurredOn status } } }`, T());
    const row = mine.data?.mySupportReportsPage.rows.find((x: any) => x.id === id);
    expect(row).toMatchObject({ textVisible: false, behaviour: null, situation: null, tone: "POSITIVE", status: "TO_PROCESS" });
    expect(row.studentName).toBeTruthy();
    expect(row.occurredOn).toBe(todayKey());
    const q = await run(`query { supportQueuePage { rows { id textVisible behaviour tried goodThingText studentName tone } } }`, P());
    const qrow = q.data?.supportQueuePage.rows.find((x: any) => x.id === id);
    expect(qrow).toMatchObject({ textVisible: false, behaviour: null, tried: null, goodThingText: null, tone: "POSITIVE" });
    expect(qrow.studentName).toBeTruthy();
    expect(MINE).toContain("behaviour"); // the shared fixture query still parses
  });
  it("the decision payload carries no text; reading the report returns it and writes SUPPORT_PROFILE_VIEWED", async () => {
    const s = await run(SUBMIT, T(), { input: reportInput(fx.child, { behaviour: "সে নিজের জায়গা থেকে উঠে বন্ধুকে কলম এগিয়ে দিয়েছে" }) });
    const id = s.data?.submitSupportReport.report.id;
    const d = await run(`mutation($id: String!) { decideSupportReport(reportId: $id, decision: "APPROVED") { id status behaviour textVisible } }`, P(), { id });
    expect(d.data?.decideSupportReport).toMatchObject({ status: "APPROVED", behaviour: null, textVisible: false });
    const before = await Audit.countDocuments({ eventKind: "SUPPORT_PROFILE_VIEWED", "meta.surface": "REPORT" });
    const read = await run(READ, P(), { id, via: "QUEUE" });
    expect(read.data?.supportReport.behaviour).toContain("কলম");
    expect(await Audit.countDocuments({ eventKind: "SUPPORT_PROFILE_VIEWED", "meta.surface": "REPORT" })).toBe(before + 1);
    expect(DECIDE).toContain("decideSupportReport");
  });
});

describe("5 — the referral keeps the good thing", () => {
  it("goodThing text travels into the referral", async () => {
    const r = await run(SUBMIT, T(), { input: reportInput(fx.child, { behaviour: SG_TEXT, goodThingText: "আজ নিজে থেকে সবাইকে পানি এগিয়ে দিয়েছে", tone: "CONCERN" }), sg: "YES" });
    expect(r.data?.submitSupportReport.outcome).toBe("ROUTED");
    const ref = await SafeguardingReferral.findOne({}).sort({ _id: -1 }).lean();
    expect(ref?.textBn).toContain("পানি এগিয়ে দিয়েছে");
  });
});

describe("6 — the 7-day window is for the first submission only", () => {
  it("first submission 10 days back is refused", async () => {
    expect((await run(SUBMIT, T(), { input: reportInput(fx.child, { occurredOn: daysAgoKey(10) }) })).errors).toBeDefined();
  });
  it("a returned report rewritten after the window keeps its stored date", async () => {
    const s = await run(SUBMIT, T(), { input: reportInput(fx.child, { occurredOn: daysAgoKey(3) }) });
    const id = s.data?.submitSupportReport.report.id;
    await SupportReport.updateOne({ _id: id }, { $set: { status: "RETURNED", occurredOn: daysAgoKey(12) } });
    const again = await run(SUBMIT, T(), { input: reportInput(fx.child, { occurredOn: daysAgoKey(12) }), reportId: id });
    expect(again.errors).toBeUndefined();
    expect(again.data?.submitSupportReport.outcome).toBe("SAVED");
    const other = await run(SUBMIT, T(), { input: reportInput(fx.child, { occurredOn: todayKey(), behaviour: "সে দলের সবাইকে খাতা বিলি করে দিয়েছে" }), reportId: id });
    expect(other.errors).toBeUndefined();
    expect((await SupportReport.findById(id).lean())?.occurredOn).toBe(daysAgoKey(12));
  });
});

describe("8 / 11 — via, surface and ids are validated", () => {
  it("a made-up via is refused on a report read and a profile read", async () => {
    const s = await run(SUBMIT, T(), { input: reportInput(fx.child) });
    const id = s.data?.submitSupportReport.report.id;
    expect((await run(READ, P(), { id, via: "BOGUS" })).errors).toBeDefined();
    const V = `query($s: String!, $surface: String!, $via: String!) { supportProfileView(studentId: $s, surface: $surface, via: $via) { studentId } }`;
    expect((await run(V, P(), { s: String(fx.child), surface: "CARD", via: "BOGUS" })).errors).toBeDefined();
  });
  it("a malformed child id is a refusal, not a BSON error", async () => {
    const V = `query($s: String!) { supportProfileView(studentId: $s, surface: "CARD", via: "QUEUE") { studentId } }`;
    for (const auth of [P(), T()]) {
      const r = await run(V, auth, { s: "not-an-id" });
      expect(r.errors?.[0].message).toBeTruthy();
      expect(r.errors?.[0].message).not.toMatch(/BSON|ObjectId|Cast/i);
    }
  });
});

describe("12 — a draft shows the safeguarding question; a non-reader author sees status only", () => {
  it("a draft with a sign saves and returns the signs", async () => {
    const r = await run(`mutation($input: SupportReportInput!) { saveSupportReportDraft(input: $input) { id status signs } }`, T(), {
      input: reportInput(fx.child, { behaviour: SG_TEXT, tone: "CONCERN" }),
    });
    expect(r.errors).toBeUndefined();
    expect(r.data?.saveSupportReportDraft.status).toBe("DRAFT");
    expect(r.data?.saveSupportReportDraft.signs).toContain("DISCLOSURE");
    const clean = await run(`mutation($input: SupportReportInput!) { saveSupportReportDraft(input: $input) { signs } }`, T(), { input: reportInput(fx.child) });
    expect(clean.data?.saveSupportReportDraft.signs).toEqual([]);
  });
});

describe("2 / 9 / 10 — no enrolment today means no readers; the chip reach matches the gate", () => {
  let leftId: Types.ObjectId;
  let legacyId: Types.ObjectId;
  beforeAll(async () => {
    const db = mongoose.connection.db!;
    leftId = oid();
    legacyId = oid();
    await db.collection("students").insertMany([
      { _id: leftId, name: "Imran Test", nameBn: "ইমরান টেস্ট", schoolId: "S-0090", classId: fx.cls, sectionId: fx.sec1, active: false },
      { _id: legacyId, name: "Jahid Test", nameBn: "জাহিদ টেস্ট", schoolId: "S-0091", classId: fx.cls, sectionId: fx.sec1, active: true },
    ]);
    await db.collection("subjectgroupmemberships").insertMany([
      { groupId: fx.quranGroup, studentId: leftId, track: "quran" },
      { groupId: fx.quranGroup, studentId: legacyId, track: "quran" },
    ]);
  });
  it("a left child with group slots live has no readers (Quran teacher included); an active legacy child keeps them", async () => {
    expect(await currentSupportReaders(String(leftId))).toEqual([]);
    const legacy = (await currentSupportReaders(String(legacyId))).map((r) => String(r.userId));
    expect(legacy).toContain(String(fx.classTeacher));
    expect(legacy).toContain(String(fx.quranTeacher));
  });
  it("studentsReadBy agrees with currentSupportReaders for every staff member", async () => {
    const kids = [fx.child, fx.classmate, fx.otherChild, leftId, legacyId].map(String);
    for (const u of [fx.classTeacher, fx.routineTeacher, fx.manualTeacher, fx.quranTeacher, fx.coverTeacher, fx.stranger, fx.supervisor]) {
      const batch = await studentsReadBy(String(u), kids);
      const single = new Set<string>();
      for (const k of kids) if ((await currentSupportReaders(k)).some((r) => r.userId === String(u))) single.add(k);
      expect([...batch].sort()).toEqual([...single].sort());
    }
  });
});

describe("3 — audit privacy: SUPPORT_* / SAFEGUARDING_* only for the right holders", () => {
  const OFFICE = () => authOf(fx.office, "OFFICE", { grantedPermissions: ["audit_log:view", "audit_log:view_activity"] });
  const LOG = `query { auditLog(limit: 200) { eventKind } }`;
  const PAGE = `query($p: String!, $f: String!, $t: String!) { personActivityPage(personId: $p, from: $f, to: $t, pageSize: 100) { total rows { kind } } }`;
  const DAYS = `query($p: String!, $f: String!, $t: String!) { personActivityDays(personId: $p, from: $f, to: $t) { day audit } }`;
  const hidden = (k: string) => /^(SUPPORT_|SAFEGUARDING_)/.test(k);
  let actor: string;
  beforeAll(async () => {
    actor = String(fx.classTeacher);
    await writeAudit({ eventKind: "SUPPORT_PROFILE_VIEWED", actorId: actor, targetId: String(fx.child), targetKind: "Student", meta: { surface: "CARD" } });
    await writeAudit({ eventKind: "SAFEGUARDING_REFERRAL_RAISED", actorId: actor, targetKind: "Student", meta: {} });
    await writeAudit({ eventKind: "PROXY_EXPIRED", actorId: actor, meta: {} });
  });
  it("an Office user with audit_log:view / view_activity sees none of them", async () => {
    const log = await run(LOG, OFFICE());
    expect(log.errors).toBeUndefined();
    const kinds: string[] = log.data?.auditLog.map((x: any) => x.eventKind);
    expect(kinds).toContain("PROXY_EXPIRED");
    expect(kinds.filter(hidden)).toEqual([]);
    const vars = { p: actor, f: daysAgoKey(1), t: todayKey() };
    const page = await run(PAGE, OFFICE(), vars);
    expect(page.errors).toBeUndefined();
    expect(page.data?.personActivityPage.rows.map((x: any) => x.kind)).toContain("PROXY_EXPIRED");
    expect(page.data?.personActivityPage.rows.filter((x: any) => hidden(x.kind))).toEqual([]);
    const unfiltered = await Audit.countDocuments({ $or: [{ actorId: new Types.ObjectId(actor) }], eventAt: { $gte: new Date(Date.now() - 86_400_000) } });
    const visible = await Audit.countDocuments({ actorId: new Types.ObjectId(actor), eventKind: { $not: /^(SUPPORT_|SAFEGUARDING_)/ }, eventAt: { $gte: new Date(Date.now() - 86_400_000) } });
    expect(unfiltered).toBeGreaterThan(visible);
    expect(page.data?.personActivityPage.total).toBe(visible);
    const days = await run(DAYS, OFFICE(), vars);
    expect(days.data?.personActivityDays.reduce((n: number, d: any) => n + d.audit, 0)).toBe(visible);
    // naming a hidden kind in the filter finds nothing
    const asked = await run(`query { auditLog(limit: 50, eventKind: "SUPPORT_PROFILE_VIEWED") { eventKind } }`, OFFICE());
    expect(asked.data?.auditLog).toEqual([]);
  });
  it("the Principal (view_all + safeguarding:receive) sees them", async () => {
    const log = await run(LOG, P());
    const kinds: string[] = log.data?.auditLog.map((x: any) => x.eventKind);
    expect(kinds).toContain("SUPPORT_PROFILE_VIEWED");
    expect(kinds).toContain("SAFEGUARDING_REFERRAL_RAISED");
  });
  it("view_all without safeguarding:receive sees SUPPORT_* but not SAFEGUARDING_*", async () => {
    const auth = authOf(fx.principal, "PRINCIPAL", { revokedPermissions: ["safeguarding:receive"] });
    const kinds: string[] = (await run(LOG, auth)).data?.auditLog.map((x: any) => x.eventKind);
    expect(kinds).toContain("SUPPORT_PROFILE_VIEWED");
    expect(kinds.filter((k) => k.startsWith("SAFEGUARDING_"))).toEqual([]);
  });
});

describe("12 (last) — a non-reader author's rows expose status only", () => {
  it("after the author stops teaching the child, the list row and the read show no child, date, tone or text", async () => {
    const s = await run(SUBMIT, authOf(fx.manualTeacher, "TEACHER"), { input: reportInput(fx.child) });
    const id = s.data?.submitSupportReport.report.id;
    expect(id).toBeTruthy();
    await mongoose.connection.db!.collection("scopegrants").updateOne({ teacherId: fx.manualTeacher, kind: "teaching" }, { $set: { active: false } });
    const mine = await run(`query { mySupportReportsPage { rows { id status studentName tone occurredOn textVisible } } }`, authOf(fx.manualTeacher, "TEACHER"));
    const row = mine.data?.mySupportReportsPage.rows.find((x: any) => x.id === id);
    expect(row).toMatchObject({ status: "TO_PROCESS", studentName: null, tone: "", occurredOn: "", textVisible: false });
    const read = await run(READ, authOf(fx.manualTeacher, "TEACHER"), { id, via: "QUEUE" });
    expect(read.data?.supportReport).toMatchObject({ textVisible: false, behaviour: null, tone: "", occurredOn: "", studentName: null });
  });
});

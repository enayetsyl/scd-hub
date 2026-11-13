/**
 * CSP-1 — who may read (docs/prd-child-support-profile.md §8, D-#1547/#1548), in-memory Mongo.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportProfile } from "../modules/support-profile/models/SupportProfile";
import { SupportProfileVersion } from "../modules/support-profile/models/SupportProfileVersion";
import { Audit } from "../modules/platform/models/Audit";
import { authOf, daysAgoKey, MINE, reportInput, runner, seedSupport, SUBMIT, VIEW, type SupportFx } from "./supportFixtures";

let mongo: MongoMemoryServer;
const run = runner(builder.toSchema());
let fx: SupportFx;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fx = await seedSupport();
  // A published version so readers see content.
  const p = await SupportProfile.create({ studentId: fx.child, openedVia: "PRINCIPAL", openedBy: fx.principal, openedAt: new Date() });
  const v = await SupportProfileVersion.create({
    profileId: p._id,
    versionNo: 1,
    status: "PUBLISHED",
    createdBy: fx.principal,
    sections: { strengths: [{ itemId: "i1", textBn: "ছবি আঁকায় মনোযোগ দিয়ে কাজ করে", sourceKind: "PRINCIPAL", level: "SINGLE", lastEvidenceKey: daysAgoKey(3), evidence: [] }] },
    card: { doItemIds: [], avoidItemIds: [], strengthItemIds: ["i1"], goalItemId: null },
    publishedAt: new Date(),
  });
  p.currentVersionId = v._id;
  await p.save();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const view = (auth: Record<string, unknown> | null, surface = "CARD") => run(VIEW, auth, { s: String(fx.child), surface, via: "STUDENT_PAGE" });
const denied = (r: { errors?: readonly unknown[] }) => (r.errors?.length ?? 0) > 0;

describe("support profile access", () => {
  it("teachers who teach the child now read the card and the full profile", async () => {
    for (const t of [fx.classTeacher, fx.routineTeacher, fx.manualTeacher, fx.quranTeacher]) {
      const card = await view(authOf(t, "TEACHER"));
      expect(card.errors).toBeUndefined();
      expect(card.data?.supportProfileView.versionNo).toBe(1);
      expect((await view(authOf(t, "TEACHER"), "FULL")).errors).toBeUndefined();
    }
  });

  it("a cover teacher reads card + full on the cover day and may submit a report dated that day", async () => {
    expect((await view(authOf(fx.coverTeacher, "TEACHER"))).errors).toBeUndefined();
    expect((await view(authOf(fx.coverTeacher, "TEACHER"), "FULL")).errors).toBeUndefined();
    const ok = await run(SUBMIT, authOf(fx.coverTeacher, "TEACHER"), { input: reportInput(fx.child) });
    expect(ok.errors).toBeUndefined();
    expect(ok.data?.submitSupportReport.outcome).toBe("SAVED");
    const old = await run(SUBMIT, authOf(fx.coverTeacher, "TEACHER"), { input: reportInput(fx.child, { occurredOn: daysAgoKey(1) }) });
    expect(denied(old)).toBe(true);
  });

  it("the next day the cover teacher is refused and sees only the status of their report", async () => {
    // Move the proxy window to yesterday.
    await mongoose.connection.db!.collection("scopegrants").updateOne({ kind: "proxy" }, { $set: { startDate: new Date(Date.now() - 86_400_000 * 1.5) } });
    const card = await view(authOf(fx.coverTeacher, "TEACHER"));
    expect(denied(card)).toBe(true);
    const mine = await run(MINE, authOf(fx.coverTeacher, "TEACHER"));
    expect(mine.data?.mySupportReportsPage.total).toBe(1);
    const row = mine.data?.mySupportReportsPage.rows[0];
    expect(row.status).toBe("TO_PROCESS");
    expect(row.textVisible).toBe(false);
    expect(row.behaviour).toBeNull();
    expect(row.studentName).toBeNull();
  });

  it("a teacher not teaching the child is refused and the refusal is audited", async () => {
    const before = await Audit.countDocuments({ eventKind: "SUPPORT_ACCESS_REFUSED" });
    expect(denied(await view(authOf(fx.stranger, "TEACHER")))).toBe(true);
    expect(denied(await view(authOf(fx.supervisor, "TEACHER")))).toBe(true);
    expect(await Audit.countDocuments({ eventKind: "SUPPORT_ACCESS_REFUSED" })).toBe(before + 2);
  });

  it("OFFICE is refused even with support_profile:view stored on the user; GUARDIAN is refused", async () => {
    const office = authOf(fx.office, "OFFICE", { grantedPermissions: ["support_profile:view", "support_profile:report"] });
    expect(denied(await view(office))).toBe(true);
    expect(denied(await run(SUBMIT, office, { input: reportInput(fx.child) }))).toBe(true);
    expect(denied(await view(authOf(fx.office, "GUARDIAN")))).toBe(true);
  });

  it("the Principal reads all", async () => {
    const r = await view(authOf(fx.principal, "PRINCIPAL"), "FULL");
    expect(r.errors).toBeUndefined();
    expect(r.data?.supportProfileView.versionNo).toBe(1);
  });

  it("'view as' a teacher: refused for a non-Principal holder of view_as:open; allowed for the Principal and audited with the impersonator", async () => {
    const byOffice = authOf(fx.classTeacher, "TEACHER", { impersonatorId: String(fx.office), impersonatorRole: "OFFICE" });
    expect(denied(await view(byOffice))).toBe(true);
    const byPrincipal = authOf(fx.classTeacher, "TEACHER", { impersonatorId: String(fx.principal), impersonatorRole: "PRINCIPAL" });
    const { runWithAuditActor } = await import("../modules/platform/services/auditActor");
    const before = await Audit.countDocuments({ eventKind: "SUPPORT_PROFILE_VIEWED" });
    const r = await runWithAuditActor({ impersonatorId: String(fx.principal), impersonatorRole: "PRINCIPAL", onBehalfOf: String(fx.classTeacher) } as never, () => view(byPrincipal));
    expect(r.errors).toBeUndefined();
    const rows = await Audit.find({ eventKind: "SUPPORT_PROFILE_VIEWED" }).sort({ _id: -1 }).limit(1).lean();
    expect(await Audit.countDocuments({ eventKind: "SUPPORT_PROFILE_VIEWED" })).toBe(before + 1);
    expect(String(rows[0].actorId)).toBe(String(fx.principal));
  });

  it("a teacher sees only own reports, and loses them when the grant ends", async () => {
    await run(SUBMIT, authOf(fx.manualTeacher, "TEACHER"), { input: reportInput(fx.child) });
    const mine = await run(MINE, authOf(fx.manualTeacher, "TEACHER"));
    expect(mine.data?.mySupportReportsPage.total).toBe(1);
    // a list row is metadata only (§6.9): no text, but the child is named while the author still reads them
    expect(mine.data?.mySupportReportsPage.rows[0].textVisible).toBe(false);
    expect(mine.data?.mySupportReportsPage.rows[0].behaviour).toBeNull();
    expect(mine.data?.mySupportReportsPage.rows[0].studentName).toBeTruthy();
    const other = await run(MINE, authOf(fx.classTeacher, "TEACHER"));
    expect(other.data?.mySupportReportsPage.total).toBe(0);
    await mongoose.connection.db!.collection("scopegrants").updateOne({ teacherId: fx.manualTeacher }, { $set: { active: false } });
    const after = await run(MINE, authOf(fx.manualTeacher, "TEACHER"));
    expect(after.data?.mySupportReportsPage.rows[0].textVisible).toBe(false);
    expect(after.data?.mySupportReportsPage.rows[0].behaviour).toBeNull();
    expect(after.data?.mySupportReportsPage.rows[0].studentName).toBeNull();
  });
});

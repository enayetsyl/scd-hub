/**
 * D-#886 — the family confirms reading a delivered daily comment ("পড়েছি").
 *
 *   deliverComment       the FIRST delivery sets readConfirmRequired; a comment delivered
 *                        before the feature stays unflagged when it is re-sent
 *   myUnreadComments     own active children only; delivered + flagged + unconfirmed;
 *                        oldest first; positive and concern alike
 *   confirmCommentRead   stamps once (second call / second device = false); audited;
 *                        refused for another family's or an undelivered comment
 *   unreadCommentsPage   the Office list: drops confirmed rows; family phone, class label,
 *                        and whether anyone in the family can sign in
 *   canSeeReadStatus     the field gate: Office yes, teacher and guardian no
 *
 * In-memory MongoDB, real services; only the notification door is mocked.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: jest.fn(async () => undefined),
}));

import { StudentComment } from "../modules/comments/models/StudentComment";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { Student } from "../modules/foundation/models/Student";
import { Section } from "../modules/foundation/models/Section";
import { Class } from "../modules/foundation/models/Class";
import { Audit } from "../modules/platform/models/Audit";
import { deliverComment } from "../modules/comments/services/CommentDeliveryService";
import { confirmCommentRead, myUnreadComments, unreadCommentsPage } from "../modules/comments/services/CommentReadService";
import { StudentCommentError } from "../modules/comments/services/StudentCommentService";
import { canSeeReadStatus } from "../modules/comments/resolvers/commentRead";
import type { AppContext } from "../context";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const OFFICE = new Types.ObjectId().toString();
const TEACHER = new Types.ObjectId();
let seq = 0;
let sectionId: Types.ObjectId;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([
    StudentComment.deleteMany({}),
    Guardian.deleteMany({}),
    GuardianLink.deleteMany({}),
    Student.deleteMany({}),
    Section.deleteMany({}),
    Class.deleteMany({}),
    Audit.deleteMany({}),
  ]);
  const cls = await Class.collection.insertOne({ level: 3, name: "Three", nameBn: "তৃতীয় শ্রেণি", academicYearId: new Types.ObjectId() });
  const sec = await Section.collection.insertOne({ classId: cls.insertedId, name: "Girls", nameBn: "বালিকা", active: true });
  sectionId = sec.insertedId;
});

async function student(name: string, phone?: string): Promise<Types.ObjectId> {
  seq += 1;
  const r = await Student.collection.insertOne({
    schoolId: `S-${seq}`,
    name,
    classId: new Types.ObjectId(),
    sectionId,
    active: true,
    ...(phone ? { phone } : {}),
  });
  return r.insertedId;
}

async function guardian(childIds: Types.ObjectId[], opts: { loginEnabled?: boolean; active?: boolean; linkActive?: boolean } = {}): Promise<string> {
  seq += 1;
  const r = await Guardian.collection.insertOne({
    identifierKind: "phone",
    identifier: `0170000${seq}`,
    name: `G${seq}`,
    loginEnabled: opts.loginEnabled ?? true,
    active: opts.active ?? true,
  });
  for (const c of childIds) {
    await GuardianLink.collection.insertOne({ guardianId: r.insertedId, studentId: c, relation: "father", active: opts.linkActive ?? true });
  }
  return r.insertedId.toString();
}

/** A comment as stored; `delivered` = a delivery from this release (flagged). */
async function comment(
  studentId: Types.ObjectId,
  opts: { delivered?: Date | null; flagged?: boolean; sentiment?: string; readAt?: Date } = {},
): Promise<string> {
  const delivered = opts.delivered === undefined ? new Date("2026-11-01T04:00:00Z") : opts.delivered;
  const r = await StudentComment.collection.insertOne({
    studentId,
    sectionId,
    authorUserId: TEACHER,
    type: "BEHAVIOUR",
    sentiment: opts.sentiment ?? "CONCERN",
    text: "ক্লাসে মনোযোগ কম",
    attachmentIds: [],
    deliveryChannels: delivered ? ["inbox"] : [],
    ...(delivered ? { deliveredAt: delivered } : {}),
    ...(opts.flagged ?? !!delivered ? { readConfirmRequired: true } : {}),
    ...(opts.readAt ? { guardianReadAt: opts.readAt } : {}),
    createdAt: new Date("2026-10-31T04:00:00Z"),
    updatedAt: new Date("2026-10-31T04:00:00Z"),
  });
  return r.insertedId.toString();
}

describe("deliverComment sets the read flag (D-#886)", () => {
  it("flags a comment on its first delivery", async () => {
    const s = await student("Ayesha", "01711111111");
    await guardian([s]);
    const id = await comment(s, { delivered: null, flagged: false });
    await deliverComment(id, OFFICE);
    const doc = await StudentComment.findById(id).lean();
    expect(doc?.deliveredAt).toBeTruthy();
    expect(doc?.readConfirmRequired).toBe(true);
    expect(doc?.guardianReadAt).toBeUndefined();
  });

  it("leaves a comment delivered before the feature unflagged when it is re-sent", async () => {
    const s = await student("Rahma");
    await guardian([s]);
    const id = await comment(s, { delivered: new Date("2026-10-20T04:00:00Z"), flagged: false });
    await deliverComment(id, OFFICE);
    const doc = await StudentComment.findById(id).lean();
    expect(doc?.readConfirmRequired).toBeUndefined();
    expect(await myUnreadComments(await guardian([s]))).toEqual([]);
  });
});

describe("myUnreadComments", () => {
  it("returns only the guardian's own children's delivered, flagged, unconfirmed comments, oldest first", async () => {
    const mine = await student("Zainab");
    const other = await student("Nusaibah");
    const g = await guardian([mine]);
    await guardian([other]);
    const late = await comment(mine, { delivered: new Date("2026-11-01T06:00:00Z"), sentiment: "POSITIVE" });
    const early = await comment(mine, { delivered: new Date("2026-11-01T03:00:00Z") });
    await comment(mine, { delivered: null }); // not sent yet
    await comment(mine, { delivered: new Date("2026-10-01T03:00:00Z"), flagged: false }); // before the feature
    await comment(mine, { readAt: new Date() }); // already confirmed
    await comment(other); // another family

    const rows = await myUnreadComments(g);
    expect(rows.map((r) => r.id)).toEqual([early, late]);
    expect(rows[0]).toMatchObject({ studentName: "Zainab", sentiment: "CONCERN", text: "ক্লাসে মনোযোগ কম" });
    expect(rows[1].sentiment).toBe("POSITIVE");
  });

  it("is empty through an inactive link or for an inactive guardian", async () => {
    const s = await student("Suraya");
    await comment(s);
    expect(await myUnreadComments(await guardian([s], { linkActive: false }))).toEqual([]);
    expect(await myUnreadComments(await guardian([s], { active: false }))).toEqual([]);
  });
});

describe("confirmCommentRead", () => {
  it("stamps the first confirmation once and audits it", async () => {
    const s = await student("Juwairiya");
    const g1 = await guardian([s]);
    const g2 = await guardian([s]); // the second parent's login
    const id = await comment(s);
    const at = new Date("2026-11-01T08:00:00Z");

    expect(await confirmCommentRead(g1, id, at)).toBe(true);
    expect(await confirmCommentRead(g2, id)).toBe(false);
    expect(await confirmCommentRead(g1, id)).toBe(false);

    const doc = await StudentComment.findById(id).lean();
    expect(doc?.guardianReadAt?.toISOString()).toBe(at.toISOString());
    expect(String(doc?.guardianReadBy)).toBe(g1);
    expect(await myUnreadComments(g2)).toEqual([]);
    const audits = await Audit.find({ eventKind: "STUDENT_COMMENT_READ_CONFIRMED" }).lean();
    expect(audits).toHaveLength(1);
    expect(String(audits[0].targetId)).toBe(id);
  });

  it("refuses another family's comment and an undelivered one", async () => {
    const mine = await student("A");
    const theirs = await student("B");
    const g = await guardian([mine]);
    const foreign = await comment(theirs);
    const draft = await comment(mine, { delivered: null });
    await expect(confirmCommentRead(g, foreign)).rejects.toBeInstanceOf(StudentCommentError);
    await expect(confirmCommentRead(g, draft)).rejects.toBeInstanceOf(StudentCommentError);
    await expect(confirmCommentRead(g, "nope")).rejects.toBeInstanceOf(StudentCommentError);
    expect((await StudentComment.findById(foreign).lean())?.guardianReadAt).toBeUndefined();
  });

  it("does nothing for a comment delivered before the feature", async () => {
    const s = await student("C");
    const g = await guardian([s]);
    const id = await comment(s, { flagged: false });
    expect(await confirmCommentRead(g, id)).toBe(false);
    expect((await StudentComment.findById(id).lean())?.guardianReadAt).toBeUndefined();
  });
});

describe("unreadCommentsPage", () => {
  it("lists the unconfirmed rows oldest first with the family's phone and app login", async () => {
    const withApp = await student("Ayesha", "01711111111");
    const noApp = await student("Rahma");
    await guardian([withApp]);
    await guardian([noApp], { loginEnabled: false });
    const a = await comment(withApp, { delivered: new Date("2026-11-01T05:00:00Z") });
    const b = await comment(noApp, { delivered: new Date("2026-11-01T02:00:00Z") });
    await comment(withApp, { readAt: new Date() });
    await comment(noApp, { flagged: false });

    const page = await unreadCommentsPage({ page: 1, pageSize: 50 });
    expect(page.total).toBe(2);
    expect(page.rows.map((r) => r.id)).toEqual([b, a]);
    expect(page.rows[0]).toMatchObject({ studentName: "Rahma", phone: null, hasAppLogin: false, classLabel: "তৃতীয় শ্রেণি · বালিকা" });
    expect(page.rows[1]).toMatchObject({ studentName: "Ayesha", phone: "01711111111", hasAppLogin: true });

    await confirmCommentRead((await GuardianLink.findOne({ studentId: withApp }).lean())!.guardianId.toString(), a);
    expect((await unreadCommentsPage({})).rows.map((r) => r.id)).toEqual([b]);
  });
});

describe("canSeeReadStatus (field gate)", () => {
  const ctx = (role: string) => ({ auth: { userId: OFFICE, role, permissions: [] } }) as unknown as AppContext;
  it("is Office-on, teacher-off, guardian-off by default", () => {
    expect(canSeeReadStatus(ctx("OFFICE"))).toBe(true);
    expect(canSeeReadStatus(ctx("PRINCIPAL"))).toBe(true);
    expect(canSeeReadStatus(ctx("TEACHER"))).toBe(false);
    expect(canSeeReadStatus(ctx("GUARDIAN"))).toBe(false);
    expect(canSeeReadStatus({ auth: null } as unknown as AppContext)).toBe(false);
  });
});

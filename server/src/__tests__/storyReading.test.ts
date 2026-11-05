/**
 * SB-4 — "my child's books" + the storybook alerts (D-#983/#984, docs/prd-storybook-reading.md).
 *
 *   reading   held now, read in the last 7 days / this month / this year (only books the desk
 *             ticked as read), stickers, history newest first; storybooks only; another family refused
 *   alerts    lending a storybook tells every linked guardian (STORYBOOK_ISSUED, deduped per loan
 *             AND guardian) and raises a pop-up for the family when the sender may send one;
 *             a teacher without popup_notice:send_guardian → notification only; a sticker →
 *             STORYBOOK_STICKER; an ordinary library book → nothing
 *
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { AppContext } from "../context";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { User } from "../modules/foundation/models/User";
import { Notification } from "../modules/notifications/models/Notification";
import { PopupNotice } from "../modules/popup-notices/models/PopupNotice";
import { BookTitle } from "../modules/library/models/BookTitle";
import { BookCopy } from "../modules/library/models/BookCopy";
import { BookLoan } from "../modules/library/models/BookLoan";
import { StorySeries } from "../modules/library/models/StorySeries";
import { issueBook, returnBook } from "../modules/library/services/LibraryCirculationService";
import { alertStoryIssued, alertStorySticker, childStoryReading } from "../modules/library/services/StoryReadingService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
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
  await Promise.all(
    [Class, Section, Student, Guardian, GuardianLink, User, Notification, PopupNotice, BookTitle, BookCopy, BookLoan, StorySeries].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

const ctxOf = (userId: string, role: string): AppContext => ({ auth: { userId, role } } as unknown as AppContext);
let seq = 0;

async function staff(role: "OFFICE" | "TEACHER"): Promise<AppContext> {
  seq += 1;
  const u = await User.collection.insertOne({ email: `s${seq}@t.test`, passwordHash: "x", role, name: `Staff ${seq}`, active: true });
  return ctxOf(u.insertedId.toString(), role);
}
async function child(nameBn: string) {
  seq += 1;
  const cls = await Class.collection.insertOne({ level: 0, nameBn: "কেজি", academicYearId: new Types.ObjectId(), active: true });
  const sec = await Section.collection.insertOne({ classId: cls.insertedId, code: `A${seq}`, nameBn: "কেজি" });
  const s = await Student.collection.insertOne({ schoolId: `0${200 + seq}`, name: nameBn, nameBn, classId: cls.insertedId, sectionId: sec.insertedId, active: true });
  return s.insertedId.toString();
}
async function guardianOf(kid: string): Promise<AppContext> {
  seq += 1;
  const g = await Guardian.collection.insertOne({ identifierKind: "phone", identifier: `0180000${seq}`, name: `G${seq}`, loginEnabled: true, active: true });
  await GuardianLink.collection.insertOne({ guardianId: g.insertedId, studentId: new Types.ObjectId(kid), relation: "mother", active: true });
  return ctxOf(g.insertedId.toString(), "GUARDIAN");
}
async function books(n: number) {
  const s = await StorySeries.create({ code: "TRE", nameBn: "গাছের গল্প", ageBandCode: "3-6", status: "PUBLISHED" });
  for (let i = 1; i <= n; i++) {
    const t = await BookTitle.create({ titleBn: `বই ${i}`, language: "BANGLA", active: true, seriesId: s._id, seriesNo: i });
    await BookCopy.create({ titleId: t._id, accessionNo: `TRE-0${i}-1`, status: "AVAILABLE" });
  }
  const plain = await BookTitle.create({ titleBn: "অভিধান", language: "BANGLA", active: true });
  await BookCopy.create({ titleId: plain._id, accessionNo: "LIB-0001", status: "AVAILABLE" });
}
const stu = (id: string) => ({ type: "STUDENT" as const, id });

describe("my child's books", () => {
  it("counts only desk-ticked reads by window, keeps stickers and history, and ignores ordinary library books", async () => {
    await books(5);
    const office = await staff("OFFICE");
    const kid = await child("আয়েশা");
    const g = await guardianOf(kid);
    const actor = office.auth!.userId;
    const now = new Date("2026-11-20T10:00:00+06:00");
    const at = (iso: string) => new Date(iso);

    // Last year (not this year), early this month, 3 days ago (read), 2 days ago (not read), and one still out.
    const l1 = await issueBook("TRE-01-1", stu(kid), actor, at("2025-12-20T10:00:00+06:00"));
    await returnBook(l1._id.toString(), actor, at("2025-12-24T10:00:00+06:00"), { read: true });
    const l2 = await issueBook("TRE-02-1", stu(kid), actor, at("2026-11-02T10:00:00+06:00"));
    await returnBook(l2._id.toString(), actor, at("2026-11-03T10:00:00+06:00"), { read: true });
    const l3 = await issueBook("TRE-03-1", stu(kid), actor, at("2026-11-15T10:00:00+06:00"));
    await returnBook(l3._id.toString(), actor, at("2026-11-17T10:00:00+06:00"), { read: true });
    const l4 = await issueBook("TRE-04-1", stu(kid), actor, at("2026-11-17T10:00:00+06:00"));
    await returnBook(l4._id.toString(), actor, at("2026-11-18T10:00:00+06:00"), { read: false });
    await issueBook("TRE-05-1", stu(kid), actor, at("2026-11-19T10:00:00+06:00"));
    await issueBook("LIB-0001", stu(kid), actor, at("2026-11-19T10:00:00+06:00")); // not a storybook

    const r = await childStoryReading(g, kid, now);
    expect(r.current.map((c) => c.title.titleBn)).toEqual(["বই 5"]);
    expect([r.readLast7Days, r.readThisMonth, r.readThisYear]).toEqual([1, 2, 2]);
    expect([r.stickersThisYear, r.stickersTotal]).toEqual([2, 3]);
    expect(r.history.map((h) => h.title.titleBn)).toEqual(["বই 4", "বই 3", "বই 2", "বই 1"]);
    expect(r.history[0].loan.readAtReturn).toBe(false);

    const other = await guardianOf(await child("হামযা"));
    await expect(childStoryReading(other, kid, now)).rejects.toThrow();
  });
});

describe("alerts", () => {
  it("tells both parents, with a family pop-up when the sender may send one, and a sticker notice", async () => {
    await books(2);
    const office = await staff("OFFICE");
    const kid = await child("আয়েশা");
    const g1 = await guardianOf(kid);
    const g2 = await guardianOf(kid);
    const loan = await issueBook("TRE-01-1", stu(kid), office.auth!.userId);

    const res = await alertStoryIssued(office, loan);
    expect(res).toEqual({ notified: 2, popup: true });
    const notes = await Notification.find({ kind: "STORYBOOK_ISSUED" }).lean();
    expect(notes.map((n) => n.recipientGuardianId?.toString()).sort()).toEqual([g1.auth!.userId, g2.auth!.userId].sort());
    expect(notes[0].titleBn).toBe("আয়েশা নতুন বই নিয়েছে");
    expect(notes[0].bodyBn).toContain("“বই 1”");
    const pop = await PopupNotice.findOne({}).lean();
    expect(pop?.titleBn).toBe("আয়েশা নতুন বই নিয়েছে");
    expect((pop as unknown as { audience: { studentIds: Types.ObjectId[] } }).audience.studentIds.map(String)).toEqual([kid]);
    expect((await alertStoryIssued(office, loan)).notified).toBe(0); // deduped

    const back = await returnBook(loan._id.toString(), office.auth!.userId, new Date(), { read: true });
    expect((await alertStorySticker(office, back)).notified).toBe(2);
    expect(await Notification.countDocuments({ kind: "STORYBOOK_STICKER" })).toBe(2);

    // A teacher on desk duty can't send guardian pop-ups → notification only.
    const teacher = await staff("TEACHER");
    const loan2 = await issueBook("TRE-02-1", stu(kid), teacher.auth!.userId);
    expect(await alertStoryIssued(teacher, loan2)).toEqual({ notified: 2, popup: false });
    expect(await PopupNotice.countDocuments({})).toBe(2);
  });

  it("says nothing for an ordinary library book", async () => {
    await books(1);
    const office = await staff("OFFICE");
    const kid = await child("আয়েশা");
    await guardianOf(kid);
    const loan = await issueBook("LIB-0001", stu(kid), office.auth!.userId);
    expect(await alertStoryIssued(office, loan)).toEqual({ notified: 0, popup: false });
  });
});

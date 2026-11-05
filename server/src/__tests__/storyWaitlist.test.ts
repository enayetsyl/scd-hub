/**
 * SB-3 — the storybook waitlist (D-#982/#990, docs/prd-storybook-reading.md).
 *
 *   join      a guardian queues their child for a book that is out; refused while a copy is
 *             in, for a book the child has, past 2 waits, and for another family's child
 *   desk      the desk adds a child in person (same rules)
 *   hold      return → the first child's hold runs 2 WORKING days (Fri/Sat skipped) and BOTH
 *             linked guardians are told (dedupe per guardian); the card shows held / place
 *   leave     leaving a held book passes it to the next child, who is told
 *   lists     the child's waits (held first); the desk's queue view
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
import { Notification } from "../modules/notifications/models/Notification";
import { BookTitle } from "../modules/library/models/BookTitle";
import { BookCopy } from "../modules/library/models/BookCopy";
import { BookLoan } from "../modules/library/models/BookLoan";
import { BookReservation } from "../modules/library/models/BookReservation";
import { StorySeries } from "../modules/library/models/StorySeries";
import { issueBook, returnBook } from "../modules/library/services/LibraryCirculationService";
import { resolveShelfViewer, storyBookDetail } from "../modules/library/services/StorybookService";
import { workingDaysHoldEnd } from "../modules/library/services/StoryHoldService";
import { STORY_WAIT_ERRORS_BN, childStoryWaits, joinStoryWaitlist, leaveStoryWaitlist } from "../modules/library/services/StoryWaitlistService";

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
    [Class, Section, Student, Guardian, GuardianLink, Notification, BookTitle, BookCopy, BookLoan, BookReservation, StorySeries].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

const ctxOf = (userId: string, role: string): AppContext => ({ auth: { userId, role } } as unknown as AppContext);
const office = ctxOf(new Types.ObjectId().toString(), "OFFICE");
let seq = 0;

async function child(nameBn: string) {
  seq += 1;
  const cls = await Class.collection.insertOne({ level: 0, nameBn: "কেজি", academicYearId: new Types.ObjectId(), active: true });
  const sec = await Section.collection.insertOne({ classId: cls.insertedId, code: `A${seq}`, nameBn: "কেজি" });
  const s = await Student.collection.insertOne({ schoolId: `0${100 + seq}`, name: nameBn, nameBn, classId: cls.insertedId, sectionId: sec.insertedId, active: true });
  return s.insertedId.toString();
}
async function guardianOf(kid: string): Promise<AppContext> {
  seq += 1;
  const g = await Guardian.collection.insertOne({ identifierKind: "phone", identifier: `0170000${seq}`, name: `G${seq}`, loginEnabled: true, active: true });
  await GuardianLink.collection.insertOne({ guardianId: g.insertedId, studentId: new Types.ObjectId(kid), relation: "mother", active: true });
  return ctxOf(g.insertedId.toString(), "GUARDIAN");
}
async function shelf(books: number, copies = 1) {
  const s = await StorySeries.create({ code: "TRE", nameBn: "গাছের গল্প", ageBandCode: "3-6", status: "PUBLISHED" });
  const ids: string[] = [];
  for (let n = 1; n <= books; n++) {
    const t = await BookTitle.create({ titleBn: `বই ${n}`, language: "BANGLA", active: true, draft: false, seriesId: s._id, seriesNo: n });
    for (let k = 1; k <= copies; k++) await BookCopy.create({ titleId: t._id, accessionNo: `TRE-0${n}-${k}`, status: "AVAILABLE" });
    ids.push(t._id.toString());
  }
  return ids;
}
const stu = (id: string) => ({ type: "STUDENT" as const, id });

describe("working-day hold end", () => {
  it("skips Friday and Saturday", async () => {
    // Thursday 5 Nov 2026 → Sun 8 (1), Mon 9 (2).
    const end = await workingDaysHoldEnd(new Date("2026-11-05T10:00:00+06:00"), 2);
    expect(end.toISOString()).toBe(new Date("2026-11-09T23:59:59+06:00").toISOString());
  });
});

describe("join, hold, leave", () => {
  it("queues children while the book is out, holds it for the first, tells both parents, passes it on", async () => {
    const [t1] = await shelf(1);
    const holder = await child("হামযা");
    const aisha = await child("আয়েশা");
    const maryam = await child("মারইয়াম");
    const gA1 = await guardianOf(aisha);
    const gA2 = await guardianOf(aisha);
    const gM = await guardianOf(maryam);

    // While the copy is in, joining is refused — just borrow it.
    await expect(joinStoryWaitlist(gA1, aisha, t1)).rejects.toThrow(STORY_WAIT_ERRORS_BN.inNow);
    const loan = await issueBook("TRE-01-1", stu(holder), office.auth!.userId);
    // The child who has it can't queue for it.
    await expect(joinStoryWaitlist(office, holder, t1)).rejects.toThrow(STORY_WAIT_ERRORS_BN.hasIt);

    await joinStoryWaitlist(gA1, aisha, t1);
    await joinStoryWaitlist(gM, maryam, t1);
    await expect(joinStoryWaitlist(gA1, maryam, t1)).rejects.toThrow(); // another family's child
    let card = (await storyBookDetail(await resolveShelfViewer(gM, maryam), t1)).card;
    expect([card.childWaitStatus, card.childWaitPosition, card.waitingCount]).toEqual(["QUEUED", 2, 2]);

    await returnBook(loan._id.toString(), office.auth!.userId, new Date("2026-11-05T10:00:00+06:00"), { read: true });
    card = (await storyBookDetail(await resolveShelfViewer(gA1, aisha), t1)).card;
    expect([card.childWaitStatus, card.childWaitPosition]).toEqual(["READY", 0]);
    expect(card.childHoldUntil!.toISOString()).toBe(new Date("2026-11-09T23:59:59+06:00").toISOString());
    const notes = await Notification.find({ kind: "LIBRARY_HOLD_READY" }).lean();
    expect(notes.map((n) => n.recipientGuardianId?.toString()).sort()).toEqual([gA1.auth!.userId, gA2.auth!.userId].sort());
    expect(notes[0].bodyBn).toContain("আয়েশা");

    const waits = await childStoryWaits(gA2, aisha);
    expect(waits.map((w) => [w.title.titleBn, w.position])).toEqual([["বই 1", 0]]);

    // Aisha's family doesn't want it after all → it passes to Maryam, whose guardian is told.
    await leaveStoryWaitlist(gA2, aisha, t1);
    card = (await storyBookDetail(await resolveShelfViewer(gM, maryam), t1)).card;
    expect([card.childWaitStatus, card.childWaitPosition]).toEqual(["READY", 0]);
    expect(await Notification.countDocuments({ kind: "LIBRARY_HOLD_READY", recipientGuardianId: gM.auth!.userId })).toBe(1);
    await expect(leaveStoryWaitlist(gA1, aisha, t1)).rejects.toThrow(STORY_WAIT_ERRORS_BN.notWaiting);
  });

  it("caps a child at 2 waits, and the desk can add a child in person", async () => {
    const ids = await shelf(3);
    const holder = await child("হামযা");
    const aisha = await child("আয়েশা");
    const g = await guardianOf(aisha);
    for (const n of [1, 2, 3]) await issueBook(`TRE-0${n}-1`, stu(holder), office.auth!.userId, new Date()).catch(async () => {
      // the holder's own limit is 2 — lend the third to someone else
      await issueBook(`TRE-0${n}-1`, stu(await child("অন্য")), office.auth!.userId);
    });
    await joinStoryWaitlist(g, aisha, ids[0]);
    await joinStoryWaitlist(office, aisha, ids[1]); // the desk, in person
    await expect(joinStoryWaitlist(g, aisha, ids[2])).rejects.toThrow(STORY_WAIT_ERRORS_BN.cap);
    expect((await childStoryWaits(g, aisha)).map((w) => w.position)).toEqual([1, 1]);
  });
});

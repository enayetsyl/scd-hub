/**
 * YC-0 review - year filters on the readers that were private/hard to reach:
 *   notifications  teachersOfPair (via emitTeachingNotePublished): a 2027 class's teacher is
 *                  not told about a note while 2026 is current
 *   popup-notices  the classTeachersOnly staff audience: a 2027 section's class teacher is out
 * Skipped (private + impractical): printing `activeClassByLevel` (module-private helper inside
 * a GraphQL resolver file) and MeetingChainService `mySummaryWork` / the reminder sweep (they
 * return nothing without an open parent-meeting comment collection + roster, so a test would
 * pass with or without the filter).
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../modules/foundation/models/User";
import { Section } from "../modules/foundation/models/Section";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { Notification } from "../modules/notifications/models/Notification";
import { emitTeachingNotePublished } from "../modules/notifications/services/emitters";
import { normalizeAudience, resolveAudience } from "../modules/popup-notices/services/PopupAudienceService";
import { clearYearChangeFixtures, seedClasses, seedSections, seedYears, type ClassFixture, type YearFixture } from "./fixtures/yearChange";

jest.setTimeout(120_000);

let mongod: MongoMemoryServer;
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([User.init(), Notification.init(), RoutineSlot.init()]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

let y: YearFixture;
let c: ClassFixture;
let seq = 0;
async function teacher(name: string): Promise<string> {
  seq += 1;
  const r = await User.collection.insertOne({
    name,
    role: "TEACHER",
    phone: `88017100${String(seq).padStart(5, "0")}`,
    passwordHash: "x",
    active: true,
    additionalTemplates: [],
    grantedPermissions: [],
    revokedPermissions: [],
  });
  return r.insertedId.toString();
}

beforeEach(async () => {
  await clearYearChangeFixtures();
  await Promise.all([User.deleteMany({}), RoutineSlot.deleteMany({}), Notification.deleteMany({})]);
  y = await seedYears({ current: "2026" });
  c = await seedClasses(y);
});

test("teachersOfPair: only the 2026 class's teacher is told while 2026 is current", async () => {
  const t26 = await teacher("Teacher Y26");
  const t27 = await teacher("Teacher Y27");
  const sections = await seedSections(c);
  const slot = (teacherId: string, classId: Types.ObjectId, groupId: Types.ObjectId) => ({
    groupType: "section" as const,
    groupId,
    classId,
    dayOfWeek: "SUN",
    periodNumber: 1,
    subject: "BAN",
    track: "general",
    teacherId: new Types.ObjectId(teacherId),
    effectiveFrom: new Date("2026-01-01"),
    createdBy: new Types.ObjectId(),
  });
  await RoutineSlot.create([slot(t26, c.c3Y2026, sections.s3Y2026), slot(t27, c.c3Y2027, sections.s3Y2027)]);

  await emitTeachingNotePublished({
    noteId: new Types.ObjectId(),
    classLevel: 3,
    subject: "BAN",
    title: "Note",
    className: "Class 3",
    subjectLabel: "Bangla",
    uploadedBy: new Types.ObjectId(),
  });
  const got = (await Notification.find({ kind: "TEACHING_NOTE_PUBLISHED" }).lean()).map((n) => String(n.recipientUserId));
  expect(got).toEqual([t26]);
});

test("popup classTeachersOnly: a 2027 section's class teacher is out while 2026 is current", async () => {
  const ct26 = await teacher("CT Y26");
  const ct27 = await teacher("CT Y27");
  await Section.create([
    { classId: c.c3Y2026, code: "Main", nameBn: "S26", active: true, classTeacherId: new Types.ObjectId(ct26) },
    { classId: c.c3Y2027, code: "Main", nameBn: "S27", active: true, classTeacherId: new Types.ObjectId(ct27) },
  ]);
  const aud = normalizeAudience({ staff: { roles: ["TEACHER"], employment: "current", classTeachersOnly: true } });
  const out = await resolveAudience(aud);
  expect(out.recipients.map((r) => r.id.toString())).toEqual([ct26]);
});

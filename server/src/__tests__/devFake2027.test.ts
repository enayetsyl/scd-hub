/**
 * AL-2 - the fake-2027 generator frame + scenario 0 (docs/prd-academic-loop-2027.md section 9.3, D-#1677).
 *
 *   guard     refuses a non-`_dev` DB, a prod-equal URI, the 2026 year without --allow-2026, and --allow-2026
 *             for any scenario but 0
 *   dry run   prints a manifest, writes nothing
 *   scenario  lessons (class notes + deliveries) and attendance rows are created, tagged `devFakeRun`, on the
 *             fake days only (holiday skipped, Class 6 untouched), with ~5 % absences; lifecycle times fall on
 *             the fake day; NO Notification row from the run (muted) although a guardian would normally get one
 *   remove    deletes by the stamp across EVERY declared collection (residue 0), keeps untagged rows
 *   re-run    removes the previous run first
 * In-memory Mongo only; never a real database.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { HolidayException } from "../modules/routine/models/HolidayException";
import { ClassNote } from "../modules/routine/models/ClassNote";
import { LessonDelivery } from "../modules/lesson-progress/models/LessonDelivery";
import { StudentAttendanceDay } from "../modules/attendance/models/StudentAttendanceDay";
import { Notification } from "../modules/notifications/models/Notification";
import { User } from "../modules/foundation/models/User";
import { YearChangeRun } from "../modules/year-change/models/YearChangeRun";
import { DevFakeRun } from "../modules/platform/models/DevFakeRun";
import { publishClassNote } from "../modules/routine/services/RoutineTriggerService";
import { emit, setDevNotificationMute } from "../modules/notifications/services/NotificationService";
import { DevGuardError } from "../lib/devData/guards";
import { FAKE_BASE_MODELS, loadAllModels, resolveCollections } from "../lib/devData/collections";
import { fallbackStartKey, fakeRunId, removeFakeRun, runFake, seededRng, weekDayKeys } from "../lib/devData/devFake2027";
import { SCENARIOS, type Scenario } from "../lib/devData/scenarios";

jest.setTimeout(300_000);

let mongo: MongoMemoryServer;
const NOW = new Date(2026, 11, 2, 10, 30, 0); // Wed 2 Dec 2026 -> last Thursday = 26 Nov, 8 weeks = Sun 4 Oct .. Thu 26 Nov
const guard = { dbName: "scdtest_dev", outgoingOff: true, env: {} as NodeJS.ProcessEnv };
const HOLIDAY_KEY = "2026-10-11"; // a Sunday inside the window
let year26: Types.ObjectId;
let level6Section = "";
let c1Section = "";
let nurserySection = "";

const declared = (): string[] => resolveCollections([...FAKE_BASE_MODELS, ...SCENARIOS.flatMap((s) => s.collections)]).found.map((f) => f.model);
const taggedIn = async (runId?: string): Promise<Record<string, number>> => {
  const out: Record<string, number> = {};
  for (const m of declared()) {
    out[m] = await mongoose.model(m).collection.countDocuments(runId ? { devFakeRun: runId } : { devFakeRun: { $exists: true } });
  }
  return out;
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  mongoose.set("autoIndex", false);
  await mongoose.connect(mongo.getUri("scdtest_dev"));
  loadAllModels();
  await Promise.all(
    ([User, Guardian, ClassNote, LessonDelivery, StudentAttendanceDay, DevFakeRun, YearChangeRun, Notification, Student] as unknown as mongoose.Model<unknown>[]).map((m) => m.createIndexes()),
  );
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

async function seedWorld(): Promise<void> {
  for (const m of mongoose.modelNames()) await mongoose.model(m).deleteMany({});
  const [y] = await AcademicYear.create([{ label: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), current: true }]);
  year26 = y._id as Types.ObjectId;
  const [nur, c1, c6] = await Class.create([
    { level: -1, nameBn: "নার্সারি", academicYearId: year26 },
    { level: 1, nameBn: "প্রথম", academicYearId: year26 },
    { level: 6, nameBn: "ষষ্ঠ", academicYearId: year26 },
  ]);
  const teacher = new Types.ObjectId();
  const [sn, s1, s6] = await Section.create([
    { classId: nur._id, code: "A", nameBn: "নার্সারি", classTeacherId: teacher },
    { classId: c1._id, code: "A", nameBn: "প্রথম", classTeacherId: teacher },
    { classId: c6._id, code: "A", nameBn: "ষষ্ঠ", classTeacherId: teacher },
  ]);
  nurserySection = String(sn._id);
  c1Section = String(s1._id);
  level6Section = String(s6._id);
  let n = 0;
  const kids: Types.ObjectId[] = [];
  for (const sec of [sn, s1, s6]) {
    for (let i = 0; i < 12; i++) {
      const [st] = await Student.create([{ schoolId: `S-${++n}`, name: `Child ${n}`, classId: sec.classId, sectionId: sec._id, active: true }]);
      if (sec === s1 && i === 0) kids.push(st._id as Types.ObjectId);
    }
  }
  // a login-enabled guardian of a Class 1 child: a normal publish WOULD notify them
  const [g] = await Guardian.create([{ identifierKind: "phone", identifier: "01000000001", name: "G", loginEnabled: true, passwordHash: "x", active: true }]);
  await GuardianLink.create([{ guardianId: g._id, studentId: kids[0], relation: "mother" }]);
  // routine: one MATH period per school day for every section (incl. Class 6, which must stay untouched)
  for (const sec of [sn, s1, s6]) {
    for (const day of ["SUN", "MON", "TUE", "WED", "THU"]) {
      await RoutineSlot.create([
        {
          groupType: "section", groupId: sec._id, classId: sec.classId, dayOfWeek: day, periodNumber: 1, subject: "MATH", track: "general",
          teacherId: teacher, effectiveFrom: new Date("2020-01-01"), createdBy: new Types.ObjectId(),
        },
      ]);
    }
  }
  // Class 1 MATH has a plan of 3 sessions; Nursery has none
  for (const i of [1, 2, 3]) {
    await ContentArtifact.create([
      {
        docType: "session_plan", subject: "MATH", classLevel: 1, address: { anchorWord: "অধ্যায়", number: 1, title: "ch 1" },
        curationTag: "KEEP_AS_IS", reviewStatus: "reviewed", current: true, importedBy: new Types.ObjectId(),
        envelopeJson: { payload: { session_plan: { session_form: "multi_period", period_index: i, period_of: 3, session_title: `s${i}` } } },
      },
    ]);
  }
  await HolidayException.create([{ fromDate: new Date(2026, 9, 11), toDate: new Date(2026, 9, 11, 23, 59), type: "special", nameBn: "ছুটি" }]);
}

describe("pure helpers", () => {
  it("dates: 8 weeks from Sun 3 Jan 2027 and the 8 weeks ending last Thursday", () => {
    const d = weekDayKeys("2027-01-03", 8);
    expect(d).toHaveLength(40);
    expect(d[0]).toBe("2027-01-03");
    expect(d[39]).toBe("2027-02-25"); // Thursday of week 8
    expect(fallbackStartKey(NOW)).toBe("2026-10-04");
    const w = weekDayKeys(fallbackStartKey(NOW), 8);
    expect(w[w.length - 1]).toBe("2026-11-26");
    // today is a Thursday -> the previous Thursday
    expect(weekDayKeys(fallbackStartKey(new Date(2026, 11, 3)), 8).pop()).toBe("2026-11-26");
  });
  it("runId shape and seeded rng", () => {
    expect(fakeRunId(NOW)).toBe("fake-20261202-1030");
    const a = seededRng(7);
    const b = seededRng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("guards and year rule", () => {
  beforeAll(seedWorld);

  it("refuses a non-_dev database and a prod-equal URI", async () => {
    await expect(runFake({ apply: false, allow2026: true, now: NOW, guard: { ...guard, dbName: "scdhub" } })).rejects.toThrow(DevGuardError);
    const env = { MONGODB_URI: "mongodb://a@h:1/scdtest_dev", PROD_MONGODB_URI: "mongodb://b@h:1/scdtest_dev" } as NodeJS.ProcessEnv;
    await expect(runFake({ apply: false, allow2026: true, now: NOW, guard: { ...guard, env } })).rejects.toThrow(/PROD_MONGODB_URI/);
  });
  it("refuses the 2026 year without --allow-2026 (and a 2027 year not made by a year-change run)", async () => {
    await expect(runFake({ apply: false, now: NOW, guard })).rejects.toThrow(/year-change/);
    const y27 = await AcademicYear.create({ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31"), current: false });
    await expect(runFake({ apply: false, now: NOW, guard, year: String(y27._id) })).rejects.toThrow(/year-change/);
    await expect(runFake({ apply: false, now: NOW, guard, year: String(y27._id), allow2026: true, scenarioIds: [0] })).resolves.toBeTruthy();
    await y27.deleteOne();
  });
  it("accepts a 2027 year made by a year-change run and uses the 3 Jan 2027 weeks", async () => {
    const y27 = await AcademicYear.create({ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31"), current: true });
    await AcademicYear.updateOne({ _id: year26 }, { $set: { current: false } });
    await YearChangeRun.create({ runId: "yc-1", fromYearId: year26, toYearId: y27._id, status: "CUT_OVER" });
    const r = await runFake({ apply: false, now: NOW, guard });
    expect(r.manifest).toMatchObject({ dateMode: "2027", fromDateKey: "2027-01-03", toDateKey: "2027-02-25" });
    await YearChangeRun.deleteMany({});
    await y27.deleteOne();
    await AcademicYear.updateOne({ _id: year26 }, { $set: { current: true } });
  });
  it("--allow-2026 is for scenario 0 only", async () => {
    const other: Scenario = { id: 1, name: "x", collections: [], run: async () => ({}) };
    await expect(runFake({ apply: false, allow2026: true, now: NOW, guard }, [...SCENARIOS, other])).rejects.toThrow(/scenario 0 only/);
    await expect(runFake({ apply: false, allow2026: true, scenarioIds: [0], now: NOW, guard }, [...SCENARIOS, other])).resolves.toBeTruthy();
  });
  it("dry run prints the manifest and writes nothing", async () => {
    const lines: string[] = [];
    const r = await runFake({ apply: false, allow2026: true, now: NOW, guard, log: (l) => lines.push(l) });
    expect(r.applied).toBe(false);
    expect(r.manifest).toMatchObject({ runId: "fake-20261202-1030", dateMode: "2026-fallback", fromDateKey: "2026-10-04", toDateKey: "2026-11-26", sections: 2 });
    expect(r.manifest?.collections).toEqual(expect.arrayContaining(["classnotes", "lessondeliveries", "studentattendancedays", "notifications", "audits"]));
    expect(lines.join("\n")).toMatch(/manifest/);
    expect(await DevFakeRun.countDocuments({})).toBe(0);
    expect(await ClassNote.countDocuments({})).toBe(0);
    expect(await StudentAttendanceDay.countDocuments({})).toBe(0);
  });
});

describe("scenario 0 + remove + re-run", () => {
  beforeAll(seedWorld);
  let control: Types.ObjectId;

  it("creates tagged lessons + attendance on the fake days, muted, with ~5% absences", async () => {
    // Control: a normal (unmuted) publish DOES notify the guardian, proving the fixture would emit.
    const slot = await RoutineSlot.findOne({ groupId: c1Section, dayOfWeek: "SUN" });
    await publishClassNote({ slotId: String(slot?._id), date: new Date(2026, 8, 27), taughtSummaryBn: "real", actorId: String(slot?.teacherId), canManage: true });
    control = (await ClassNote.findOne({}))!._id as Types.ObjectId;
    expect(await Notification.countDocuments({})).toBe(1);

    const r = await runFake({ apply: true, allow2026: true, now: NOW, guard, seed: 42 });
    const runId = "fake-20261202-1030";
    expect(r.manifest?.runId).toBe(runId);
    const c = r.counts["0"];
    expect(c.daysSkipped).toBe(1); // the holiday
    expect(c.daysTaught).toBe(39);

    // class notes: Nursery + Class 1 only (Class 6 untouched), none on the holiday, all tagged, time on the day
    const notes = await ClassNote.collection.find({ devFakeRun: runId }).toArray();
    expect(notes.length).toBe(c.notes);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((n) => String(n.groupId) === level6Section)).toBe(false);
    expect(notes.some((n) => (n.date as Date).getTime() === new Date(2026, 9, 11).getTime())).toBe(false);
    for (const n of notes) {
      const d = n.date as Date;
      expect((n.publishedAt as Date).getFullYear()).toBe(d.getFullYear());
      expect((n.publishedAt as Date).getDate()).toBe(d.getDate());
      expect((n.publishedAt as Date).getHours()).toBe(13);
    }
    expect(await ClassNote.countDocuments({ _id: control, devFakeRun: { $exists: false } })).toBe(1);

    // deliveries: Class 1 MATH only, tagged; Nursery has no plan
    const deliveries = await LessonDelivery.collection.find({ devFakeRun: runId }).toArray();
    expect(deliveries.length).toBe(c.deliveries);
    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries.every((d) => String(d.sectionId) === c1Section)).toBe(true);
    expect(c.notesWithoutPlan).toBeGreaterThan(0);

    // attendance: one row per unit per school day, tagged, ~5% absent, marked at 09:00 on the day
    const days = await StudentAttendanceDay.collection.find({ devFakeRun: runId }).toArray();
    expect(days.length).toBe(c.attendanceUnitsMarked);
    expect(days.length).toBe(39 * 2);
    expect(days.some((d) => String(d.sectionId) === level6Section)).toBe(false);
    const absent = days.reduce((a, d) => a + (d.absentStudentIds as unknown[]).length, 0);
    expect(absent).toBe(c.absences);
    expect(absent).toBeGreaterThan(0);
    expect(absent / (39 * 24)).toBeLessThan(0.12);
    expect(days.every((d) => (d.markedAt as Date).getHours() === 9)).toBe(true);
    expect(days.some((d) => d.dateKey === HOLIDAY_KEY)).toBe(false);

    // muted: the run left no Notification (only the control row exists), and the mute is released again
    expect((await taggedIn(runId)).Notification).toBe(0);
    expect(await Notification.countDocuments({})).toBe(1);
    const manifestRow = await DevFakeRun.findOne({ runId }).lean();
    expect(manifestRow?.status).toBe("DONE");
    expect(manifestRow?.switchedOn).toEqual(["classNoteQuestionOn"]);
    const after = await emit({ recipientGuardianId: String(new Types.ObjectId()), kind: "CLASS_NOTE_PUBLISHED", titleBn: "t", bodyBn: "b", dedupeKey: "after-run" });
    expect(after.created).toBe(true);
  });

  it("the emit() mute is a plain switch: on = no row, off = row", async () => {
    setDevNotificationMute(true);
    const muted = await emit({ recipientGuardianId: String(new Types.ObjectId()), kind: "CLASS_NOTE_PUBLISHED", titleBn: "t", bodyBn: "b", dedupeKey: "muted-1" });
    setDevNotificationMute(false);
    expect(muted.created).toBe(false);
    expect(await Notification.countDocuments({ dedupeKey: "muted-1" })).toBe(0);
  });

  it("a re-run removes the previous run first and leaves exactly one manifest", async () => {
    const before = await ClassNote.countDocuments({ devFakeRun: "fake-20261202-1030" });
    expect(before).toBeGreaterThan(0);
    const r = await runFake({ apply: true, allow2026: true, now: new Date(NOW.getTime() + 60_000), guard, seed: 42 });
    expect(r.removedRuns).toEqual(["fake-20261202-1030"]);
    expect(await ClassNote.countDocuments({ devFakeRun: "fake-20261202-1030" })).toBe(0);
    expect(await DevFakeRun.countDocuments({})).toBe(1);
    expect(r.manifest?.runId).toBe("fake-20261202-1031");
    // same seed, same world: same counters
    expect(r.counts["0"].absences).toBeGreaterThan(0);
  });

  it("--remove leaves 0 tagged rows in EVERY declared collection and keeps untagged rows", async () => {
    const runId = "fake-20261202-1031";
    const tagged = await taggedIn(runId);
    expect(Object.values(tagged).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

    // dry run changes nothing
    await runFake({ apply: false, remove: runId, guard });
    expect(await ClassNote.countDocuments({ devFakeRun: runId })).toBeGreaterThan(0);

    const r = await runFake({ apply: true, remove: runId, guard });
    expect(Object.values(r.residue ?? {}).every((n) => n === 0)).toBe(true);
    expect(Object.keys(r.removed ?? {})).toEqual(expect.arrayContaining(["classnotes", "lessondeliveries", "studentattendancedays", "notifications"]));
    const residue = await taggedIn(); // ANY tag, every declared collection
    expect(Object.values(residue).every((n) => n === 0)).toBe(true);
    expect(await DevFakeRun.countDocuments({})).toBe(0);
    expect(await ClassNote.countDocuments({ _id: control })).toBe(1); // the untagged control note survives
    expect(await Notification.countDocuments({})).toBeGreaterThanOrEqual(1);
  });

  it("removeFakeRun on an unknown run id removes nothing and does not throw", async () => {
    const r = await removeFakeRun("fake-19990101-0000");
    expect(Object.values(r.removed).every((n) => n === 0)).toBe(true);
  });

  it("a failed scenario still tags what it wrote, so --remove cleans it", async () => {
    const boom: Scenario = {
      id: 0,
      name: "boom",
      collections: [{ model: "ClassNote" }],
      run: async () => {
        await ClassNote.create({ slotId: new Types.ObjectId(), groupType: "section", groupId: new Types.ObjectId(), date: new Date(), subject: "MATH", taughtSummaryBn: "x", publishedBy: new Types.ObjectId(), publishedAt: new Date() });
        throw new Error("boom");
      },
    };
    await expect(runFake({ apply: true, allow2026: true, now: new Date(NOW.getTime() + 120_000), guard }, [boom])).rejects.toThrow("boom");
    const id = "fake-20261202-1032";
    expect((await DevFakeRun.findOne({ runId: id }).lean())?.status).toBe("FAILED");
    expect(await ClassNote.countDocuments({ devFakeRun: id })).toBe(1);
    await removeFakeRun(id, [boom]);
    expect(await ClassNote.countDocuments({ devFakeRun: { $exists: true } })).toBe(0);
  });
});

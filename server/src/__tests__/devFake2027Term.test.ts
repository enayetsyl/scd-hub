/**
 * AL-15 - the realistic fake 2027 term (scenario 9) on the generator frame (docs/dev-test-scenarios-2027.md).
 *
 *   pure      personas: every special persona exists, rates, the leave plan, the C3 climb
 *   run       a 3-week `--until` run in an in-memory world: lessons, attendance by persona, homework, the weekly assignment,
 *             class work / tests, leave with covers, the guaranteed events (moved into the window with the test knob), the report
 *   calendar  seeded (holidays, pauses, exam + routine), KEPT by a plain `--remove`, adopted by the next run, dropped by `--remove-calendar`
 *   remove    residue 0 in every declared collection; nothing grows except the calendar rows (until they are removed too)
 * In-memory Mongo only; never a real database.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { User } from "../modules/foundation/models/User";
import { StaffProfile } from "../modules/foundation/models/StaffProfile";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { HolidayException } from "../modules/routine/models/HolidayException";
import { AcademicPause } from "../modules/academic-pause/models/AcademicPause";
import { Exam } from "../modules/exams/models/Exam";
import { ExamRoutine } from "../modules/exams/models/ExamRoutine";
import { YearChangeRun } from "../modules/year-change/models/YearChangeRun";
import { DevFakeRun } from "../modules/platform/models/DevFakeRun";
import { AssignmentSchedule } from "../modules/trackers/models/AssignmentSchedule";
import { ClassNote } from "../modules/routine/models/ClassNote";
import { Notification } from "../modules/notifications/models/Notification";
import { Guardian } from "../modules/foundation/models/Guardian";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { MarkEscalation } from "../modules/trackers/models/MarkReminder";
import { GuardianSummaryRun } from "../modules/mastery/models/GuardianSummaryRun";
import { planClassTests } from "../lib/devData/term/tests";
import { importCatalogue, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { FAKE_BASE_MODELS, loadAllModels, resolveCollections } from "../lib/devData/collections";
import { removeFakeRun, runFake, seededRng, dayKeysUntil } from "../lib/devData/devFake2027";
import { SCENARIOS } from "../lib/devData/scenarios";
import { assignChildPersonas, assignTeacherPersonas, abilityOn, absenceChance, CHILD_PERSONAS, hwWeight, type ChildPersona } from "../lib/devData/term/personas";
import { planLeaves, GUARANTEED_LEAVE_FROM, GUARANTEED_LEAVE_TO } from "../lib/devData/term/staff";
import { Sim } from "../lib/devData/term/state";
import { isExamDay, isPrepDay, DEV_HOLIDAYS } from "../lib/devData/term/calendar";

jest.unmock("../modules/academic-pause/services/AcademicPauseService");
jest.setTimeout(900_000);

let mongo: MongoMemoryServer;
const NOW = new Date(2026, 11, 2, 10, 30, 0);
const guard = { dbName: "scdterm_dev", outgoingOff: true, env: {} as NodeJS.ProcessEnv };
const LO3 = "LO-C3-MATH-01-01";
const LO1 = "LO-C1-MATH-01-01";
const LO1E = "LO-C1-ENG-01-01";
const CALENDAR_COLLECTIONS = new Set(["holidayexceptions", "academicpauses", "exams", "examroutines"]);

const countsOfAll = async (): Promise<Record<string, number>> => {
  const out: Record<string, number> = {};
  for (const m of mongoose.modelNames()) {
    const c = mongoose.model(m).collection;
    out[c.collectionName] = await c.countDocuments({});
  }
  return out;
};
const KEPT_BY_DESIGN = /sequences?$|masterypolicies$|masteryenablements$|masterytags$|lessonprogressconfigs$/i; // the class-note question switch is config (recorded in switchedOn)
const leftovers = async (before: Record<string, number>): Promise<Record<string, number>> => {
  const after = await countsOfAll();
  const out: Record<string, number> = {};
  for (const [coll, n] of Object.entries(after)) {
    if (KEPT_BY_DESIGN.test(coll)) continue;
    const grew = n - (before[coll] ?? 0);
    if (grew > 0) out[coll] = grew;
  }
  return out;
};
const taggedTotal = async (runId: string): Promise<number> => {
  let n = 0;
  for (const f of resolveCollections([...FAKE_BASE_MODELS, ...SCENARIOS.flatMap((s) => s.collections)]).found) {
    n += await mongoose.model(f.model).collection.countDocuments({ devFakeRun: runId });
  }
  return n;
};

// ---------------------------------------------------------------------------
describe("personas (pure)", () => {
  it("the persona mix of a 91-child school has the 2026 top decile: homework miss p50 ~19 % / p90 ~47 %, assignment miss p50 ~8 % / p90 ~42 %", () => {
    const sizes: Record<number, number> = { [-1]: 21, 0: 12, 1: 7, 2: 14, 3: 17, 4: 12, 5: 8 };
    const byLevel = new Map<number, string[]>(Object.entries(sizes).map(([l, n]) => [Number(l), Array.from({ length: n }, (_, i) => `${l}-${i}`)]));
    const m = assignChildPersonas(seededRng(21), byLevel);
    const hw = [...m.values()].map((p) => CHILD_PERSONAS[p].hwMiss).sort((a, b) => a - b);
    const as = [...m.values()].map((p) => CHILD_PERSONAS[p].asMiss).sort((a, b) => a - b);
    const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
    expect(q(hw, 0.5)).toBeGreaterThan(0.14);
    expect(q(hw, 0.5)).toBeLessThan(0.24);
    expect(q(hw, 0.9)).toBeGreaterThan(0.4);
    expect(q(hw, 0.9)).toBeLessThan(0.6);
    expect(q(as, 0.5)).toBeLessThan(0.1);
    expect(q(as, 0.9)).toBeGreaterThan(0.3);
    expect(q(as, 0.9)).toBeLessThan(0.5);
  });
  it("every special persona exists across a school and the rest are typical", () => {
    const byLevel = new Map<number, string[]>([
      [-1, Array.from({ length: 6 }, (_, i) => `n${i}`)],
      [1, Array.from({ length: 8 }, (_, i) => `a${i}`)],
      [3, Array.from({ length: 12 }, (_, i) => `c${i}`)],
    ]);
    const m = assignChildPersonas(seededRng(7), byLevel);
    expect(m.size).toBe(26);
    const seen = new Set(m.values());
    for (const p of ["TYPICAL", "C1", "C2", "C3", "C4", "C5", "C6", "C7"] as ChildPersona[]) expect(seen.has(p)).toBe(true);
    // level 3 is the weak level: more struggling children there than in level 1
    const c2 = (lvl: string) => [...m.entries()].filter(([id, p]) => id.startsWith(lvl) && p === "C2").length;
    expect(c2("c")).toBeGreaterThan(c2("a"));
    // reproducible by seed
    expect([...assignChildPersonas(seededRng(7), byLevel).entries()]).toEqual([...m.entries()]);
  });
  it("teacher personas: each of T1..T4 at least once with 5 teachers", () => {
    const m = assignTeacherPersonas(seededRng(3), ["a", "b", "c", "d", "e"]);
    expect(new Set(m.values())).toEqual(new Set(["T1", "T2", "T3", "T4"]));
  });
  it("absence follows the 2026 weekday shape, a test day lifts it, C3 climbs, BAN is rare in C2/C3", () => {
    const t = CHILD_PERSONAS.TYPICAL;
    expect(absenceChance(t, 0)).toBeGreaterThan(absenceChance(t, 3)); // Sunday > Wednesday
    expect(absenceChance(t, 2, true)).toBeCloseTo(absenceChance(t, 2) * 1.3, 5);
    expect(abilityOn(CHILD_PERSONAS.C3, 1)).toBeGreaterThan(abilityOn(CHILD_PERSONAS.C3, 0) + 0.3);
    expect(abilityOn(CHILD_PERSONAS.C1, 1)).toBe(CHILD_PERSONAS.C1.ability);
    expect(hwWeight("BAN", 2)).toBeLessThan(hwWeight("BAN", 4));
    expect(hwWeight("ENG", 1)).toBeGreaterThan(hwWeight("ISLAM", 1));
  });
  it("the leave plan: a guaranteed 5-day sick leave in March, mostly 1-day leaves, no overlaps per teacher", () => {
    const days = dayKeysUntil("2027-01-03", "2027-06-30").filter((d) => !DEV_HOLIDAYS.some((h) => d >= h.fromKey && d <= h.toKey));
    const sim = new Sim({ rng: seededRng(11) } as never, []);
    sim.openDays = days;
    for (const [i, id] of ["t1", "t2", "t3", "t4", "t5", "t6"].entries()) sim.teacherPersona.set(id, (["T1", "T2", "T3", "T4", "T1", "T4"] as const)[i]!);
    const plan = planLeaves(sim);
    const g = plan.find((l) => l.guaranteed);
    expect(g).toMatchObject({ fromKey: GUARANTEED_LEAVE_FROM, toKey: GUARANTEED_LEAVE_TO, leaveType: "sick" });
    expect(plan.filter((l) => l.fromKey === l.toKey).length).toBeGreaterThan(plan.length / 2);
    for (const t of ["t1", "t2", "t3", "t4", "t5", "t6"]) {
      const mine = plan.filter((l) => l.teacherId === t);
      for (const a of mine) for (const b of mine) if (a !== b) expect(a.toKey < b.fromKey || b.toKey < a.fromKey).toBe(true);
    }
    expect(isExamDay("2027-06-15") && !isExamDay("2027-06-05") && isPrepDay("2027-06-08")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("the realistic term in an in-memory world", () => {
  let yearId: Types.ObjectId;
  const sections: Record<string, string> = {};

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    mongoose.set("autoIndex", false);
    await mongoose.connect(mongo.getUri("scdterm_dev"));
    loadAllModels();
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));

    const [y] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31"), current: true }]);
    yearId = y._id as Types.ObjectId;
    await YearChangeRun.create({ runId: "yc-term", fromYearId: new Types.ObjectId(), toYearId: yearId, status: "CUT_OVER" });
    const [nur, c1, c3] = await Class.create([
      { level: -1, nameBn: "নার্সারি", academicYearId: yearId },
      { level: 1, nameBn: "প্রথম", academicYearId: yearId },
      { level: 3, nameBn: "তৃতীয়", academicYearId: yearId },
    ]);
    // five teachers, each a User + a StaffProfile on the same phone (the leave service joins them by phone)
    const teachers: Types.ObjectId[] = [];
    for (let i = 1; i <= 5; i++) {
      const phone = `0171000000${i}`;
      const [u] = await User.create([{ role: "TEACHER", name: `Teacher ${i}`, phone, passwordHash: "x" }]);
      await StaffProfile.create({ schoolId: `T-${i}`, name: `Teacher ${i}`, category: "teacher", phone, employmentType: "full_time", employmentStatus: "confirmed", active: true });
      teachers.push(u._id as Types.ObjectId);
    }
    await User.create({ role: "PRINCIPAL", name: "Head", phone: "01700000088", passwordHash: "x" });
    const [sn, s1, s3] = await Section.create([
      { classId: nur._id, code: "A", nameBn: "নার্সারি", classTeacherId: teachers[4] },
      { classId: c1._id, code: "A", nameBn: "প্রথম", classTeacherId: teachers[0] },
      { classId: c3._id, code: "B", nameBn: "তৃতীয় (বালক)", classTeacherId: teachers[2] },
    ]);
    sections.nursery = String(sn._id);
    sections.c1 = String(s1._id);
    sections.c3 = String(s3._id);
    let n = 0;
    for (const [sec, count] of [[sn, 6], [s1, 8], [s3, 12]] as const) {
      for (let i = 0; i < count; i++) {
        n++;
        await Student.create({ schoolId: `TERM-${n}`, name: `Child ${n}`, classId: sec.classId, sectionId: sec._id, active: true });
      }
    }
    // routine: Class 1 MATH (t0) + ENG (t1), Class 3 MATH (t2) + ENG (t3), Nursery ENG (t4), every school day
    const plan: Array<[typeof sn, number, string, Types.ObjectId]> = [
      [s1, 1, "MATH", teachers[0]!], [s1, 2, "ENG", teachers[1]!], [s3, 1, "MATH", teachers[2]!], [s3, 2, "ENG", teachers[3]!], [sn, 1, "ENG", teachers[4]!],
    ];
    for (const [sec, period, subject, teacherId] of plan) {
      for (const day of ["SUN", "MON", "TUE", "WED", "THU"]) {
        await RoutineSlot.create([{ groupType: "section", groupId: sec._id, classId: sec.classId, dayOfWeek: day, periodNumber: period, subject, track: "general", teacherId, effectiveFrom: new Date("2020-01-01"), createdBy: new Types.ObjectId() }]);
      }
    }
    for (const [level, subject] of [[1, "MATH"], [3, "MATH"], [1, "ENG"]] as const) {
      for (const i of [1, 2, 3, 4, 5, 6]) {
        await ContentArtifact.create([{ docType: "session_plan", subject, classLevel: level, address: { anchorWord: "অধ্যায়", number: 1, title: "ch 1" }, curationTag: "KEEP_AS_IS", reviewStatus: "reviewed", current: true, importedBy: new Types.ObjectId(), envelopeJson: { payload: { session_plan: { session_form: "multi_period", period_index: i, period_of: 6, session_title: `s${i}` } } } }]);
      }
    }
    const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
    for (const [token, subject, lo, level] of [["C1", "MATH", LO1, 1], ["C3", "MATH", LO3, 3], ["C1", "ENG", LO1E, 1]] as const) {
      const cat = await importCatalogue(
        JSON.stringify({
          classToken: token, subject, status: "LOCKED", chapters: [{ number: 1, titleBn: "সংখ্যা" }],
          outcomes: [{ code: lo, labelBn: "সংখ্যা চেনা", assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] }],
          questionTypes: [{ code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: 2 }],
        }),
        true,
        PRINCIPAL,
      );
      if (!cat.ok) throw new Error(cat.errors.join("; "));
      await setEnablement(String(yearId), token, subject, true, PRINCIPAL);
      for (let k = 1; k <= 160; k++) {
        await ContentArtifact.create([{ docType: "question", classLevel: level, subject, address: { anchorWord: "অধ্যায়", number: 1 }, curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold", envelopeJson: { tags: { topic_tag: lo }, payload: { qid: `QP-${subject}-${token}-U01-Q95${String(k).padStart(3, "0")}`, topic_tag: lo, marks: 2, question_text: `প্রশ্ন ${k}` } } }]);
      }
    }
    // the weekly rotation: Class 1 MATH and Class 3 MATH every week of the 4-week cycle
    await AssignmentSchedule.create({
      academicYearId: yearId, termStartDate: new Date(2027, 0, 3), deliveryDayOfWeek: 4, dueDayOfWeek: 0,
      entries: [1, 2, 3, 4].flatMap((cycleWeek) => [
        { cycleWeek, classId: c1._id, classLevel: 1, sectionId: s1._id, subject: "MATH", teacherId: teachers[0] },
        { cycleWeek, classId: c1._id, classLevel: 1, sectionId: s1._id, subject: "ENG", teacherId: teachers[1] },
        { cycleWeek, classId: c3._id, classLevel: 3, sectionId: s3._id, subject: "MATH", teacherId: teachers[2] },
      ]),
    });
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it("a 3-week run produces the whole term's data, the guaranteed events, the calendar and the report; --remove keeps the calendar until asked", async () => {
    const before = await countsOfAll();
    // Rows a tester (the dev API runs on the dev clock) or anyone else wrote: dated 2027 by createdAt or by ObjectId time, never tagged.
    const futureId = Types.ObjectId.createFromTime(Math.floor(new Date("2027-02-01T05:00:00Z").getTime() / 1000));
    await ClassNote.collection.insertOne({ _id: futureId, createdAt: new Date("2027-02-01"), date: new Date("2027-02-01"), taughtSummaryBn: "tester", tester: true });
    await HomeworkItem.collection.insertOne({ tester: true, createdAt: new Date("2027-01-20T05:00:00Z"), description: "tester homework" });
    await MarkEscalation.collection.insertOne({ tester: true, dateKey: "2099-01-01", _id: Types.ObjectId.createFromTime(Math.floor(new Date("2027-03-01").getTime() / 1000)) });
    const survivors = async () => ({
      notes: await ClassNote.countDocuments({ tester: true, devFakeRun: { $exists: false } }),
      hw: await HomeworkItem.countDocuments({ tester: true, devFakeRun: { $exists: false } }),
      esc: await MarkEscalation.countDocuments({ tester: true, devFakeRun: { $exists: false } }),
    });
    expect(await survivors()).toEqual({ notes: 1, hw: 1, esc: 1 });
    const baseline = await countsOfAll();
    const lines: string[] = [];
    const r = await runFake({
      apply: true, now: NOW, guard, seed: 5, until: "2027-01-21", log: (l) => lines.push(l),
      // the events of the spec sit in Feb-May: pull them into the 3-week window
      eventDays: { C8: "2027-01-10", C9: "2027-01-17", T7: "2027-01-06", T8: "2027-01-04", S4: "2027-01-12", C7a: "2027-01-05", C7b: "2027-01-11", C7c: "2027-01-13", C7d: "2027-01-18" },
    });
    const runId = r.manifest!.runId;
    expect(r.manifest).toMatchObject({ until: "2027-01-21", scenarioIds: [9] });
    expect(await survivors()).toEqual({ notes: 1, hw: 1, esc: 1 }); // the tester's rows were not swept into the run
    const c = r.counts["9"]!;

    // lessons + attendance by persona
    expect(c.notes).toBeGreaterThan(20);
    expect(c.deliveries).toBeGreaterThan(0);
    expect(c.attendanceUnitsMarked).toBeGreaterThan(20);
    expect(c.absences).toBeGreaterThan(0);
    // homework, class work, class tests
    expect(c.hwDeclared).toBeGreaterThan(0);
    expect(c.hwIssued).toBe(c.hwDeclared);
    expect(c.hwSubmitted).toBeGreaterThan(0);
    expect((c.cwPapers ?? 0) + (c.ctWithSheet ?? 0) + (c.ctWithoutSheet ?? 0)).toBeGreaterThan(0);
    // the weekly cycle through ASDRAFT + finalise
    expect(c.asDrafts).toBeGreaterThan(0);
    expect(c.asSent).toBeGreaterThan(0);
    expect(c.asDrafts).toBeGreaterThanOrEqual(c.asSent!);
    // the Wednesday guardian run advanced its bookkeeping, nothing was notified
    expect(c.guardianSummaryRuns).toBe(3);
    expect(await Notification.countDocuments({})).toBe(0);
    // every run row is tagged and notes sit on the fake days (published ~6 h after the period, on the same fake day)
    expect(await ClassNote.countDocuments({ devFakeRun: { $exists: false }, tester: { $ne: true } })).toBe(0);
    const someNotes = await ClassNote.collection.find({ devFakeRun: { $exists: true } }).limit(40).toArray();
    expect(someNotes.length).toBeGreaterThan(0);
    for (const n of someNotes) {
      const d = new Date(n.date as Date);
      const p = new Date(n.publishedAt as Date);
      expect([p.getFullYear(), p.getMonth(), p.getDate()]).toEqual([d.getFullYear(), d.getMonth(), d.getDate()]);
      expect(p.getHours()).toBeGreaterThanOrEqual(13);
    }
    // the run's bookkeeping never blocks the dev site: no 09:30 snapshot on the last day, the guardian run log back to its pre-run value (none)
    expect(await MarkEscalation.countDocuments({ dateKey: "2027-01-21", tester: { $ne: true } })).toBe(0);
    expect(await GuardianSummaryRun.countDocuments({})).toBe(0);
    // the late joiner has a tagged guardian login
    expect(await Guardian.countDocuments({ devFakeRun: runId })).toBe(1);

    // the manifest carries ids only (no names) + the persona map
    const man = (await DevFakeRun.findOne({ runId }).lean())!;
    const kids = (man.personas as { children: Record<string, string[]> }).children;
    for (const p of ["C1", "C2", "C3", "C4", "C5", "C6", "C7"]) expect((kids[p] ?? []).length).toBeGreaterThan(0);
    expect(JSON.stringify(man.personas)).not.toMatch(/Child \d/);
    expect(man.status).toBe("DONE");

    // the guaranteed events: the ones that can sit in a 3-week window, with a status each
    const events = (man.events as Array<{ id: string; status: string; produced: string }>);
    const byId = new Map(events.map((e) => [e.id, e]));
    for (const id of ["C1", "C2", "C3", "C4", "C5", "C6", "T1", "T2", "T3", "T4", "C10", "S1", "S2", "S3", "S6", "T5", "T6", "T7", "T8", "C8", "C9", "S4", "C7a", "C7b", "C7c", "C7d"]) {
      expect(byId.has(id)).toBe(true);
    }
    expect(byId.get("C8")!.status).toBe("placed");
    expect(["placed", "partly"]).toContain(byId.get("T7")!.status); // two 360-minute drafts built; a refusal only shows when their counted minutes pass the cap
    expect(byId.get("T8")!.status).toBe("placed"); // re-teach proposed -> decided -> re-test -> closed
    expect(byId.get("S4")!.status).toBe("placed");
    for (const id of ["C7a", "C7b", "C7c", "C7d"]) expect(byId.get(id)!.status).toBe("placed"); // an integrity case each, with its outcome
    expect(c.integrityCasesOpened).toBeGreaterThanOrEqual(4);
    expect(c.integrityOutcomes).toBe(4);
    expect(byId.get("T4b")!.status).toBe("not placed"); // the 21-25 March leave is outside a 3-week window
    expect(c.leaveApproved).toBeGreaterThan(0); // the planned 1-3 day leaves of the window, with covers
    expect(c.coversAssigned).toBeGreaterThan(0);
    expect(byId.get("C9")!.status).toBe("placed");
    expect(byId.get("S3")!.status).toBe("not placed"); // honest: a real merge is not generated
    expect(c.lateJoiners).toBe(1);
    expect(c.leavers).toBe(1);
    // the late joiner has no attendance before 10 Jan; the leaver none after leaving
    const joiner = await Student.findOne({ schoolId: new RegExp(`-J1$`) }).lean();
    expect(joiner).toBeTruthy();
    // the report: rates next to targets, persona table, scenarios
    const text = lines.join("\n");
    expect(text).toMatch(/achieved rates vs section 1 targets/);
    expect(text).toMatch(/Daily absence, mean: target 10\.8 % \| achieved/);
    expect(text).toMatch(/=== scenarios ===/);
    const rates = (man.rates as Array<{ area: string; achieved: string }>);
    const absence = Number(rates.find((x) => x.area === "Daily absence, mean")!.achieved.replace(" %", ""));
    expect(absence).toBeGreaterThan(4);
    expect(absence).toBeLessThan(22);
    // loose bands (a 3-week window of ~26 children is noisy): homework / assignment miss, class-test mean, test-day absence
    const num = (area: string, i = 0): number => Number(rates.find((x) => x.area.startsWith(area))!.achieved.split("/")[i]!.replace(/[^0-9.]/g, ""));
    expect(num("Homework non-submission", 0)).toBeLessThan(40);
    expect(num("Homework non-submission", 1)).toBeGreaterThan(15);
    expect(num("Assignment miss")).toBeLessThan(35);
    expect(num("Class test mean score")).toBeGreaterThan(40);
    expect(num("Class test mean score")).toBeLessThan(95);
    expect(num("Absent on a class-test day")).toBeLessThan(55);

    // the dev calendar: seeded once, tagged, kept by a plain remove
    const calCounts = async () => ({
      holidays: await HolidayException.countDocuments({ devCalendar: true }),
      pauses: await AcademicPause.countDocuments({ devCalendar: true }),
      exam: await Exam.countDocuments({ devCalendar: true }),
      routine: await ExamRoutine.countDocuments({ devCalendar: true }),
    });
    expect(await calCounts()).toEqual({ holidays: 4, pauses: 2, exam: 1, routine: 1 });
    const exam = await Exam.findOne({ academicYearId: yearId, term: "HALF_YEARLY" }).lean();
    expect(exam).toMatchObject({ startDateKey: "2027-06-13", endDateKey: "2027-06-24" });

    expect(await taggedTotal(runId)).toBeGreaterThan(100);
    const gone = await removeFakeRun(runId); // plain remove: the calendar stays
    expect(Object.values(gone.residue).reduce((a, b) => a + b, 0)).toBe(0);
    expect(await calCounts()).toEqual({ holidays: 4, pauses: 2, exam: 1, routine: 1 });
    const left = await leftovers(baseline);
    expect(Object.keys(left).filter((k) => !CALENDAR_COLLECTIONS.has(k))).toEqual([]);

    // the next run ADOPTS the calendar (no twins), and `--remove-calendar` drops it
    const r2 = await runFake({ apply: true, now: new Date(NOW.getTime() + 60_000), guard, seed: 6, scenarioIds: [9], until: "2027-01-07" });
    expect(r2.calendar).toMatchObject({ holidaysCreated: 0, pausesCreated: 0 }); // adopted by the frame, no twins
    expect(await calCounts()).toEqual({ holidays: 4, pauses: 2, exam: 1, routine: 1 });
    const gone2 = await removeFakeRun(r2.manifest!.runId, SCENARIOS, { calendar: true });
    expect(Object.values(gone2.residue).reduce((a, b) => a + b, 0)).toBe(0);
    expect(await calCounts()).toEqual({ holidays: 0, pauses: 0, exam: 0, routine: 0 });
    expect(await survivors()).toEqual({ notes: 1, hw: 1, esc: 1 }); // after a run + --remove + --remove-calendar
    // only the tester rows remain
    await ClassNote.collection.deleteMany({ tester: true });
    await HomeworkItem.collection.deleteMany({ tester: true });
    await MarkEscalation.collection.deleteMany({ tester: true });
    expect(await leftovers(before)).toEqual({});
  });

  it("the calendar never rewrites real rows: overlapping holiday, real exam dates + routine kept, empty exam dates written and cleared again, a guardian run log put back", async () => {
    const before = await countsOfAll();
    // a real holiday inside the Eid window, a real half-yearly exam with its own dates and its own routine
    await HolidayException.create({ fromDate: new Date(2027, 2, 10), toDate: new Date(2027, 2, 11, 23, 59), type: "eid", nameBn: "আসল ছুটি" });
    const exam = await Exam.create({ academicYearId: yearId, term: "HALF_YEARLY", name: "real", startDateKey: "2027-06-20", endDateKey: "2027-07-01", status: "PLANNED", failRule: "ANY_SUBJECT_F", createdBy: new Types.ObjectId() });
    await ExamRoutine.create({ examId: exam._id, slots: [], updatedBy: new Types.ObjectId() });
    const guardianRunBefore = new Date("2026-12-01T10:00:00Z");
    await GuardianSummaryRun.create({ key: "GWSUM", lastRunAt: guardianRunBefore });
    const r = await runFake({ apply: true, now: new Date(NOW.getTime() + 300_000), guard, seed: 8, scenarioIds: [9], until: "2027-01-07" });
    expect(r.calendar).toMatchObject({ holidaysCreated: 3, holidaysExisting: 1, examDatesSet: false, examCreated: false, routineLeftAlone: true });
    expect(await Exam.findById(exam._id).lean()).toMatchObject({ startDateKey: "2027-06-20", endDateKey: "2027-07-01" });
    expect(await ExamRoutine.countDocuments({ examId: exam._id })).toBe(1);
    expect(await ExamRoutine.countDocuments({ devCalendar: true })).toBe(0);
    // the pause windows follow the REAL exam window (prep week 13-17 Jun, exam 20 Jun - 1 Jul)
    expect(await AcademicPause.findOne({ devCalendar: true, fromKey: "2027-06-20", toKey: "2027-07-01" })).toBeTruthy();
    expect(await AcademicPause.findOne({ devCalendar: true, fromKey: "2027-06-13", toKey: "2027-06-17" })).toBeTruthy();
    expect((await GuardianSummaryRun.findOne({ key: "GWSUM" }).lean())!.lastRunAt.toISOString()).toBe(guardianRunBefore.toISOString());
    await removeFakeRun(r.manifest!.runId, SCENARIOS, { calendar: true });
    expect(await HolidayException.countDocuments({ nameBn: "আসল ছুটি" })).toBe(1);
    expect(await Exam.findById(exam._id).lean()).toMatchObject({ startDateKey: "2027-06-20", endDateKey: "2027-07-01" });
    expect(await ExamRoutine.countDocuments({ examId: exam._id })).toBe(1);

    // an exam with BOTH dates empty gets the dev dates, marked; the calendar removal clears exactly those
    await Exam.collection.updateOne({ _id: exam._id }, { $set: { startDateKey: null, endDateKey: null } });
    await ExamRoutine.deleteMany({});
    const r2 = await runFake({ apply: true, now: new Date(NOW.getTime() + 360_000), guard, seed: 9, scenarioIds: [9], until: "2027-01-07" });
    expect(r2.calendar).toMatchObject({ examDatesSet: true, examCreated: false });
    expect(await Exam.findById(exam._id).lean()).toMatchObject({ startDateKey: "2027-06-13", endDateKey: "2027-06-24" });
    await removeFakeRun(r2.manifest!.runId, SCENARIOS, { calendar: true });
    const after = await Exam.findById(exam._id).lean();
    expect(after).toBeTruthy();
    expect(after!.startDateKey ?? null).toBeNull();
    expect(after!.endDateKey ?? null).toBeNull();
    await Exam.deleteOne({ _id: exam._id });
    await HolidayException.deleteMany({ nameBn: "আসল ছুটি" });
    await GuardianSummaryRun.deleteMany({});
    expect(await leftovers(before)).toEqual({});
  });

  it("class tests are never planned in the preparation week", async () => {
    const days = dayKeysUntil("2027-01-03", "2027-06-30");
    const sim = new Sim({ rng: seededRng(4), academicYearId: String(yearId) } as never, [{ sectionId: sections.c1!, classId: "x", level: 1, nameBn: "প্রথম" }]);
    sim.teachDays = days;
    sim.subjectDays.set(`${sections.c1}|MATH`, new Set([0, 1, 2, 3, 4]));
    const weekOf = (k: string): number => Math.floor((Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) - Date.UTC(2027, 0, 3)) / (7 * 86_400_000));
    await planClassTests(sim, weekOf);
    expect(sim.ctPlan.size).toBeGreaterThan(5);
    for (const key of sim.ctPlan.keys()) expect(isPrepDay(key.split("|")[1]!)).toBe(false);
    expect([...sim.ctPlan.keys()].some((k) => k.split("|")[1]! >= "2027-06-06" && k.split("|")[1]! <= "2027-06-10")).toBe(false);
  });
});

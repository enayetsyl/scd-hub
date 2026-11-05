/**
 * AS-5 — activity-sheet reports (D-#988).
 *
 *   skills    finished (not অসম্পূর্ণ) per skill area, all-correct %, children; class × skill grid
 *   banks     given / back / all-correct % / repeats / tray vs guardian per bank; levels with
 *             "too hard" when 5+ came back under 40% all correct; a bank nobody took
 *   children  per child counts + favourite skill; per section totals; the window cuts old rows
 *
 * In-memory MongoDB; rows written straight (the services that make them are tested elsewhere).
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { ActivityBank } from "../modules/activity-sheets/models/ActivityBank";
import { ActivitySheet } from "../modules/activity-sheets/models/ActivitySheet";
import { ActivityIssue } from "../modules/activity-sheets/models/ActivityIssue";
import { ActivitySettings } from "../modules/activity-sheets/models/ActivitySettings";
import { activityBankReport, activityChildrenReport, activitySkillReport } from "../modules/activity-sheets/services/ActivityReportService";

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
  await Promise.all([Class, Section, Student, ActivityBank, ActivitySheet, ActivityIssue, ActivitySettings].map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
});

const NOW = new Date("2026-11-05T06:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);

async function bank(code: string, skillArea: string) {
  const b = await ActivityBank.create({ code, nameBn: `ব্যাংক ${code}`, skillArea, status: "PUBLISHED", levelClasses: { E: [0], M: [1], H: [2] } });
  const sheets = await ActivitySheet.insertMany(
    ["E", "M"].flatMap((level) => [1, 2, 3, 4, 5, 6].map((seq) => ({ itemId: `${code}-${level}-00${seq}`, bankId: b._id, level, seq, classLevels: [0], active: true }))),
  );
  return { b, sheets };
}
async function kid(level: number, name: string, sectionNameBn: string) {
  const c = await Class.collection.insertOne({ level, nameBn: `L${level}`, academicYearId: new Types.ObjectId(), active: true });
  const s = await Section.collection.insertOne({ classId: c.insertedId, nameBn: sectionNameBn, code: "A", active: true });
  return (await Student.collection.insertOne({ schoolId: name, name, nameBn: name, classId: c.insertedId, sectionId: s.insertedId, active: true })).insertedId;
}
async function issue(studentId: Types.ObjectId, b: { _id: Types.ObjectId }, sheet: { _id: Types.ObjectId }, o: Record<string, unknown>) {
  await ActivityIssue.create({ studentId, sheetId: sheet._id, bankId: b._id, path: "TRAY", status: "RETURNED", requestedAt: daysAgo(5), handedAt: daysAgo(5), returnedAt: daysAgo(4), ...o });
}

describe("activity reports", () => {
  it("rolls up by skill, bank, level and child", async () => {
    const sd = await bank("SD", "THINKING");
    const co = await bank("CO", "HAND");
    await bank("TR", "HAND"); // nobody took it
    const aisha = await kid(0, "Aisha", "কেজি ক");
    const hamza = await kid(1, "Hamza", "প্রথম ক");
    const E = sd.sheets.filter((s) => s.level === "E");
    const M = sd.sheets.filter((s) => s.level === "M");
    // SD Easy: Aisha 2 all-correct + 1 incomplete (not finished).
    await issue(aisha, sd.b, E[0], { result: "ALL_CORRECT" });
    await issue(aisha, sd.b, E[1], { result: "ALL_CORRECT", path: "GUARDIAN" });
    await issue(aisha, sd.b, E[2], { result: "INCOMPLETE" });
    // SD Medium: 5 back, 1 all correct → too hard.
    for (let i = 0; i < 5; i++) await issue(hamza, sd.b, M[i], { result: i === 0 ? "ALL_CORRECT" : "SOME_MISTAKES", repeat: i === 4 });
    // CO: Aisha one finished; an old one outside d30.
    await issue(aisha, co.b, co.sheets[0], { result: "SOME_MISTAKES" });
    await issue(aisha, co.b, co.sheets[1], { result: "ALL_CORRECT", requestedAt: daysAgo(60), handedAt: daysAgo(60), returnedAt: daysAgo(59) });
    // One out too long (sweep → not returned).
    await issue(hamza, sd.b, M[5], { status: "HANDED", returnedAt: undefined, result: undefined, handedAt: daysAgo(20), requestedAt: daysAgo(20) });

    const skills = await activitySkillReport("d30", NOW);
    expect(skills.rows.map((r) => [r.skill, r.finished, r.allCorrectPct, r.children])).toEqual([
      ["HAND", 1, 0, 1],
      ["LANGUAGE", 0, 0, 0],
      ["MATHS", 0, 0, 0],
      ["THINKING", 7, 43, 2],
    ]);
    expect(skills.grid.filter((c) => c.finished > 0).map((c) => [c.classLabelBn, c.skill, c.finished])).toEqual([
      ["কেজি", "HAND", 1],
      ["কেজি", "THINKING", 2],
      ["প্রথম শ্রেণি", "THINKING", 5],
    ]);

    const banks = await activityBankReport("d30", NOW);
    const sdRow = banks.find((b) => b.code === "SD")!;
    expect(sdRow).toMatchObject({ given: 9, back: 8, notReturned: 1, repeats: 1, viaTray: 8, viaGuardian: 1, neverTaken: false });
    expect(sdRow.levels.map((l) => [l.level, l.back, l.allCorrectPct, l.tooHard])).toEqual([
      ["E", 3, 67, false],
      ["M", 5, 20, true],
      ["H", 0, 0, false],
    ]);
    expect(banks.find((b) => b.code === "TR")).toMatchObject({ given: 0, neverTaken: true });
    expect(banks[0].code).toBe("SD");

    const kids = await activityChildrenReport("d30", NOW);
    expect(kids.children.map((c) => [c.name, c.finished, c.allCorrect, c.open, c.notReturned, c.favouriteSkillBn])).toEqual([
      ["Hamza", 5, 1, 0, 1, "চিন্তা"],
      ["Aisha", 3, 2, 0, 0, "চিন্তা"],
    ]);
    expect(kids.sections.map((s) => [s.sectionNameBn, s.children, s.finished])).toEqual([
      ["কেজি ক", 1, 3],
      ["প্রথম ক", 1, 5],
    ]);
    // The year window brings the old Colouring sheet in.
    const year = await activityChildrenReport("year", NOW);
    expect(year.children.find((c) => c.name === "Aisha")!.finished).toBe(4);
  });
});

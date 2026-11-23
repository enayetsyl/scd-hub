/**
 * AL-6b — the server reads behind the weekly-assignment / in-class work / policy screens
 * (docs/prd-academic-loop-2027.md §3.1, §3.6, §4.4; AC-C4, AC-C9, AC-C12, AC-F1).
 *
 *   pure   the day question split ("শুক্রবার: প্রশ্ন ১–৬ · শনিবার: প্রশ্ন ৭–১২"), the day labels, the AC-C12 sentence
 *          the app recognises, the new labels in BN and EN
 *   OFF    release switch off → the week load carries no day budget and no day label; the item tally carries a paper
 *          code only where a paper exists (the app hides it with the switch off)
 *   ON     the week load: day cap = perDayHours × 60, the day totals, each item's day label (FRI / SAT / BOTH with the
 *          question ranges from the item's own sheet); the tally's paperCode / paperLocked
 *
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { AssignmentItem } from "../modules/trackers/models/AssignmentItem";
import { AssignmentStudentRecord } from "../modules/trackers/models/AssignmentStudentRecord";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { savePolicy } from "../modules/mastery/services/MasteryCatalogueService";
import { dayLabelOfItem } from "../modules/mastery/services/AssignmentPaperService";
import { assignmentWeekLoad } from "../modules/trackers/services/AssignmentService";
import { assignmentItemTallies } from "../modules/trackers/services/AssignmentSummaryService";
import { SECOND_ASSIGNMENT_MESSAGE, childDayLabel, dayLabelBn, dayLabelEn, dayQuestionSplit, staffDaySplit } from "../modules/mastery/assignmentBudget";
import { SWITCH_PRINCIPAL_ONLY } from "../modules/mastery/services/MasteryCatalogueService";
import * as Recompute from "../modules/mastery/services/Loop2027Recompute";
import * as ReportError from "../lib/reportError";
import { asWhenLine } from "../modules/assessment/routes/setPdf";
import { AssessmentSet } from "../modules/assessment/models/AssessmentSet";
import { readFileSync } from "fs";
import path from "path";
import { MASTERY_POLICY_INTEGRITY_KEYS, MASTERY_POLICY_SCHOOL_KEYS } from "@scd/shared";

// The app has no jest runner: pure modules are required, screens / graphql files are read as source.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { countedMinutesOf, pickDayLabel } = require("../../../app/src/lib/asBudget") as {
  countedMinutesOf: (a: number, b: number[], m: number) => number;
  pickDayLabel: (bn: string | null, en: string | null, lang: string) => string | null;
};
const { isSecondAssignmentRefusal } = require("../../../app/src/lib/asRefusal") as { isSecondAssignmentRefusal: (m: string | null | undefined) => boolean };
const readApp = (rel: string) => readFileSync(path.resolve(__dirname, "../../../app/src", rel), "utf8");

jest.setTimeout(240_000);

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const TEACHER = new Types.ObjectId();
let yearId = new Types.ObjectId();
let classId = new Types.ObjectId();
let sectionId = new Types.ObjectId();
let seq = 0;

const item = (subject: string, over: Record<string, unknown> = {}) => {
  seq += 1;
  return AssignmentItem.create({
    asId: `AS-L6B-${subject}-${seq}`, academicYearId: yearId, scheduleEntryId: new Types.ObjectId(), weekNumber: 7, cycleWeek: 1,
    classId, classLevel: 3, sectionId, subject, teacherId: TEACHER, deliveryDate: new Date(2027, 4, 2), dueDate: new Date(2027, 4, 6),
    estMinutes: 60, status: "DRAFT", deliveredBy: TEACHER, deliveredAt: new Date(2027, 4, 2), ...over,
  });
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  yearId = year._id;
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  classId = cls._id;
  const [b] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  sectionId = b._id;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("pure: day split, labels, refusal sentence, policy card keys", () => {
  const qs = [1, 2, 3, 4].map((no) => ({ no, marks: 20 }));

  it("Friday takes whole questions while its minutes fit, Saturday the rest", () => {
    // 20 marks × 1.8 = 36 min a question; Friday has 72 min → questions 1–2.
    expect(dayQuestionSplit(qs, 72, 1.8)).toEqual({ fri: [1, 2], sat: [3, 4] });
    // Friday has less than one question's time: it still takes the first, so no day is left empty-handed.
    expect(dayQuestionSplit(qs, 10, 1.8)).toEqual({ fri: [1, 1], sat: [2, 4] });
    // Parts of one stem share a number and move together.
    expect(dayQuestionSplit([{ no: 1, marks: 10 }, { no: 1, marks: 10 }, { no: 2, marks: 20 }], 36, 1.8)).toEqual({ fri: [1, 1], sat: [2, 2] });
  });

  it("the day labels", () => {
    expect(dayLabelBn("FRI")).toBe("শুক্রবার");
    expect(dayLabelBn("SAT")).toBe("শনিবার");
    expect(dayLabelBn("BOTH")).toBe("শুক্র + শনি");
    expect(dayLabelBn("BOTH", { fri: [1, 6], sat: [7, 12] })).toBe("শুক্রবার: প্রশ্ন ১–৬ · শনিবার: প্রশ্ন ৭–১২");
    expect(dayLabelBn(null)).toBeNull();
    expect(dayLabelBn(undefined)).toBeNull();
  });

  it("the app recognises the server's AC-C12 sentence, and nothing else", () => {
    expect(isSecondAssignmentRefusal(SECOND_ASSIGNMENT_MESSAGE)).toBe(true);
    expect(isSecondAssignmentRefusal(`Error: ${SECOND_ASSIGNMENT_MESSAGE}`)).toBe(true);
    expect(isSecondAssignmentRefusal("এই সপ্তাহের মোট সময় ৩৯০ মিনিট হয়ে যাচ্ছে")).toBe(false);
    expect(isSecondAssignmentRefusal(null)).toBe(false);
  });

  it("the policy card lists the school-wide keys without the two integrity keys (those are AL-12)", () => {
    const expected = MASTERY_POLICY_SCHOOL_KEYS.filter((k) => !(MASTERY_POLICY_INTEGRITY_KEYS as readonly string[]).includes(k));
    const src = readApp("graphql/mastery.ts");
    const block = /export const MASTERY_CYCLE_KEYS = \[([\s\S]*?)\] as const/.exec(src)?.[1] ?? "";
    const keys = [...block.matchAll(/"(\w+)"/g)].map((m) => m[1]!);
    expect([...keys].sort()).toEqual([...expected].sort());
  });
});

describe("switch OFF: the week load carries no day budget", () => {
  it("no day cap, no day totals, no day label (even on an item that holds a split)", async () => {
    await savePolicy(null, null, { academicLoop2027On: false }, PRINCIPAL);
    await item("MATH", { doOnDay: "BOTH", minutesByDay: { FRI: 100, SAT: 80 } });
    const load = await assignmentWeekLoad(String(yearId), String(sectionId), 7);
    expect(load.dayCap).toBe(0);
    expect(load.friTotal).toBe(0);
    expect(load.satTotal).toBe(0);
    for (const it of load.items) {
      expect(it.doOnDay).toBeNull();
      expect(it.dayLabel).toBeNull();
      expect(it.friMinutes + it.satMinutes).toBe(0);
    }
    expect(load.ceiling).toBe(360);
  });
});

describe("switch ON: day budget, day labels, paper code on the tally", () => {
  let bothItem: Awaited<ReturnType<typeof item>>;
  let friItem: Awaited<ReturnType<typeof item>>;

  beforeAll(async () => {
    await AssignmentItem.deleteMany({});
    await savePolicy(null, null, { academicLoop2027On: true }, PRINCIPAL);
    friItem = await item("BAN", { doOnDay: "FRI", minutesByDay: { FRI: 120, SAT: 0 } });
    bothItem = await item("SCI", { doOnDay: "BOTH", minutesByDay: { FRI: 72, SAT: 60 } });
  });

  it("day cap = perDayHours × 60, the day totals add the items' splits", async () => {
    const load = await assignmentWeekLoad(String(yearId), String(sectionId), 7);
    expect(load.dayCap).toBe(180);
    expect(load.friTotal).toBe(192);
    expect(load.satTotal).toBe(60);
    const by = new Map(load.items.map((i) => [i.subject, i]));
    expect(by.get("BAN")?.dayLabel).toBe("শুক্রবার");
    // A split subject without a linked sheet still says both days.
    expect(by.get("SCI")?.dayLabel).toBe("শুক্র + শনি");
  });

  it("a split subject with its sheet names the question ranges per day", async () => {
    await MasteryPaper.create({
      paperId: "MP-L6B-1", source: "AS", sectionId, classId, academicYearId: yearId, classToken: "C3", subject: "SCI", date: new Date("2027-05-06T00:00:00.000Z"),
      links: { asItemId: bothItem._id }, trackerLinked: true,
      items: [1, 2, 3, 4].map((itemNo) => ({ itemNo, origin: "TEACHER", textBn: `প্রশ্ন ${itemNo}`, loCodes: ["LO-C3-SCI-01-01"], chapterNumber: 1, questionTypeCode: "QT-SHORT", marks: 20 })),
    });
    expect(await dayLabelOfItem(bothItem)).toBe("শুক্রবার: প্রশ্ন ১–২ · শনিবার: প্রশ্ন ৩–৪");
    const load = await assignmentWeekLoad(String(yearId), String(sectionId), 7);
    expect(load.items.find((i) => i.subject === "SCI")?.dayLabel).toBe("শুক্রবার: প্রশ্ন ১–২ · শনিবার: প্রশ্ন ৩–৪");
  });

  it("the tally carries the AS paper code and whether the sheet is locked", async () => {
    const mk = (it: Awaited<ReturnType<typeof item>>) =>
      AssignmentStudentRecord.create({
        asItemId: it._id, asId: it.asId, studentId: new Types.ObjectId(), sectionId, classId, state: "GIVEN", chaseCount: 0, issuedBy: TEACHER,
        stateDates: [{ state: "GIVEN", at: new Date() }],
      });
    await mk(bothItem);
    await mk(friItem);
    let tallies = await assignmentItemTallies(String(sectionId));
    const sci = () => tallies.find((t) => t.asItemId === String(bothItem._id));
    const ban = () => tallies.find((t) => t.asItemId === String(friItem._id));
    expect(sci()?.paperCode).toBe("MP-L6B-1");
    expect(sci()?.paperLocked).toBe(false);
    expect(ban()?.paperCode ?? null).toBeNull(); // no sheet: the card shows no grid entry
    await MasteryPaper.updateOne({ paperId: "MP-L6B-1" }, { $set: { lockedAt: new Date() } });
    tallies = await assignmentItemTallies(String(sectionId));
    expect(sci()?.paperLocked).toBe(true);
  });
});

describe("whole-sheet day labels (pure)", () => {
  const partA = [1, 2, 3].map((no) => ({ no, marks: 10 })); // 18 min each at 1.8
  it("staff label: Part A split plus where the per-child part falls", () => {
    // Friday 54 min = Part A exactly; the own part (Q4, 10 marks) is Saturday.
    const r = staffDaySplit(partA, [{ no: 4, marks: 10 }], 54, 1.8);
    expect(r.split).toEqual({ fri: [1, 3], sat: null });
    expect(r.own).toBe("SAT");
    expect(dayLabelBn("BOTH", r.split, r.own)).toBe("শুক্রবার: প্রশ্ন ১–৩ + নিজস্ব অংশ (শনিবার)");
    expect(dayLabelEn("BOTH", r.split, r.own)).toBe("Friday: questions 1–3 + own part (Saturday)");
    // Friday 36 min: Part A splits, the own part follows on Saturday.
    const r2 = staffDaySplit(partA, [{ no: 4, marks: 10 }], 36, 1.8);
    expect(dayLabelBn("BOTH", r2.split, r2.own)).toBe("শুক্রবার: প্রশ্ন ১–২ · শনিবার: প্রশ্ন ৩ + নিজস্ব অংশ (শনিবার)");
    // No own part: no suffix.
    expect(staffDaySplit(partA, [], 36, 1.8).own).toBeNull();
    expect(dayLabelBn("BOTH", { fri: [1, 6], sat: [7, 12] }, "BOTH")).toBe("শুক্রবার: প্রশ্ন ১–৬ · শনিবার: প্রশ্ন ৭–১২ + নিজস্ব অংশ");
  });
  it("per-child label from the child's own minutes", () => {
    const small = [1, 2].map((no) => ({ no, marks: 10 })); // 36 min — fits Friday's 54
    expect(childDayLabel("bn", "BOTH", small, 54, 1.8)).toBe("শুক্রবার");
    const big = [1, 2, 3, 4].map((no) => ({ no, marks: 10 }));
    expect(childDayLabel("bn", "BOTH", big, 54, 1.8)).toBe("শুক্রবার: প্রশ্ন ১–৩ · শনিবার: প্রশ্ন ৪");
    expect(childDayLabel("en", "SAT", big, 54, 1.8)).toBe("Saturday");
  });
  it("the app counts the time the server counts, and picks the label by language", () => {
    expect(countedMinutesOf(10, [10, 20, 30], 1.8)).toBe(54); // (10 + median 20) × 1.8
    expect(pickDayLabel("শুক্রবার", "Friday", "en")).toBe("Friday");
    expect(pickDayLabel("শুক্রবার", null, "en")).toBe("শুক্রবার");
    expect(pickDayLabel("শুক্রবার", "Friday", "bn")).toBe("শুক্রবার");
  });
});

describe("the release switch is the Principal's (PRD §3.6)", () => {
  const TEACHER_ACTOR = { userId: new Types.ObjectId().toString(), role: "TEACHER" as const };
  it("refuses anyone else changing it, allows a save that leaves it as it is", async () => {
    await savePolicy(null, null, { academicLoop2027On: false }, PRINCIPAL);
    await expect(savePolicy(null, null, { academicLoop2027On: true }, TEACHER_ACTOR)).rejects.toThrow(SWITCH_PRINCIPAL_ONLY);
    await expect(savePolicy(null, null, { academicLoop2027On: false, weeklyAssignmentHoursCap: 6 }, TEACHER_ACTOR)).resolves.toBeTruthy();
    await expect(savePolicy(null, null, { weeklyAssignmentHoursCap: 6 }, TEACHER_ACTOR)).resolves.toBeTruthy();
  });
  it("OFF → ON runs the recompute apply once in the background; ON → ON and ON → OFF do not; a failure is reported, not thrown", async () => {
    const spy = jest.spyOn(Recompute, "recomputeForSwitch").mockResolvedValue({ switchOn: true, applied: true, rows: [], opened: 0 });
    await savePolicy(null, null, { academicLoop2027On: false }, PRINCIPAL);
    await savePolicy(null, null, { academicLoop2027On: true }, PRINCIPAL);
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ apply: true });
    await savePolicy(null, null, { academicLoop2027On: true, perDayHours: 3 }, PRINCIPAL);
    await savePolicy(null, null, { academicLoop2027On: false }, PRINCIPAL);
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRejectedValueOnce(new Error("boom"));
    const rep = jest.spyOn(ReportError, "reportSilentFailure").mockResolvedValue(undefined);
    await expect(savePolicy(null, null, { academicLoop2027On: true }, PRINCIPAL)).resolves.toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(rep).toHaveBeenCalledWith("masteryPolicy.loop2027Recompute", expect.any(Error), {});
    spy.mockRestore();
    rep.mockRestore();
  });
});

describe("the untailored AS sheet printed from its set carries the day line", () => {
  it("only with the switch on and a split on the item that uses the set", async () => {
    await AssignmentItem.deleteMany({});
    const [set] = await AssessmentSet.create([{ name: "AS set", setType: "AS", classId, sectionId, status: "assembled", createdBy: TEACHER, basketItems: [] } as never]);
    await item("BAN", { setId: set._id, doOnDay: "BOTH", minutesByDay: { FRI: 54, SAT: 36 } });
    const basket = [1, 2, 3, 4].map(() => ({ marks: 10 }));
    await savePolicy(null, null, { academicLoop2027On: true }, PRINCIPAL);
    expect(await asWhenLine({ _id: set._id, setType: "AS" } as never, basket)).toBe("কবে করবে: শুক্রবার: প্রশ্ন ১–৩ · শনিবার: প্রশ্ন ৪");
    expect(await asWhenLine({ _id: set._id, setType: "HW" } as never, basket)).toBeNull();
    await savePolicy(null, null, { academicLoop2027On: false }, PRINCIPAL);
    expect(await asWhenLine({ _id: set._id, setType: "AS" } as never, basket)).toBeNull();
  });
});


describe("the app screens show the 2027 additions only with the release switch on (source scan, AC-R1)", () => {
  it("workspace: the grid entry and the resync need the switch AND a paper code", () => {
    const src = readApp("screens/assignment/AssignmentWorkspaceScreen.tsx");
    expect(src).toMatch(/academicLoop2027On === true \? \(tally\?\.paperCode \?\? null\) : null/);
    expect(src).toMatch(/open && paperCode \?/);
    expect(src).toMatch(/pause: !open \|\| !can\("mastery:view"\)/);
    expect(src).toMatch(/canGrid && collected/);
    expect(src).toMatch(/RESYNC_ASSIGNMENT_PAPER/);
  });
  it("reconcile: the day bars need a day cap (0 with the switch off)", () => {
    expect(readApp("screens/assignment/AssignmentReconcileScreen.tsx")).toMatch(/\(load\.dayCap \?\? 0\) > 0/);
  });
  it("in-class work: the source chip, the work-home button and the lesson link need the switch", () => {
    expect(readApp("screens/mastery/MasteryNewPaperScreen.tsx")).toMatch(/loopOn \|\| source === "CW"/);
    expect(readApp("screens/mastery/MasteryWorkHomeScreen.tsx")).toMatch(/\(p\.source === "AS" && loopOn\) \|\| p\.source === "CW"/);
    expect(readApp("screens/mastery/MasteryWorkHomeScreen.tsx")).toMatch(/\{loopOn \? \(\s*<Button title=\{STR\.al6CwButton\}/);
    expect(readApp("components/HomeworkFromLessonLink.tsx")).toMatch(/\{loopOn \? \(/);
  });
  it("delivery: the paper warning keeps the teacher on the screen; the AC-C12 refusal gets the extra-homework button", () => {
    const src = readApp("screens/assignment/DeliverAssignmentScreen.tsx");
    expect(src).toMatch(/deliverAssignment\.paperWarning/);
    expect(src).toMatch(/AsRefusalNotice/);
    expect(readApp("components/AsRefusalNotice.tsx")).toMatch(/MasteryExtraHomework/);
  });
  it("the policy card sends the older keys with its own (the school save replaces them wholesale)", () => {
    const src = readApp("screens/mastery/MasteryPolicyScreen.tsx");
    expect(src).toMatch(/\.\.\.olderValues/);
    expect(src).toMatch(/classToken: null, subject: null/);
    expect(src).toMatch(/policy\?\.scopeKey === "SCHOOL"/);
    expect(src).toMatch(/v\.trim\(\) === "" \? NaN/);
    expect(src).toMatch(/role === "PRINCIPAL"/);
    expect(src).not.toMatch(/onSaved/);
  });
});

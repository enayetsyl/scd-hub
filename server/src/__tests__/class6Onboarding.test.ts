/**
 * YC-3 (docs/prd-year-change.md §4 + §5 row "YC-3", D-#1480–#1483): Class 6 and the new
 * teaching subjects ICT, BAN2, ENG2. In-memory MongoDB, the real services.
 *
 * Acceptance: a level-6 class + section; a routine slot for each of the 9 Class 6 subjects
 * (routine grants bind for the new ones); HW-C6-BAN2-0001 declared and parsed back; a class
 * test and an exam syllabus for ENG2; subjectLabel C6 vs C3; a pop-up to level 6 resolves its
 * guardians; the data script's dry run lists its rows and a second --apply writes 0.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  HW_SUBJECTS,
  ROSTER_CLASS_LABELS_BN,
  ROUTINE_SUBJECTS,
  parseClassToken,
  subjectLabel,
  subjectsForClassLevel,
} from "@scd/shared";
import type { AppContext } from "../context";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { Subject } from "../modules/foundation/models/Subject";
import { ScopeGrant } from "../modules/foundation/models/ScopeGrant";
import { User } from "../modules/foundation/models/User";
import { StoredFile } from "../modules/platform/models/StoredFile";
import { PeriodGrid } from "../modules/routine/models/PeriodGrid";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { HomeworkTopic } from "../modules/trackers/models/HomeworkTopic";
import { Exam } from "../modules/exams/models/Exam";
import { createRoutineSlot } from "../modules/routine/services/RoutineSlotService";
import { declareHomeworkItem, topicLabelByCode } from "../modules/trackers/services/HomeworkService";
import { HW_ID_RE } from "../modules/trackers/services/HomeworkSummaryService";
import { createRequest } from "../modules/trackers/services/ClassTestService";
import { saveSyllabus } from "../modules/exams/services/ExamSyllabusService";
import { classSyllabus } from "../modules/exams/services/ExamSyllabusReadService";
import { normalizeAudience, resolveAudience, describeAudience } from "../modules/popup-notices/services/PopupAudienceService";
import { class6OnboardingData } from "../modules/foundation/services/Class6OnboardingDataService";
import { suggestTagFor } from "../modules/printing/services/PrintRequestService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  // allSettled: an unrelated model's partial index ($ne) is not supported by the in-memory server.
  await Promise.allSettled(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

let seq = 0;
const ctxOf = (userId: string, role: string): AppContext =>
  ({ auth: { userId, role, additionalTemplates: [], grantedPermissions: [], revokedPermissions: [] } }) as unknown as AppContext;

async function user(name: string, role: string): Promise<string> {
  seq += 1;
  const r = await User.collection.insertOne({
    name, role, phone: `88017100${String(seq).padStart(5, "0")}`, passwordHash: "x", active: true,
    additionalTemplates: [], grantedPermissions: [], revokedPermissions: [],
  });
  return r.insertedId.toString();
}

/** The six Subject rows prod has today (FOUNDATION_SUBJECTS before YC-3). */
async function seedOldSubjects(): Promise<void> {
  for (const code of ["BAN", "ENG", "MATH", "SCI", "BGS", "ISLAM"]) await Subject.create({ code, nameBn: code, active: true });
}

/** The two class_1_5 grids and the nursery_kg grid, as seed-routine.ts writes them. */
async function seedGrids(): Promise<void> {
  const periods = [
    { number: 1, durationMin: 45, isBreak: false, track: "quran", nameBn: "১ম" },
    { number: 5, durationMin: 35, isBreak: false, track: "general", nameBn: "৪র্থ" },
  ];
  await PeriodGrid.collection.insertMany([
    { audienceKey: "class_1_5", classLevels: [1, 2, 3, 4, 5], season: "regular", periods, active: true },
    { audienceKey: "class_1_5", classLevels: [1, 2, 3, 4, 5], season: "winter", periods, active: true },
    { audienceKey: "nursery_kg", classLevels: [-1, 0], season: "regular", periods, active: true },
  ]);
}

interface C6 {
  yearId: string;
  classId: string;
  sectionId: string;
  c5ClassId: string;
}
async function seedClass6(): Promise<C6> {
  const year = await AcademicYear.create({ label: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), current: true });
  const c6 = await Class.create({ level: 6, nameBn: ROSTER_CLASS_LABELS_BN[6], academicYearId: year._id, active: true });
  const s6 = await Section.create({ classId: c6._id, code: "BOYS", nameBn: "বালক", active: true });
  const c5 = await Class.create({ level: 5, nameBn: ROSTER_CLASS_LABELS_BN[5], academicYearId: year._id, active: true });
  return { yearId: year._id.toString(), classId: c6._id.toString(), sectionId: s6._id.toString(), c5ClassId: c5._id.toString() };
}

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((m) => (m as mongoose.Model<unknown>).deleteMany({})));
});

// ---------------------------------------------------------------------------

describe("labels and lists", () => {
  test("subjectLabel: Class 6 names the papers, Class 3 keeps the plain name", () => {
    expect(subjectLabel("BAN2", 6)).toBe("বাংলা দ্বিতীয় পত্র");
    expect(subjectLabel("ENG2", 6)).toBe("ইংরেজি দ্বিতীয় পত্র");
    expect(subjectLabel("BAN", 6)).toBe("বাংলা প্রথম পত্র");
    expect(subjectLabel("ENG", 6)).toBe("ইংরেজি প্রথম পত্র");
    expect(subjectLabel("BAN", 3)).toBe("বাংলা");
    expect(subjectLabel("ENG", 5)).toBe("ইংরেজি");
    expect(subjectLabel("MATH", 6)).toBe("গণিত");
    expect(subjectLabel("ICT", 6)).toBe("তথ্য ও যোগাযোগ প্রযুক্তি");
    expect(subjectLabel("BAN2", 6, "en")).toBe("Bangla 2nd paper");
    expect(subjectLabel("BAN")).toBe("বাংলা");
  });

  test("ICT / BAN2 / ENG2 are homework + routine subjects; pickers hide them below Class 6", () => {
    for (const s of ["ICT", "BAN2", "ENG2"]) {
      expect(HW_SUBJECTS).toContain(s);
      expect(ROUTINE_SUBJECTS).toContain(s);
    }
    expect(subjectsForClassLevel(ROUTINE_SUBJECTS, 5)).not.toContain("ICT");
    expect(subjectsForClassLevel(ROUTINE_SUBJECTS, 6)).toEqual([...ROUTINE_SUBJECTS]);
    expect(subjectsForClassLevel(ROUTINE_SUBJECTS, null)).toEqual([...ROUTINE_SUBJECTS]);
  });
});

describe("print tags read Class 6 and the new subjects", () => {
  test("C6 + BAN2 / ENG2 / ICT from a file name; the 1st papers stay BAN / ENG", () => {
    const tag = (f: string) => {
      const t = suggestTagFor({ fileNames: [f] });
      return `${t.classLevel}/${t.subject}`;
    };
    expect(tag("C6_BAN2_worksheet.pdf")).toBe("6/BAN2");
    expect(tag("Class 6 English 2nd paper.pdf")).toBe("6/ENG2");
    expect(tag("C6 ICT lab.pdf")).toBe("6/ICT");
    expect(tag("C6_BAN_U02.pdf")).toBe("6/BAN");
    expect(tag("C3 Bangla 2.pdf")).toBe("3/BAN");
  });
});

describe("Class 6 teaching side", () => {
  test("a level-6 class and section save; a routine slot for each of the 9 subjects binds", async () => {
    await seedOldSubjects();
    await class6OnboardingData({ apply: true }); // adds the ICT / BAN2 / ENG2 Subject rows
    const c = await seedClass6();
    expect((await Class.findById(c.classId))!.level).toBe(6);

    const principal = await user("Principal", "PRINCIPAL");
    // Owner's weekly split (20): Math 4, Science 4, ENG 3, BAN 2, BAN2 2, BGS 2, ENG2 1, ICT 1, ISLAM 1 — one slot each here.
    const nine = ["MATH", "SCI", "ENG", "BAN", "BAN2", "BGS", "ENG2", "ICT", "ISLAM"];
    const days = ["SUN", "MON", "TUE", "WED", "THU"] as const;
    for (let i = 0; i < nine.length; i++) {
      const teacher = await user(`T-${nine[i]}`, "TEACHER");
      const { slot } = await createRoutineSlot({
        groupType: "section",
        groupId: c.sectionId,
        dayOfWeek: days[i % days.length],
        periodNumber: 5 + Math.floor(i / days.length),
        subject: nine[i] as (typeof ROUTINE_SUBJECTS)[number],
        track: "general",
        isBreak: false,
        teacherId: teacher,
        roomId: null,
        effectiveFrom: new Date("2026-11-15"),
        effectiveTo: null,
        createdBy: principal,
      });
      expect(slot.subject).toBe(nine[i]);
    }
    expect(await RoutineSlot.countDocuments({ groupId: new Types.ObjectId(c.sectionId) })).toBe(9);
    // The new subjects bind a routine teaching grant like the old ones.
    for (const code of ["ICT", "BAN2", "ENG2", "MATH"]) {
      const subj = await Subject.findOne({ code });
      expect(await ScopeGrant.countDocuments({ kind: "teaching", sectionId: c.sectionId, subjectId: subj!._id, active: true })).toBe(1);
    }
  });

  test("declare HW-C6-BAN2-0001 and parse it back", async () => {
    const c = await seedClass6();
    await Student.create({ schoolId: "T-601", name: "Test Child C6", classId: c.classId, sectionId: c.sectionId, active: true });
    const teacher = await user("BAN2 teacher", "TEACHER");
    // The generic topic code is accepted (and labelled) before any topic row exists.
    expect((await topicLabelByCode(["TOP-BAN2-C6-GEN"])).get("TOP-BAN2-C6-GEN")).toBe("সাধারণ (নির্দিষ্ট অধ্যায় নয়)");
    const r = await declareHomeworkItem({
      academicYearId: c.yearId,
      classId: c.classId,
      classLevel: 6,
      sectionId: c.sectionId,
      subject: "BAN2",
      dateGiven: new Date(2026, 10, 15), // Sunday
      topTags: ["TOP-BAN2-C6-GEN"],
      qCount: 2,
      description: "অনুচ্ছেদ লেখা",
      actorId: teacher,
    });
    expect(r.hwId).toBe("HW-C6-BAN2-0001");
    const m = HW_ID_RE.exec(r.hwId);
    expect(m).not.toBeNull();
    expect(parseClassToken(`C${m![1]}`)).toBe(6);
    expect(m![2]).toBe("BAN2");
    expect(m![3]).toBe("0001");
  });

  test("a class test and an exam syllabus for ENG2", async () => {
    const c = await seedClass6();
    const teacher = await user("ENG2 teacher", "TEACHER");
    const principal = await user("Principal", "PRINCIPAL");
    const file = await StoredFile.collection.insertOne({
      kind: "classtest_question", mime: "application/pdf", sizeBytes: 10, originalName: "q.pdf",
      driveFileId: "drive-1", uploadedBy: new Types.ObjectId(teacher), uploadedAt: new Date(),
    });
    const ct = await createRequest({
      sectionId: c.sectionId,
      subject: "ENG2",
      examDate: "2026-11-18",
      totalMarks: 20,
      source: "UPLOADED_PAPER",
      questionFileId: file.insertedId.toString(),
      teacherId: teacher,
      actorId: teacher,
      skipPrint: true,
    } as Parameters<typeof createRequest>[0]);
    expect(ct.ctId).toBe("CT-C6-ENG2-0001");
    expect(ct.subject).toBe("ENG2");

    const exam = await Exam.collection.insertOne({
      academicYearId: new Types.ObjectId(c.yearId), term: "ANNUAL", name: "বার্ষিক পরীক্ষা ২০২৬",
      status: "PLANNED", createdBy: new Types.ObjectId(principal),
    });
    const examId = exam.insertedId.toString();
    const saved = await saveSyllabus(ctxOf(principal, "PRINCIPAL"), {
      examId,
      classId: c.classId,
      subject: "ENG2",
      bodyMd: "Unit 1–4",
      marks: [{ seq: 1, label: "Grammar", count: 10, marksEach: 10, total: 100 }],
      questionTypes: [],
    } as Parameters<typeof saveSyllabus>[1]);
    expect(saved.subject).toBe("ENG2");

    // The Office board for a Class 6 class with no routine lists the Class 6 subjects;
    // a Class 5 class does not.
    const c6View = await classSyllabus(ctxOf(principal, "PRINCIPAL"), examId, c.classId);
    const c6Subjects = c6View.subjects.map((s: { subject: string }) => s.subject);
    expect(c6Subjects).toEqual(expect.arrayContaining(["ENG2", "BAN2", "ICT"]));
    const c5View = await classSyllabus(ctxOf(principal, "PRINCIPAL"), examId, c.c5ClassId);
    const c5Subjects = c5View.subjects.map((s: { subject: string }) => s.subject);
    expect(c5Subjects).toContain("ENG");
    for (const s of ["ICT", "BAN2", "ENG2"]) expect(c5Subjects).not.toContain(s);
  });

  test("a pop-up to level 6 resolves its guardians", async () => {
    const c = await seedClass6();
    const kid = await Student.create({ schoolId: "T-602", name: "Test Child C6B", classId: c.classId, sectionId: c.sectionId, active: true });
    const g = await Guardian.collection.insertOne({
      identifierKind: "phone", identifier: "01900000601", name: "Test Guardian", phone: "8801900000601", loginEnabled: true, active: true,
    });
    await GuardianLink.collection.insertOne({ guardianId: g.insertedId, studentId: kid._id, relation: "mother", active: true });

    const audience = normalizeAudience({ guardian: { classLevels: [6] } });
    const r = await resolveAudience(audience);
    expect(r.guardianCount).toBe(1);
    expect(r.recipients.map((x) => x.id.toString())).toEqual([g.insertedId.toString()]);
    expect(await describeAudience(audience)).toContain("ষষ্ঠ শ্রেণি");
  });
});

describe("class6-onboarding-data (the prod data script)", () => {
  test("dry run lists the rows and writes nothing; --apply writes them; a second --apply writes 0", async () => {
    await seedOldSubjects();
    await seedGrids();

    const dry = await class6OnboardingData({ apply: false });
    const lines = dry.planned.map((p) => p.line);
    expect(dry.written).toBe(0);
    expect(dry.planned.filter((p) => p.kind === "SUBJECT").map((p) => p.line)).toEqual([
      'Subject ICT "তথ্য ও যোগাযোগ প্রযুক্তি"',
      'Subject BAN2 "বাংলা দ্বিতীয় পত্র"',
      'Subject ENG2 "ইংরেজি দ্বিতীয় পত্র"',
    ]);
    expect(dry.planned.filter((p) => p.kind === "PERIOD_GRID")).toHaveLength(2);
    expect(dry.planned.filter((p) => p.kind === "HOMEWORK_TOPIC")).toHaveLength(HW_SUBJECTS.length);
    expect(lines).toContain('HomeworkTopic TOP-BAN2-C6-GEN "সাধারণ (নির্দিষ্ট অধ্যায় নয়)"');
    // nothing written
    expect(await Subject.countDocuments()).toBe(6);
    expect(await HomeworkTopic.countDocuments()).toBe(0);
    expect(await PeriodGrid.countDocuments({ classLevels: 6 })).toBe(0);

    const first = await class6OnboardingData({ apply: true });
    expect(first.written).toBe(dry.planned.length);
    expect(await Subject.countDocuments()).toBe(9);
    expect(await PeriodGrid.countDocuments({ audienceKey: "class_1_5", classLevels: 6 })).toBe(2);
    expect(await PeriodGrid.countDocuments({ audienceKey: "nursery_kg", classLevels: 6 })).toBe(0);
    expect(await HomeworkTopic.countDocuments({ classLevel: 6, source: "generic" })).toBe(HW_SUBJECTS.length);

    const second = await class6OnboardingData({ apply: true });
    expect(second.planned).toEqual([]);
    expect(second.written).toBe(0);
  });

  test("an existing row is never changed (a renamed Subject keeps its name)", async () => {
    await seedOldSubjects();
    await Subject.create({ code: "ICT", nameBn: "আইসিটি", active: true });
    const r = await class6OnboardingData({ apply: true });
    expect(r.planned.filter((p) => p.kind === "SUBJECT").map((p) => p.line.split(" ")[1])).toEqual(["BAN2", "ENG2"]);
    expect((await Subject.findOne({ code: "ICT" }))!.nameBn).toBe("আইসিটি");
    expect(r.notes).toContain('No "class_1_5" period grid exists — nothing to widen (not created).');
  });
});

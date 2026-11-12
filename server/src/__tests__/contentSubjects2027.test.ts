/**
 * PR-A — the content pipeline accepts the 2027 subjects and Class 6 (docs/prd-content-subjects-2027.md,
 * D-#1310–#1313).
 *
 * Real Python harness + importEnvelope / importCatalogue on in-memory MongoDB, over the committed
 * harness cases in server/import/cases/subjects-2027/ and the C6 ICT tree fixture.
 *
 * 1. An ISLAM Class 3 session plan and a Class 6 ICT question batch validate and import.
 * 2. A Class 7 envelope and an unknown subject are refused.
 * 3. LO-C6-BAN2-03-02.1, LO-C6-ICT-01-01, DOM-ENG2-TENSE match; LO-C7-… does not.
 * 4. A C6 ICT tree passes the shared invariant check and imports as a draft round.
 * 5. An ISLAM question without ref19_topic_id passes; a BAN question without it still fails.
 * +  The class-note lesson-plan picker finds the ISLAM session plan for an ISLAM routine slot.
 */
import fs from "node:fs";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  CLASS_LEVEL_MAX,
  MASTERY_DOMAIN_CODE_RE,
  MASTERY_LO_CODE_RE,
  MASTERY_SUBJECTS,
  NCTB_GENERAL_SUBJECTS,
  SUBJECTS,
  SUBJECT_LABELS_BN,
  checkTreeInvariants,
  readDomainsFile,
  readTreeFile,
} from "@scd/shared";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { FOUNDATION_SUBJECTS } from "../modules/foundation/models/Subject";
import { LessonProgressConfig } from "../modules/lesson-progress/models/LessonProgressConfig";
import { MasteryCatalogueReview } from "../modules/mastery/models/MasteryCatalogueReview";
import { MasteryOutcome } from "../modules/mastery/models/MasteryOutcome";
import { importEnvelope } from "../modules/content/services/ContentService";
import { importCatalogue } from "../modules/mastery/services/MasteryCatalogueService";
import { lessonPlanForSlot, sessionPlansFor } from "../modules/lesson-progress/services/LessonDeliveryService";

jest.setTimeout(180_000);

const REPO = path.resolve(__dirname, "../../..");
const CASES = path.join(REPO, "server/import/cases/subjects-2027");
const FIX = path.join(__dirname, "fixtures/objective-tree");
const kase = (name: string) => JSON.parse(fs.readFileSync(path.join(CASES, name), "utf8")) as Record<string, unknown>;
const ACTOR = new Types.ObjectId().toString();
const PRINCIPAL = { userId: ACTOR, role: "PRINCIPAL" as const };

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({})));
});

describe("vocab (pure)", () => {
  it("content subjects gain ISLAM, ICT, BAN2, ENG2 with Bangla labels; Class 6 is the top content class", () => {
    for (const s of ["ISLAM", "ICT", "BAN2", "ENG2"]) expect(SUBJECTS).toContain(s);
    expect(SUBJECT_LABELS_BN.ICT).toBe("তথ্য ও যোগাযোগ প্রযুক্তি");
    expect(SUBJECT_LABELS_BN.BAN2).toBe("বাংলা দ্বিতীয় পত্র");
    expect(SUBJECT_LABELS_BN.ENG2).toBe("ইংরেজি দ্বিতীয় পত্র");
    expect(SUBJECT_LABELS_BN.ISLAM).toBe("ইসলাম শিক্ষা");
    expect(CLASS_LEVEL_MAX).toBe(6);
    expect([...NCTB_GENERAL_SUBJECTS]).toEqual(["BAN", "ENG", "MATH", "SCI", "BGS"]);
    // The operational Subject collection gained ICT / BAN2 / ENG2 in YC-3 (D-#1480): a Class 6
    // routine grant binds a Subject row.
    expect([...FOUNDATION_SUBJECTS]).toEqual(["BAN", "ENG", "MATH", "SCI", "BGS", "ISLAM", "ICT", "BAN2", "ENG2"]);
    expect(MASTERY_SUBJECTS).toEqual(expect.arrayContaining(["ICT", "BAN2", "ENG2", "ARABIC", "ISLAM"]));
  });

  it("acceptance 3: objective and domain codes for Class 6 papers match; Class 7 does not", () => {
    expect(MASTERY_LO_CODE_RE.test("LO-C6-BAN2-03-02.1")).toBe(true);
    expect(MASTERY_LO_CODE_RE.test("LO-C6-ICT-01-01")).toBe(true);
    expect(MASTERY_DOMAIN_CODE_RE.test("DOM-ENG2-TENSE")).toBe(true);
    expect(MASTERY_LO_CODE_RE.test("LO-C7-ICT-01-01")).toBe(false);
    expect(MASTERY_LO_CODE_RE.test("LO-C7-BAN2-01-01")).toBe(false);
  });
});

describe("import (real harness)", () => {
  it("acceptance 1: an ISLAM Class 3 session plan imports with its codes", async () => {
    const r = await importEnvelope(kase("pass_islam_c3_session_plan.json"), ACTOR);
    expect(r.failChecks).toEqual([]);
    expect(r.verdict).toBe("PASS");
    const row = await ContentArtifact.findById(r.artifactId).lean();
    expect(row?.subject).toBe("ISLAM");
    expect(row?.classLevel).toBe(3);
  });

  it("acceptance 1: a Class 6 ICT question batch imports every element", async () => {
    const r = await importEnvelope(kase("pass_ict_c6_question_batch.json"), ACTOR);
    expect(r.failChecks).toEqual([]);
    expect(r.verdict).toBe("PASS");
    const rows = await ContentArtifact.find({ docType: "question", subject: "ICT", classLevel: 6 }).lean();
    expect(rows).toHaveLength(2);
  });

  it("a BAN2 Class 6 question with a digit in its id imports", async () => {
    const r = await importEnvelope(kase("pass_ban2_c6_question.json"), ACTOR);
    expect(r.failChecks).toEqual([]);
    expect(r.verdict).toBe("PASS");
  });

  it("acceptance 2: a Class 7 envelope and an unknown subject are refused", async () => {
    const c7 = await importEnvelope(kase("fail_class7_envelope.json"), ACTOR);
    expect(c7.verdict).toBe("FAIL");
    expect(c7.failChecks.join("\n")).toMatch(/class_level/);
    const unknown = await importEnvelope(kase("fail_unknown_subject.json"), ACTOR);
    expect(unknown.verdict).toBe("FAIL");
    expect(unknown.failChecks.join("\n")).toMatch(/PHYS/);
    expect(await ContentArtifact.countDocuments({})).toBe(0);
  });

  it("acceptance 5: an ISLAM question without ref19_topic_id passes; a BAN question without it still fails", async () => {
    const islam = await importEnvelope(kase("pass_islam_c3_question_no_ref19.json"), ACTOR);
    expect(islam.failChecks).toEqual([]);
    expect(islam.verdict).toBe("PASS");
    const ban = await importEnvelope(kase("fail_ban_question_no_ref19.json"), ACTOR);
    expect(ban.verdict).toBe("FAIL");
    expect(ban.failChecks.join("\n")).toMatch(/ref19_topic_id is required/);
  });
});

describe("objective tree (acceptance 4)", () => {
  const TREE = fs.readFileSync(path.join(FIX, "C6_ICT.tree.json"), "utf8");
  const DOMAINS = fs.readFileSync(path.join(FIX, "ICT.domains.json"), "utf8");

  it("the C6 ICT tree passes the shared invariant check the verifier runs", () => {
    const t = readTreeFile(JSON.parse(TREE));
    const d = readDomainsFile(JSON.parse(DOMAINS));
    if (!t.ok) throw new Error(t.errors.join("; "));
    if (!d.ok) throw new Error(d.errors.join("; "));
    const v = checkTreeInvariants({
      classToken: t.tree.classToken,
      subject: t.tree.subject,
      nodes: t.tree.nodes,
      domainCodes: d.domains.domains.map((x) => x.code),
      questionTypeCodes: t.tree.questionTypes.map((q) => q.code),
      coverage: t.tree.coverage,
      mode: "FILE",
    });
    expect(v).toEqual([]);
  });

  it("an unknown subject is refused by the tree reader", () => {
    const bad = { ...JSON.parse(TREE), subject: "PHYS" };
    const r = readTreeFile(bad);
    expect(r.ok).toBe(false);
  });

  it("imports as a DRAFT round: rows PROPOSED, one OPEN review round", async () => {
    const r = await importCatalogue(TREE, true, PRINCIPAL, DOMAINS);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(true);
    const rows = await MasteryOutcome.find({ classToken: "C6", subject: "ICT" }).lean();
    expect(rows).toHaveLength(3);
    expect(rows.every((x) => x.status === "DRAFT")).toBe(true);
    const rounds = await MasteryCatalogueReview.find({ classToken: "C6", subject: "ICT" }).lean();
    expect(rounds.map((x) => x.state)).toEqual(["OPEN"]);
  });
});

describe("class-note lesson-plan picker", () => {
  it("finds the ISLAM session plan for an ISLAM routine slot", async () => {
    await LessonProgressConfig.create({ classNoteQuestionOn: true });
    const r = await importEnvelope(kase("pass_islam_c3_session_plan.json"), ACTOR);
    expect(r.verdict).toBe("PASS");
    const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
    const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
    const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
    const [slot] = await RoutineSlot.create([
      {
        groupType: "section", groupId: sec._id, classId: cls._id, dayOfWeek: "SUN", periodNumber: 1, subject: "ISLAM", track: "general",
        teacherId: new Types.ObjectId(), effectiveFrom: new Date("2027-01-01"), createdBy: new Types.ObjectId(),
      },
    ]);
    expect((await sessionPlansFor(3, "ISLAM")).map((s) => s.loCodes)).toEqual([["LO-C3-ISLAM-02-01", "LO-C3-ISLAM-02-02.1"]]);
    const view = await lessonPlanForSlot(slot, new Date("2027-03-07"));
    expect(view.applies).toBe(true);
    expect(view.sessions.map((s) => s.chapter)).toEqual(["2"]);
  });
});

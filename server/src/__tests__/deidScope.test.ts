/**
 * AI-4 roster scope + Bangla names (D-#1094, D-#1131), on an in-memory MongoDB.
 *   • a comment's scope = the child ([S]), the section's other children, their guardians, staff
 *   • the Bangla name the Office fills is then hidden too (PRD P11), and the gate passes
 *   • readiness counts the children still missing a Bangla name
 *   • only Bangla letters are accepted; the change is audited; a teacher cannot do it
 * Every name here is invented.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { User } from "../modules/foundation/models/User";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Audit } from "../modules/platform/models/Audit";
import { scopeForStudent, deidReadiness } from "../modules/platform/services/DeidScopeService";
import { setStudentBanglaName, studentBanglaNamesPage } from "../modules/foundation/services/StudentBanglaNameService";
import { assertDeidentified, deidentify } from "../modules/platform/ai/deidentify";
import type { AuthPayload } from "../context";

jest.setTimeout(120_000);

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

const office: AuthPayload = { userId: new Types.ObjectId().toString(), role: "OFFICE" };
const teacher: AuthPayload = { userId: new Types.ObjectId().toString(), role: "TEACHER" };
let ownId = "";
let otherSectionChild = "";

beforeAll(async () => {
  const yearId = new Types.ObjectId();
  const c3 = await Class.create({ level: 3, nameBn: "তৃতীয় শ্রেণি", academicYearId: yearId });
  const boys = await Section.create({ classId: c3._id, code: "B", nameBn: "বালক" });
  const girls = await Section.create({ classId: c3._id, code: "G", nameBn: "বালিকা" });
  const s = (schoolId: string, name: string, sectionId: Types.ObjectId, nameBn?: string) =>
    Student.create({ schoolId, name, nameBn, classId: c3._id, sectionId, active: true });
  const own = await s("0101", "Tahsin Karim", boys._id);
  await s("0102", "Arif Hossain", boys._id, "আরিফ হোসেন");
  const girl = await s("0201", "Nabiha Sultana", girls._id);
  ownId = own._id.toString();
  otherSectionChild = girl._id.toString();
  const g = await Guardian.create({ identifierKind: "phone", identifier: "01700000001", name: "Farzana Akter" });
  await GuardianLink.create({ guardianId: g._id, studentId: own._id, relation: "mother" });
  await User.create({ name: "Rafiqul Islam", role: "TEACHER", passwordHash: "x", active: true, phone: "01700000009" });
});

test("a comment's scope: the child, the section's children, their guardians, staff — not other sections", async () => {
  const scope = await scopeForStudent(ownId);
  const byKind = (k: string) => scope.people.filter((p) => p.kind === k);
  expect(byKind("S").find((p) => p.own)!.names).toEqual(["Tahsin Karim"]);
  expect(byKind("S").map((p) => p.names[0]).sort()).toEqual(["Arif Hossain", "Tahsin Karim"]);
  expect(byKind("S").some((p) => p.id === otherSectionChild)).toBe(false);
  expect(byKind("G").map((p) => p.names[0])).toEqual(["Farzana Akter"]);
  expect(byKind("T").map((p) => p.names[0])).toEqual(["Rafiqul Islam"]);
  const r = deidentify("Tahsin Karim আর আরিফ আজ ঝগড়া করেছে; Farzana Akter-কে জানানো হয়েছে।", scope);
  expect(r.text).toBe("[S] আর [S1] আজ ঝগড়া করেছে; [G1]-কে জানানো হয়েছে।");
});

test("PRD P11: a Bangla first name is missed until the Office fills it, then hidden and the gate passes", async () => {
  const before = await scopeForStudent(ownId);
  expect(deidentify("আজ তাহসিন ভালো পড়েছেন।", before).text).toBe("আজ তাহসিন ভালো পড়েছেন।");

  const readyBefore = await deidReadiness();
  expect(readyBefore).toMatchObject({ activeStudents: 3, withBanglaName: 1, missingBanglaName: 2 });
  const page = await studentBanglaNamesPage(office, {});
  expect(page.rows.map((r) => [r.name, r.placeBn])).toEqual([
    ["Tahsin Karim", "তৃতীয় শ্রেণি · বালক"],
    ["Nabiha Sultana", "তৃতীয় শ্রেণি · বালিকা"],
  ]);

  const row = await setStudentBanglaName(office, ownId, "  তাহসিন  করিম ");
  expect(row.nameBn).toBe("তাহসিন করিম");
  const audit = await Audit.findOne({ eventKind: "STUDENT_BANGLA_NAME_SET" }).lean();
  expect(audit!.meta).toMatchObject({ before: null, after: "তাহসিন করিম" });

  const after = await scopeForStudent(ownId);
  const r = deidentify("আজ তাহসিন ভালো পড়েছেন।", after);
  expect(r.text).toBe("আজ [S] ভালো পড়েছেন।");
  expect(() => assertDeidentified(r.text, after)).not.toThrow();
  expect(await deidReadiness()).toMatchObject({ withBanglaName: 2, missingBanglaName: 1 });
});

test("only Bangla letters; a teacher cannot set names", async () => {
  await expect(setStudentBanglaName(office, ownId, "Tahsin")).rejects.toThrow("বাংলা অক্ষরে");
  await expect(setStudentBanglaName(office, ownId, "ক")).rejects.toThrow("২ থেকে ৮০");
  await expect(setStudentBanglaName(teacher, ownId, "তাহসিন")).rejects.toThrow("অনুমতি নেই");
  await expect(studentBanglaNamesPage(teacher, {})).rejects.toThrow("অনুমতি নেই");
});

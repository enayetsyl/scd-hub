/**
 * Example data for the oral-exam (viva) guides and walks (VV-1…VV-5, D-#1080–#1084, D-#1275–#1277).
 *
 * Create-only, LOCAL ONLY: it refuses any database that is not an in-memory one
 * (mongodb://127.0.0.1:<port>/). Built on seedBaseSchool(); every name is an example.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hc npx tsx scripts/help/fixtures/viva.ts [--reset]
 *
 * নার্সারি (22 example children, class teacher = teacher@help.test) with an Annual 2026 exam
 * whose routine has বাংলা ORAL TODAY (Dhaka) and ইংরেজি ORAL in 3 days. বাংলা is taught by
 * teacher@help.test and ইংরেজি by teacher2@help.test in the routine, so they are the default
 * examiners. Both papers are loaded with the owner's 2026 sets
 * (server/assets/viva/nursery-sets-2026.json) through the real saveVivaPaper — the same data
 * the prod loader writes. No set is drawn and no mark entered.
 */
import fs from "fs";
import path from "path";
import mongoose, { Types } from "mongoose";
import { seedBaseSchool } from "../fixture";
import { Class } from "../../../src/modules/foundation/models/Class";
import { Section } from "../../../src/modules/foundation/models/Section";
import { Student } from "../../../src/modules/foundation/models/Student";
import { Exam } from "../../../src/modules/exams/models/Exam";
import { ExamRoutine } from "../../../src/modules/exams/models/ExamRoutine";
import { ExamSyllabus } from "../../../src/modules/exams/models/ExamSyllabus";
import { RoutineSlot } from "../../../src/modules/routine/models/RoutineSlot";
import { VivaPaper } from "../../../src/modules/viva/models/VivaPaper";
import { saveVivaPaper, syncVivaPapers, type VivaSetInput } from "../../../src/modules/viva/services/VivaService";
import { dhakaDayKey } from "../../../src/lib/dhakaDay";
import type { AppContext } from "../../../src/context";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  console.error("Refusing: MONGODB_URI must be a local in-memory database (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

const NAMES = [
  "আয়েশা সিদ্দিকা", "আরিয়ান হাসান", "ফাতিমা জান্নাত", "আবদুল্লাহ মাহি", "নুসাইবা রহমান", "ইয়াসিন আরাফাত",
  "মারিয়াম আক্তার", "রাইয়ান চৌধুরী", "সুমাইয়া ইসলাম", "তাহমিদ হোসেন", "হাফসা নূর", "উমর ফারুক",
  "জারা তাসনিম", "সাদ আহমেদ", "লামিয়া খানম", "ইব্রাহিম খলিল", "রুকাইয়া বিনতে", "মুসা কালিম",
  "খাদিজা নুসরাত", "আয়ান মাহমুদ", "তাসফিয়া রহমান", "হামজা রশিদ",
];

export async function seedViva() {
  const base = await seedBaseSchool();
  const U = base.users;
  const P = String(U.principal);
  const by = new Types.ObjectId(P);

  const nursery = await Class.collection.insertOne({ level: -1, nameBn: "নার্সারি", academicYearId: base.yearId, active: true });
  const classId = nursery.insertedId;
  const sec = await Section.collection.insertOne({ classId, code: "N", nameBn: "নার্সারি", active: true, classTeacherId: U.teacher });
  const kids: Types.ObjectId[] = [];
  for (const [i, name] of NAMES.entries()) {
    const r = await Student.collection.insertOne({ schoolId: `HN-${i + 1}`, name, rollNumber: String(i + 1), classId, sectionId: sec.insertedId, active: true });
    kids.push(r.insertedId);
  }
  for (const [subject, teacher] of [["BAN", U.teacher], ["ENG", U.teacher2]] as const) {
    await RoutineSlot.collection.insertOne({
      groupType: "section", groupId: sec.insertedId, classId, dayOfWeek: "SUN", periodNumber: subject === "BAN" ? 1 : 2, subject,
      track: "general", isBreak: false, teacherId: teacher, effectiveFrom: new Date("2026-01-01"), active: true, createdBy: by,
    });
  }

  const exam = await Exam.collection.insertOne({ academicYearId: base.yearId, term: "ANNUAL", name: "বার্ষিক পরীক্ষা ২০২৬", createdBy: by });
  const examId = exam.insertedId;
  const oral = (label: string, total: number) => [{ seq: 1, label, itemType: "oral", count: 1, marksEach: total, total }];
  for (const [subject, rows] of [["BAN", oral("মৌখিক", 10)], ["ENG", oral("Oral", 15)]] as const) {
    await ExamSyllabus.collection.insertOne({ examId, classId, subject, fullMarks: 100, bodyMd: "", marks: rows, questionTypes: [], status: "PUBLISHED", teacherBypass: false, createdBy: by, updatedBy: by });
  }
  const today = dhakaDayKey(new Date());
  const later = dhakaDayKey(new Date(Date.now() + 3 * 86_400_000));
  const slot = (dateKey: string, subject: string) => ({ classId, dateKey, subject, kind: "ORAL", start: "", end: "", note: "" });
  await ExamRoutine.collection.insertOne({ examId, slots: [slot(today, "BAN"), slot(later, "ENG")], noteBn: "", publishedAt: new Date(), updatedBy: by });

  await syncVivaPapers(P);
  const ctx = { auth: { userId: P, role: "PRINCIPAL", grantedPermissions: [], revokedPermissions: [], additionalTemplates: [] } } as unknown as AppContext;
  const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../assets/viva/nursery-sets-2026.json"), "utf8")) as {
    papers: { subject: string; sets: VivaSetInput[] }[];
  };
  const papers: Record<string, string> = {};
  for (const p of data.papers) {
    const paper = await VivaPaper.findOne({ classId, subject: p.subject }).lean();
    if (!paper) throw new Error(`no ${p.subject} oral paper`);
    await saveVivaPaper(ctx, String(paper._id), null, p.sets);
    papers[p.subject] = String(paper._id);
  }
  return { ...base, nursery: classId, nurserySection: sec.insertedId, kids, examId, papers };
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(uri);
    if (process.argv.includes("--reset")) await mongoose.connection.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
    const ids = await seedViva();
    console.log("fixture: viva (নার্সারি, 22 children, বাংলা oral today + ইংরেজি in 3 days, 4 sets each)");
    console.log(JSON.stringify(ids));
    await mongoose.disconnect();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

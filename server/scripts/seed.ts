/**
 * Dev seed — populates a blank DB with staff accounts + foundation data + a bit
 * of content so the Slice-4 frontend can be exercised end to end.
 *
 * Run from the repo root:  npx tsx server/scripts/seed.ts
 * Loads the repo-root .env explicitly (MONGODB_URI / JWT_SECRET).
 *
 * Idempotent: clears the collections it seeds, then recreates them.
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { connectDb, disconnectDb } from "../src/db";
import { hashPassword } from "../src/modules/foundation/services/AuthService";
import { User } from "../src/modules/foundation/models/User";
import { AcademicYear } from "../src/modules/foundation/models/AcademicYear";
import { Subject, FOUNDATION_SUBJECTS } from "../src/modules/foundation/models/Subject";
import { Class } from "../src/modules/foundation/models/Class";
import { Section } from "../src/modules/foundation/models/Section";
import { Student } from "../src/modules/foundation/models/Student";
import { ScopeGrant } from "../src/modules/foundation/models/ScopeGrant";
import { ContentArtifact } from "../src/modules/content/models/ContentArtifact";
import { AssessmentSet } from "../src/modules/assessment/models/AssessmentSet";
import { TrackerRecord } from "../src/modules/trackers/models/TrackerRecord";
import { SUBJECT_LABELS_BN, DEFAULT_SECTION_CODE, DEFAULT_SECTION_LABEL_BN } from "@scd/shared";

const CREDS = [
  { email: "enayetflweb@gmail.com", password: "Principal@123", role: "PRINCIPAL", name: "Md. Enayet (Principal)" },
  { email: "teacher@scd.test", password: "Teacher@123", role: "TEACHER", name: "Test Teacher" },
  { email: "office@scd.test", password: "Office@123", role: "OFFICE", name: "Test Office" },
] as const;

function q(
  qid: string,
  question_text: string,
  question_type: string,
  paper_role: string,
  bloom_level: string,
  difficulty: string,
  marks: number,
  extra: Record<string, unknown>,
) {
  return {
    docType: "question" as const,
    subject: "SCI",
    classLevel: 3,
    address: { anchorWord: "অধ্যায়", number: "1", title: "উদ্ভিদ ও প্রাণী" },
    curationTag: "KEEP_AS_IS" as const,
    reviewStatus: "reviewed" as const,
    current: true,
    envelopeJson: {
      doc_type: "question",
      subject: "SCI",
      tags: { topic_tag: "জীববিজ্ঞান", bloom_level, difficulty, paper_role },
      payload: { qid, question_text, question_type, paper_role, bloom_level, difficulty, marks, ...extra },
    },
  };
}

async function main(): Promise<void> {
  await connectDb();

  // Safety: this seed does deleteMany on Students etc. If a real roster is already
  // loaded (identity plane), refuse unless explicitly forced — protects production PII.
  const existingStudents = await Student.estimatedDocumentCount();
  if (existingStudents > 0 && process.env.SEED_FORCE !== "1") {
    console.error(
      `Refusing to seed: ${existingStudents} students already exist and this script does ` +
        `deleteMany (it would wipe the real roster). Set SEED_FORCE=1 to override on a throwaway DB.`,
    );
    await disconnectDb();
    process.exit(1);
  }

  console.log("Connected. Clearing seeded collections…");
  await Promise.all([
    User.deleteMany({}),
    AcademicYear.deleteMany({}),
    Subject.deleteMany({}),
    Class.deleteMany({}),
    Section.deleteMany({}),
    Student.deleteMany({}),
    ScopeGrant.deleteMany({}),
    ContentArtifact.deleteMany({}),
    AssessmentSet.deleteMany({}),
    TrackerRecord.deleteMany({}),
  ]);

  // --- Users ---------------------------------------------------------------
  const users: Record<string, import("mongoose").Types.ObjectId> = {};
  for (const c of CREDS) {
    const u = await User.create({
      email: c.email.toLowerCase(),
      passwordHash: await hashPassword(c.password),
      role: c.role,
      name: c.name,
      active: true,
    });
    users[c.role] = u._id;
  }

  // --- Academic year + subjects -------------------------------------------
  const year = await AcademicYear.create({
    label: "2026",
    startDate: new Date("2026-01-01"),
    endDate: new Date("2026-12-31"),
    current: true,
  });

  const subjectIds: Record<string, import("mongoose").Types.ObjectId> = {};
  for (const code of FOUNDATION_SUBJECTS) {
    const s = await Subject.create({ code, nameBn: SUBJECT_LABELS_BN[code], active: true });
    subjectIds[code] = s._id;
  }

  // --- Classes + sections --------------------------------------------------
  const class3 = await Class.create({ level: 3, nameBn: "তৃতীয় শ্রেণি", academicYearId: year._id, active: true });
  const c3Main = await Section.create({ classId: class3._id, code: DEFAULT_SECTION_CODE, nameBn: DEFAULT_SECTION_LABEL_BN, active: true });
  const c3B = await Section.create({ classId: class3._id, code: "B", nameBn: "খ", active: true });

  const class5 = await Class.create({ level: 5, nameBn: "পঞ্চম শ্রেণি", academicYearId: year._id, active: true });
  await Section.create({ classId: class5._id, code: DEFAULT_SECTION_CODE, nameBn: DEFAULT_SECTION_LABEL_BN, active: true });

  // --- Students (class 3, Main) -------------------------------------------
  const names = ["রহিম উদ্দিন", "করিম মিয়া", "ফাতেমা খাতুন", "আয়েশা সিদ্দিকা", "জসিম উদ্দিন", "সুমাইয়া আক্তার"];
  for (let i = 0; i < names.length; i++) {
    await Student.create({
      schoolId: `S-30${i + 1}`,
      name: names[i],
      classId: class3._id,
      sectionId: c3Main._id,
      active: true,
    });
  }

  // --- Scope grants for the test teacher ----------------------------------
  // teaching: write (assemble/tracker) on class 3 / Main / SCI
  await ScopeGrant.create({
    teacherId: users.TEACHER, kind: "teaching", active: true, createdBy: users.PRINCIPAL,
    classId: class3._id, sectionId: c3Main._id, subjectId: subjectIds.SCI,
  });
  // supervisory whole-school: read across all content (J1.6) — content read-scope
  // for teachers passes via a whole_school supervisory grant.
  await ScopeGrant.create({
    teacherId: users.TEACHER, kind: "supervisory", active: true, createdBy: users.PRINCIPAL,
    extent: "whole_school",
  });

  // --- Content: 2 session plans (with markdown) + 6 questions --------------
  await ContentArtifact.create({
    docType: "session_plan", subject: "SCI", classLevel: 3,
    address: { anchorWord: "অধ্যায়", number: "1", title: "উদ্ভিদ ও প্রাণী" },
    curationTag: "KEEP_AS_IS", reviewStatus: "gold", current: true,
    envelopeJson: { doc_type: "session_plan", subject: "SCI" },
    renderedMarkdown:
      "# অধ্যায় ১ — উদ্ভিদ ও প্রাণী\n\n## শিখনফল\n- উদ্ভিদ ও প্রাণীর মধ্যে পার্থক্য বলতে পারবে\n- পরিবেশে এদের ভূমিকা ব্যাখ্যা করতে পারবে\n\n## পাঠ পরিচালনা\n১. পরিচিত উদ্ভিদ ও প্রাণীর ছবি দেখানো হবে।\n২. শিক্ষার্থীরা দলে ভাগ হয়ে তালিকা তৈরি করবে।\n৩. শ্রেণিতে উপস্থাপন ও আলোচনা।\n\n## মূল্যায়ন\n- মৌখিক প্রশ্নোত্তর\n- শ্রেণি পরীক্ষা",
    importedBy: users.PRINCIPAL,
  });
  await ContentArtifact.create({
    docType: "session_plan", subject: "SCI", classLevel: 3,
    address: { anchorWord: "অধ্যায়", number: "2", title: "পানি ও বায়ু" },
    curationTag: "FLEXIBLE", reviewStatus: "reviewed", current: true,
    envelopeJson: { doc_type: "session_plan", subject: "SCI" },
    renderedMarkdown:
      "# অধ্যায় ২ — পানি ও বায়ু\n\n## শিখনফল\n- পানির তিন অবস্থা চিনতে পারবে\n- বায়ুর উপাদান সম্পর্কে ধারণা পাবে\n\n## পাঠ পরিচালনা\n১. পানির বরফ, তরল ও বাষ্প অবস্থা প্রদর্শন।\n২. বায়ু আছে—এমন সহজ পরীক্ষা।\n\n## মূল্যায়ন\n- বাড়ির কাজ: চারপাশে পানির ব্যবহার লেখো",
    importedBy: users.PRINCIPAL,
  });

  await ContentArtifact.insertMany([
    q("SCI-3-Q1", "নিচের কোনটি উদ্ভিদ?", "mcq", "mcq", "Remember", "easy", 1, {
      options: [
        { option_id: "A", text: "বিড়াল", is_correct: false },
        { option_id: "B", text: "আম গাছ", is_correct: true },
        { option_id: "C", text: "মাছ", is_correct: false },
        { option_id: "D", text: "পাখি", is_correct: false },
      ],
    }),
    q("SCI-3-Q2", "সূর্য পূর্ব দিকে ওঠে।", "true_false", "mcq", "Understand", "easy", 1, { tf_answer: true }),
    q("SCI-3-Q3", "সালোকসংশ্লেষণ কোথায় ঘটে?", "short_answer", "short", "Understand", "medium", 2, {
      answer_key: { accepted: ["পাতায়", "সবুজ পাতায়"], model_note: "ক্লোরোফিল-যুক্ত অংশে" },
    }),
    q("SCI-3-Q4", "উদ্ভিদ ______ গ্যাস গ্রহণ করে।", "fill_blank", "short", "Remember", "easy", 1, {
      blanks: [{ blank_no: 1, accepted: ["কার্বন ডাই-অক্সাইড", "CO2"] }],
    }),
    q("SCI-3-Q5", "মিল করো", "matching", "structured", "Analyze", "hard", 4, {
      pairs: [
        { left: "ফুসফুস", right: "শ্বসন" },
        { left: "শিকড়", right: "পানি শোষণ" },
      ],
    }),
    q("SCI-3-Q6", "উদ্ভিদ ও প্রাণীর তিনটি পার্থক্য লেখো।", "descriptive", "creative", "Create", "hard", 5, {}),
  ].map((d) => ({ ...d, importedBy: users.PRINCIPAL })));

  // --- Summary -------------------------------------------------------------
  console.log("\n========================  SEED COMPLETE  ========================");
  console.log("Login accounts (staff):");
  for (const c of CREDS) console.log(`  ${c.role.padEnd(9)}  ${c.email}   /   ${c.password}`);
  console.log("\nFor the Sets/Trackers tabs, paste this Academic Year _id into the");
  console.log("app's Section picker, then choose a class + section:");
  console.log(`  ACADEMIC_YEAR_ID = ${year._id.toString()}`);
  console.log("\nSeeded: 3 users, 1 academic year, 6 subjects, 2 classes");
  console.log(`  Class 3 "তৃতীয় শ্রেণি"  sections: Main(${c3Main._id})  B(${c3B._id})  — 6 students in Main`);
  console.log("  Class 5 \"পঞ্চম শ্রেণি\"  section: Main");
  console.log("  Content: 2 SCI session plans (with markdown) + 6 SCI questions (class 3)");
  console.log("\nTips:");
  console.log("  • Principal (enayetflweb) bypasses all scope — best for testing everything.");
  console.log("  • Teacher can READ all content (whole-school supervisory) but WRITE");
  console.log("    (assemble/tracker) only on Class 3 / Main (teaching grant).");
  console.log("  • Office sees only the Admin tab (content:import).");
  console.log("=================================================================\n");

  await disconnectDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

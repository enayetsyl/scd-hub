/**
 * Example school for LOCAL help-guide capture runs (prd-help-centre §5, HC-3).
 *
 * Create-only, and it refuses any database that is not a local in-memory one
 * (mongodb://127.0.0.1:<port>/), so it can never touch the school's data. Every person
 * here is an example; no real student, guardian or staff member appears in a picture
 * taken from it.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hc npx tsx scripts/help/fixture.ts [--reset]
 *
 * The base school (every area's fixture builds on it; see scripts/help/fixtures/):
 *   - 2026 academic year; ৩য় শ্রেণি (বালক, বালিকা) and ৫ম শ্রেণি (ক); six subjects;
 *     6 students per শাখা; one guardian login with two children.
 *   - Logins, password Help@123:
 *       principal@help.test  Principal            "উদাহরণ অধ্যক্ষ"
 *       office@help.test     Office               "উদাহরণ অফিস কর্মী"
 *       teacher@help.test    Teacher, class teacher of ৩য় বালক, teaches গণিত + বাংলা there
 *       teacher2@help.test   Teacher, class teacher of ৩য় বালিকা, teaches ইংরেজি + গণিত
 *       reviewer@help.test   Teacher + `mastery:review` ("উদাহরণ শিক্ষক"; the mastery spec)
 *       guardian 01800000001 Guardian of আরিফ (৩য় বালক) and নাফিসা (৩য় বালিকা)
 *   - Each staff login has a StaffProfile joined by phone, as on prod.
 * Prints the ids an area fixture needs as JSON on the last line.
 */
import mongoose, { Types } from "mongoose";
import { User } from "../../src/modules/foundation/models/User";
import { AcademicYear } from "../../src/modules/foundation/models/AcademicYear";
import { Class } from "../../src/modules/foundation/models/Class";
import { Section } from "../../src/modules/foundation/models/Section";
import { Subject } from "../../src/modules/foundation/models/Subject";
import { Student } from "../../src/modules/foundation/models/Student";
import { Guardian } from "../../src/modules/foundation/models/Guardian";
import { GuardianLink } from "../../src/modules/foundation/models/GuardianLink";
import { StaffProfile } from "../../src/modules/foundation/models/StaffProfile";
import { ScopeGrant } from "../../src/modules/foundation/models/ScopeGrant";
import { hashPassword } from "../../src/modules/foundation/services/AuthService";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  console.error("Refusing: MONGODB_URI must be a local in-memory database (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

const STUDENTS = {
  c3Boys: ["আরিফ হোসেন", "তানভীর আহমেদ", "রাফি ইসলাম", "সাকিব হাসান", "নাঈম উদ্দিন", "ফাহিম রহমান"],
  c3Girls: ["নাফিসা রহমান", "সাদিয়া আক্তার", "মারিয়া ইসলাম", "তাসনিম জাহান", "রিয়া খাতুন", "সুমাইয়া বেগম"],
  c5: ["জুনায়েদ করিম", "মাহিন হক", "ইফতি আলম", "লামিয়া সুলতানা", "নুসরাত জাহান", "আদিবা হক"],
};

export async function seedBaseSchool() {
  const passwordHash = await hashPassword("Help@123");
  const year = await AcademicYear.create({ label: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), current: true });

  const staff = [
    { key: "principal", email: "principal@help.test", phone: "01700000001", name: "উদাহরণ অধ্যক্ষ", role: "PRINCIPAL", category: "teacher" },
    { key: "office", email: "office@help.test", phone: "01700000002", name: "উদাহরণ অফিস কর্মী", role: "OFFICE", category: "office_accounts" },
    { key: "teacher", email: "teacher@help.test", phone: "01700000003", name: "উদাহরণ শ্রেণি শিক্ষক", role: "TEACHER", category: "teacher" },
    { key: "teacher2", email: "teacher2@help.test", phone: "01700000004", name: "উদাহরণ ইংরেজি শিক্ষক", role: "TEACHER", category: "teacher" },
    { key: "reviewer", email: "reviewer@help.test", phone: "01700000005", name: "উদাহরণ শিক্ষক", role: "TEACHER", category: "teacher", grants: ["mastery:review"] },
  ] as const;
  const users: Record<string, Types.ObjectId> = {};
  for (const [i, s] of staff.entries()) {
    const u = await User.create({
      email: s.email,
      phone: s.phone,
      name: s.name,
      role: s.role,
      passwordHash,
      active: true,
      grantedPermissions: "grants" in s ? [...s.grants] : [],
    });
    users[s.key] = u._id;
    await StaffProfile.create({
      schoolId: `S-${String(i + 1).padStart(2, "0")}`,
      name: s.name,
      phone: s.phone,
      category: s.category,
      employmentType: "full_time",
      employmentStatus: "confirmed",
      gender: i % 2 ? "female" : "male",
      active: true,
    });
  }

  const subjects: Record<string, Types.ObjectId> = {};
  for (const [code, nameBn] of [
    ["BAN", "বাংলা"],
    ["ENG", "ইংরেজি"],
    ["MATH", "গণিত"],
    ["SCI", "বিজ্ঞান"],
    ["BGS", "বাংলাদেশ ও বিশ্বপরিচয়"],
    ["ISLAM", "ইসলাম শিক্ষা"],
  ]) {
    subjects[code] = (await Subject.create({ code, nameBn }))._id;
  }

  const c3 = await Class.create({ level: 3, nameBn: "৩য় শ্রেণি", academicYearId: year._id, active: true });
  const c5 = await Class.create({ level: 5, nameBn: "৫ম শ্রেণি", academicYearId: year._id, active: true });
  const c3Boys = await Section.create({ classId: c3._id, code: "Boys", nameBn: "বালক", active: true, classTeacherId: users.teacher });
  const c3Girls = await Section.create({ classId: c3._id, code: "Girls", nameBn: "বালিকা", active: true, classTeacherId: users.teacher2 });
  const c5Main = await Section.create({ classId: c5._id, code: "Main", nameBn: "ক", active: true });

  const students: Record<string, Types.ObjectId[]> = { c3Boys: [], c3Girls: [], c5: [] };
  let n = 300;
  for (const [key, names] of Object.entries(STUDENTS)) {
    const [classId, sectionId, gender] =
      key === "c3Boys" ? [c3._id, c3Boys._id, "male"] : key === "c3Girls" ? [c3._id, c3Girls._id, "female"] : [c5._id, c5Main._id, undefined];
    for (const [i, name] of names.entries()) {
      n += 1;
      const s = await Student.create({
        schoolId: `E-${n}`,
        name,
        classId,
        sectionId,
        gender: gender ?? (i < 3 ? "male" : "female"),
      });
      students[key].push(s._id);
    }
  }

  const guardian = await Guardian.create({
    identifierKind: "phone",
    identifier: "01800000001",
    phone: "01800000001",
    name: "উদাহরণ অভিভাবক",
    passwordHash,
    loginEnabled: true,
    active: true,
  });
  await GuardianLink.create([
    { guardianId: guardian._id, studentId: students.c3Boys[0], relation: "বাবা", active: true },
    { guardianId: guardian._id, studentId: students.c3Girls[0], relation: "বাবা", active: true },
  ]);

  const grant = (teacherId: Types.ObjectId, classId: Types.ObjectId, sectionId: Types.ObjectId, subjectId: Types.ObjectId) => ({
    teacherId,
    kind: "teaching",
    active: true,
    source: "manual",
    createdBy: users.principal,
    classId,
    sectionId,
    subjectId,
  });
  await ScopeGrant.create([
    grant(users.teacher, c3._id, c3Boys._id, subjects.MATH),
    grant(users.teacher, c3._id, c3Boys._id, subjects.BAN),
    grant(users.teacher2, c3._id, c3Girls._id, subjects.ENG),
    grant(users.teacher2, c3._id, c3Girls._id, subjects.MATH),
    grant(users.teacher2, c5._id, c5Main._id, subjects.ENG),
  ]);

  return {
    yearId: year._id,
    users,
    subjects,
    classes: { c3: c3._id, c5: c5._id },
    sections: { c3Boys: c3Boys._id, c3Girls: c3Girls._id, c5: c5Main._id },
    students,
    guardianId: guardian._id,
  };
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(uri);
    // --reset: start a re-shoot from an empty database (still local-only, guarded above).
    if (process.argv.includes("--reset")) await mongoose.connection.dropDatabase();
    const ids = await seedBaseSchool();
    console.log("fixture: base school (2 classes, 3 শাখা, 18 students, 5 staff logins, 1 guardian)");
    console.log(JSON.stringify(ids));
    await mongoose.disconnect();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

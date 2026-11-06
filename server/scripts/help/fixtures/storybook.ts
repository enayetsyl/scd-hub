/**
 * Example data for the storybook-shelf and activity-sheet help guides (D-#980–#991, D-#1011).
 * LOCAL ONLY (the same guard as scripts/help/fixture.ts).
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hc npx tsx scripts/help/fixtures/storybook.ts --reset
 *
 * The base school, plus:
 *   - কেজি (শাখা ক), 6 children; teacher2@help.test is its শ্রেণি শিক্ষক. The storybook series
 *     are for ages 3–6 (Nursery, KG, Class 1), so the shelf needs a KG child to show anything.
 *   - guardian 01800000002 (password Help@123), "উদাহরণ মা", mother of আয়েশা (কেজি).
 * Nothing is switched on for guardians here: the switch guide's walk turns it on, as the
 * Principal would. The books and sheets come next, through the API, from the school's own
 * PDFs (see specs/storybook.cjs, its header has the commands).
 */
import mongoose from "mongoose";
import { seedBaseSchool } from "../fixture";
import { Class } from "../../../src/modules/foundation/models/Class";
import { Section } from "../../../src/modules/foundation/models/Section";
import { Student } from "../../../src/modules/foundation/models/Student";
import { Guardian } from "../../../src/modules/foundation/models/Guardian";
import { GuardianLink } from "../../../src/modules/foundation/models/GuardianLink";
import { hashPassword } from "../../../src/modules/foundation/services/AuthService";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  console.error("Refusing: MONGODB_URI must be a local in-memory database (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

const KG = ["আয়েশা সিদ্দিকা", "হামজা রহমান", "জারা ইসলাম", "ইউসুফ হোসেন", "মরিয়ম আক্তার", "সাদ আহমেদ"];

(async () => {
  await mongoose.connect(uri);
  if (process.argv.includes("--reset")) await mongoose.connection.dropDatabase();
  const base = await seedBaseSchool();

  const kg = await Class.create({ level: 0, nameBn: "কেজি", academicYearId: base.yearId, active: true });
  const kgMain = await Section.create({ classId: kg._id, code: "Main", nameBn: "ক", active: true, classTeacherId: base.users.teacher2 });
  const kids = [];
  for (const [i, name] of KG.entries()) {
    kids.push(await Student.create({ schoolId: `E-${401 + i}`, name, classId: kg._id, sectionId: kgMain._id, gender: i % 2 ? "male" : "female" }));
  }
  const mother = await Guardian.create({
    identifierKind: "phone",
    identifier: "01800000002",
    phone: "01800000002",
    name: "উদাহরণ মা",
    passwordHash: await hashPassword("Help@123"),
    loginEnabled: true,
    active: true,
  });
  await GuardianLink.create({ guardianId: mother._id, studentId: kids[0]._id, relation: "মা", active: true });

  console.log("fixture: base school + কেজি (৬ জন) + guardian 01800000002 (আয়েশা)");
  console.log(JSON.stringify({ ...base, kgClass: kg._id, kgSection: kgMain._id, kgGuardian: mother._id, aisha: kids[0]._id }));
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

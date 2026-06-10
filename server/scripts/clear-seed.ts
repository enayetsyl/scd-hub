/**
 * Surgically remove the identity-plane artifacts created by seed.ts that would
 * otherwise coexist with the real imported roster (D-#31). NON-DESTRUCTIVE to
 * real data: targets only the fake seed rows by stable, seed-specific keys.
 *
 * Clears ONLY:
 *   - Students with schoolId matching ^S-30[1-9]$  (seed's fake "S-30x" students)
 *   - Users  teacher@scd.test and office@scd.test  (seed's test logins)
 *   - ScopeGrants belonging to / created by those test users
 *
 * Deliberately LEAVES intact: the 2026 AcademicYear, the real principal login,
 * subjects, classes/sections (the import reuses them), and all demo content.
 *
 * Run from repo root:
 *   npx tsx server/scripts/clear-seed.ts            # dry-run: shows what would be deleted
 *   npx tsx server/scripts/clear-seed.ts --commit   # actually delete
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { connectDb, disconnectDb } from "../src/db";
import { User } from "../src/modules/foundation/models/User";
import { Student } from "../src/modules/foundation/models/Student";
import { ScopeGrant } from "../src/modules/foundation/models/ScopeGrant";

const COMMIT = process.argv.includes("--commit");
const SEED_STUDENT_RE = /^S-30[1-9]$/;
const SEED_USER_EMAILS = ["teacher@scd.test", "office@scd.test"];

async function main(): Promise<void> {
  console.log(COMMIT ? "Mode: COMMIT (deleting)\n" : "Mode: DRY-RUN (no deletes; pass --commit to apply)\n");
  await connectDb();

  // --- Identify targets -----------------------------------------------------
  const seedStudents = await Student.find({ schoolId: SEED_STUDENT_RE }).select("schoolId name").lean();
  const seedUsers = await User.find({ email: { $in: SEED_USER_EMAILS } }).select("email role").lean();
  const userIds = seedUsers.map((u) => u._id);
  const seedGrants = await ScopeGrant.find({
    $or: [{ teacherId: { $in: userIds } }, { createdBy: { $in: userIds } }],
  }).select("kind teacherId").lean();

  console.log(`Seed students (^S-30[1-9]$): ${seedStudents.length}`);
  for (const s of seedStudents) console.log(`  - ${s.schoolId}  ${s.name}`);
  console.log(`Seed users: ${seedUsers.length}`);
  for (const u of seedUsers) console.log(`  - ${u.email} (${u.role})`);
  console.log(`ScopeGrants tied to those users: ${seedGrants.length}`);

  // --- Delete ---------------------------------------------------------------
  if (COMMIT) {
    const g = await ScopeGrant.deleteMany({ $or: [{ teacherId: { $in: userIds } }, { createdBy: { $in: userIds } }] });
    const s = await Student.deleteMany({ schoolId: SEED_STUDENT_RE });
    const u = await User.deleteMany({ email: { $in: SEED_USER_EMAILS } });
    console.log(`\nDeleted: ${s.deletedCount} students, ${u.deletedCount} users, ${g.deletedCount} scope grants.`);
  } else {
    console.log("\nDRY-RUN complete — nothing deleted. Re-run with --commit to apply.");
  }

  await disconnectDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("Clear-seed failed:", err);
  process.exit(1);
});

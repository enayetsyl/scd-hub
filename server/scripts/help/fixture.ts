/**
 * Example data for a LOCAL help-guide capture run (prd-help-centre §5, HC-3).
 *
 * Create-only, and it refuses any database that is not a local in-memory one
 * (mongodb://127.0.0.1:<port>/), so it can never touch the school's data. Every name
 * is an example ("উদাহরণ …"); no real person appears in a picture taken from it.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27993/hc npx tsx scripts/help/fixture.ts [--reset]
 *
 * Logins (password Help@123): principal@help.test (Principal), reviewer@help.test
 * (teacher holding the per-person `mastery:review` grant, like the real reviewer).
 * The capture run itself imports the C1 Math objective tree through the app's import
 * screen, so the review screens show a real round.
 */
import mongoose from "mongoose";
import { User } from "../../src/modules/foundation/models/User";
import { AcademicYear } from "../../src/modules/foundation/models/AcademicYear";
import { hashPassword } from "../../src/modules/foundation/services/AuthService";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  console.error("Refusing: MONGODB_URI must be a local in-memory database (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

(async () => {
  await mongoose.connect(uri);
  // --reset: start a re-shoot from an empty database (still local-only, guarded above).
  if (process.argv.includes("--reset")) await mongoose.connection.dropDatabase();
  const passwordHash = await hashPassword("Help@123");
  await AcademicYear.create({ label: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), current: true });
  await User.create([
    { email: "principal@help.test", name: "উদাহরণ অধ্যক্ষ", role: "PRINCIPAL", passwordHash, active: true },
    {
      email: "reviewer@help.test",
      name: "উদাহরণ শিক্ষক",
      role: "TEACHER",
      passwordHash,
      active: true,
      grantedPermissions: ["mastery:review"],
    },
  ]);
  console.log("fixture: 1 academic year, 2 logins (principal@help.test, reviewer@help.test)");
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

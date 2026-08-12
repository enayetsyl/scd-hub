// READ-ONLY: run the REAL guardianEngagement service against the live DB and print the
// corrected figures, so the D-#467 fix is proven on real data rather than fixtures.
import "dotenv/config";
import mongoose from "mongoose";
import { readFileSync } from "fs";
import { guardianEngagement } from "../src/modules/engagement/services/GuardianEngagementService";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
const uri = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();

async function main() {
  await mongoose.connect(uri);
  console.log(`DB: ${mongoose.connection.name}\n`);

  const r = await guardianEngagement({ days: 90 });
  const s = r.summary;

  console.log("=== STUDENT-LEVEL REACHABILITY (the new headline) ===");
  console.log(`  students with a designated guardian: ${s.studentsTotal}`);
  console.log(`  reachable (family has signed in):    ${s.studentsReachable}`);
  console.log(`  NOT reachable:                       ${s.studentsUnreachable}`);
  console.log(`    of which no credentials issued:    ${s.studentsNoCredentials}`);

  console.log("\n=== DESIGNATED GUARDIANS ONLY ===");
  console.log(`  total (was: every guardian record):  ${s.totalGuardians}`);
  console.log(`  login enabled:  ${s.loginEnabled}`);
  console.log(`  ever logged in: ${s.everLoggedIn}`);
  console.log(`  never used it:  ${s.neverLoggedIn}   <-- the real chase list`);
  console.log(`  no login given: ${s.contactOnly}`);

  console.log("\n=== EXCLUSION (reported, not silent) ===");
  console.log(`  non-designated guardian records excluded: ${s.excludedNonDesignated}`);
  console.log(`  ...of those, login-enabled (would see an EMPTY portal): ${s.excludedButLoginEnabled}`);

  const bands = new Map<string, number>();
  for (const g of r.guardians) bands.set(g.band, (bands.get(g.band) ?? 0) + 1);
  console.log("\n=== BANDS ===");
  for (const [b, c] of [...bands.entries()].sort()) console.log(`  ${b.padEnd(12)} ${c}`);

  console.log("\n=== INVARIANTS ===");
  const ok: [string, boolean][] = [
    ["rows == totalGuardians", r.guardians.length === s.totalGuardians],
    ["no row lacks a child (every row is a designated guardian)", r.guardians.every((g) => g.childNames.length > 0)],
    ["NO_LOGIN rows are exactly the contact-only ones", (bands.get("NO_LOGIN") ?? 0) === s.contactOnly],
    ["NEVER rows are exactly the never-logged-in tile", (bands.get("NEVER") ?? 0) === s.neverLoggedIn],
    ["reachable + unreachable == studentsTotal", s.studentsReachable + s.studentsUnreachable === s.studentsTotal],
    ["most-actionable first", r.guardians.length < 2 || ["NO_LOGIN", "NEVER"].includes(r.guardians[0].band)],
  ];
  let bad = 0;
  for (const [label, pass] of ok) { console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`); if (!pass) bad++; }

  const noChild = r.guardians.filter((g) => g.childNames.length === 0);
  if (noChild.length) console.log(`\n  !! ${noChild.length} childless rows leaked: ${noChild.slice(0, 5).map((g) => g.name).join(", ")}`);

  await mongoose.disconnect();
  console.log(`\nRESULT: ${bad === 0 ? "PASS" : "FAIL"}`);
  process.exit(bad === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

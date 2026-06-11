/**
 * Live verification for credential provisioning (D-#59/#60) against real Atlas data.
 *
 * Default = READ-ONLY: reports the guardian-family grouping + staff candidates so we
 * can sanity-check the real roster (e.g. spot a phone shared by an implausible number
 * of students BEFORE provisioning links them all together).
 *
 * With --provision <phone> and/or --staff <staffId>: actually provisions that one
 * target, then verifies the generated password authenticates (proves end-to-end).
 *
 *   npx tsx server/scripts/verify-provisioning.ts                       # read-only report
 *   npx tsx server/scripts/verify-provisioning.ts --provision 01XXXXXXX # provision one family
 *   npx tsx server/scripts/verify-provisioning.ts --staff <staffId>     # provision one staff
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { connectDb, disconnectDb } from "../src/db";
import {
  guardianCredentialCandidates,
  staffCredentialCandidates,
  provisionGuardianLogin,
  provisionStaffLogin,
} from "../src/modules/foundation/services/ProvisioningService";
import { guardianLogin, staffLogin } from "../src/modules/foundation/services/AuthService";

const argFor = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const provisionPhone = argFor("--provision");
const provisionStaffId = argFor("--staff");
const ACTOR = { userId: undefined, role: "PRINCIPAL" };

async function main(): Promise<void> {
  await connectDb();

  // --- Guardian families (read-only) ---------------------------------------
  const fams = await guardianCredentialCandidates();
  const sizes = fams.map((f) => f.students.length);
  const withLogin = fams.filter((f) => f.loginEnabled).length;
  const big = fams.filter((f) => f.students.length >= 6);
  console.log("=== Guardian families (grouped by Student.phone) ===");
  console.log(`families: ${fams.length}  |  already have login: ${withLogin}`);
  console.log(`family-size distribution: ${JSON.stringify(tally(sizes))}`);
  console.log(`multi-child families (>=2): ${sizes.filter((n) => n >= 2).length}`);
  if (big.length) {
    console.log(`⚠ ${big.length} phone(s) group >=6 students (possible shared/default number — review before provisioning):`);
    for (const f of big.slice(0, 5)) console.log(`   ${f.phone} -> ${f.students.length} students (${f.suggestedName})`);
  }
  console.log("sample multi-child families:");
  for (const f of fams.filter((f) => f.students.length >= 2).slice(0, 5)) {
    console.log(`   ${f.phone}  ${f.suggestedName}  -> ${f.students.map((s) => `${s.name}/${s.className}`).join(", ")}`);
  }

  // --- Staff candidates (read-only) ----------------------------------------
  const staff = await staffCredentialCandidates();
  console.log("\n=== Staff candidates ===");
  console.log(`total: ${staff.length}  |  provisionable: ${staff.filter((s) => s.provisionable).length}  |  has login: ${staff.filter((s) => s.loginExists).length}`);
  console.log(`not provisionable: ${staff.filter((s) => !s.provisionable).map((s) => `${s.name}(${s.category}/${s.reason})`).join(", ") || "none"}`);
  console.log("by mapped role:", JSON.stringify(tally(staff.filter((s) => s.mappedRole).map((s) => s.mappedRole as string))));
  console.log("sample provisionable staff ids:");
  for (const s of staff.filter((s) => s.provisionable && !s.loginExists).slice(0, 3)) {
    console.log(`   ${s.staffId}  ${s.name}  ${s.category}->${s.mappedRole}  ${s.phone}`);
  }

  // --- Optional: provision one + verify login ------------------------------
  if (provisionPhone) {
    console.log(`\n=== Provisioning guardian login for ${provisionPhone} ===`);
    const cred = await provisionGuardianLogin(provisionPhone, ACTOR);
    console.log(`  id=${cred.identifier}  password=${cred.password}  covers=${cred.studentCount} students  alreadyExisted=${cred.alreadyExisted}`);
    const login = await guardianLogin({ identifier: cred.identifier, identifierKind: "phone", password: cred.password });
    console.log(`  login check: ${login ? "✓ SUCCESS as " + login.name : "✗ FAILED"}`);
    console.log(`  wa.me: ${cred.waLink}`);
  }
  if (provisionStaffId) {
    console.log(`\n=== Provisioning staff login for ${provisionStaffId} ===`);
    const cred = await provisionStaffLogin(provisionStaffId, ACTOR);
    console.log(`  id=${cred.identifier}  password=${cred.password}  role=${cred.contextLabel}  alreadyExisted=${cred.alreadyExisted}`);
    const login = await staffLogin({ email: cred.identifier, password: cred.password });
    console.log(`  login check: ${login ? "✓ SUCCESS as " + login.name + " (" + login.role + ")" : "✗ FAILED"}`);
    console.log(`  wa.me: ${cred.waLink}`);
  }

  if (!provisionPhone && !provisionStaffId) {
    console.log("\n(read-only — pass --provision <phone> and/or --staff <staffId> to provision one target and verify login)");
  }

  await disconnectDb();
}

function tally(arr: (string | number)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of arr) out[String(v)] = (out[String(v)] ?? 0) + 1;
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

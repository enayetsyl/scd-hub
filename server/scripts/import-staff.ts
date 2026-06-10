/**
 * Load the real staff roster into MongoDB from the normalized JSON produced by
 * extract-staff.py. Identity/operational-plane HR data (prd-hr H1).
 *
 * Run from repo root (after extract-staff.py has written staff.json):
 *   npx tsx server/scripts/import-staff.ts            # dry-run: counts only, no writes
 *   npx tsx server/scripts/import-staff.ts --commit   # actually upsert into Atlas
 *
 * Loads the repo-root .env (MONGODB_URI / JWT_SECRET).
 *
 * IDEMPOTENT and NON-DESTRUCTIVE: upserts StaffProfile by schoolId. Unlike
 * seed.ts it NEVER clears a collection — safe to re-run against live data.
 * Creates no `User` logins (data-only this slice — login is optional/separate, H1.2).
 */
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { connectDb, disconnectDb } from "../src/db";
import { StaffProfile } from "../src/modules/foundation/models/StaffProfile";
import {
  HR_CATEGORIES,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_STATUSES,
  type HrCategory,
  type EmploymentType,
  type EmploymentStatus,
} from "@scd/shared";

const COMMIT = process.argv.includes("--commit");

type StaffRec = {
  schoolId: string;
  name: string;
  nameBn: string | null;
  category: string;
  designation: string | null;
  employmentType: string;
  employmentStatus: string;
  joiningDate: string | null;
  biometricId: string | null;
  gender: "male" | "female" | "other" | null;
  dob: string | null;
  bloodGroup: string | null;
  maritalStatus: string | null;
  nationality: string | null;
  qualification: string | null;
  majoredIn: string | null;
  studiedAt: string | null;
  fatherName: string | null;
  motherName: string | null;
  spouseName: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  presentAddress: string | null;
  permanentAddress: string | null;
  nid: string | null;
  bankAccount: string | null;
};

const d = (s: string | null) => (s ? new Date(s) : undefined);
const u = <T,>(v: T | null) => (v ?? undefined);

function validateVocab(s: StaffRec): string[] {
  const errs: string[] = [];
  if (!HR_CATEGORIES.includes(s.category as HrCategory)) errs.push(`category=${s.category}`);
  if (!EMPLOYMENT_TYPES.includes(s.employmentType as EmploymentType)) errs.push(`employmentType=${s.employmentType}`);
  if (!EMPLOYMENT_STATUSES.includes(s.employmentStatus as EmploymentStatus)) errs.push(`employmentStatus=${s.employmentStatus}`);
  return errs;
}

async function main(): Promise<void> {
  const jsonPath = path.resolve(__dirname, "staff.json");
  if (!fs.existsSync(jsonPath)) {
    console.error(`Missing ${jsonPath} — run extract-staff.py first.`);
    process.exit(1);
  }
  const { staff } = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as { staff: StaffRec[] };
  console.log(`Loaded ${staff.length} staff from JSON.`);
  console.log(COMMIT ? "Mode: COMMIT (writing to DB)\n" : "Mode: DRY-RUN (no writes; pass --commit to write)\n");

  // Validate controlled vocab before any write.
  const bad = staff.flatMap((s) => {
    const errs = validateVocab(s);
    return errs.length ? [`  ${s.schoolId} ${s.name}: ${errs.join(", ")}`] : [];
  });
  if (bad.length) {
    console.error(`Vocab validation failed for ${bad.length} row(s):\n${bad.join("\n")}`);
    process.exit(1);
  }

  // By-category breakdown for the operator.
  const byCat = new Map<string, number>();
  for (const s of staff) byCat.set(s.category, (byCat.get(s.category) ?? 0) + 1);
  for (const [c, n] of [...byCat].sort()) console.log(`  ${c.padEnd(16)} ${n}`);

  await connectDb();

  let upserted = 0;
  for (const s of staff) {
    if (COMMIT) {
      await StaffProfile.findOneAndUpdate(
        { schoolId: s.schoolId },
        {
          $set: {
            name: s.name,
            nameBn: u(s.nameBn),
            category: s.category,
            designation: u(s.designation),
            employmentType: s.employmentType,
            employmentStatus: s.employmentStatus,
            joiningDate: d(s.joiningDate),
            biometricId: u(s.biometricId),
            gender: u(s.gender),
            dob: d(s.dob),
            bloodGroup: u(s.bloodGroup),
            maritalStatus: u(s.maritalStatus),
            nationality: u(s.nationality),
            qualification: u(s.qualification),
            majoredIn: u(s.majoredIn),
            studiedAt: u(s.studiedAt),
            fatherName: u(s.fatherName),
            motherName: u(s.motherName),
            spouseName: u(s.spouseName),
            phone: u(s.phone),
            whatsapp: u(s.whatsapp),
            email: u(s.email),
            presentAddress: u(s.presentAddress),
            permanentAddress: u(s.permanentAddress),
            nid: u(s.nid),
            bankAccount: u(s.bankAccount),
            active: true,
          },
        },
        { upsert: true, new: true },
      );
    }
    upserted++;
  }

  console.log(`\n${COMMIT ? "Upserted" : "Would upsert"}: ${upserted} StaffProfiles`);
  if (!COMMIT) console.log("\nDRY-RUN complete — no data written. Re-run with --commit to apply.");

  await disconnectDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});

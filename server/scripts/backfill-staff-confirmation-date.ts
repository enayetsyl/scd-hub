/**
 * One-time backfill for the SH-3 probation ledger (D-#540). Run ONCE, BEFORE the Staff
 * Hub reaches an environment with real staff in it.
 *
 * WHY IT IS REQUIRED. From SH-3 on, probation is decided by a DATE: leave starting
 * before `StaffProfile.confirmationDate` is unpaid and HELD on the ProbationLeaveDebt
 * ledger. `confirmationDate` is a new field, so it is absent on every existing row —
 * and an absent date reads as "still on probation". Without this backfill, the next
 * approved casual/sick leave for every already-confirmed member of staff would be
 * recorded as probation leave: 0 paid days, the annual pool untouched, and a debt
 * accruing to be collected at exit. Their salary is safe (payroll excludes held days,
 * D-#540), but their leave balance would be wrong and a debt would build silently.
 *
 * WHAT IT DOES. For every staff member whose `employmentStatus` is already `confirmed`
 * and who has NO `confirmationDate`, stamp one — using, in order of preference:
 *   1. `joiningDate`, if present. The honest reading: the app has no record of a
 *      probation period for these people, so treating their whole service as confirmed
 *      matches how their leave has actually been administered until now.
 *   2. today, if there is no joining date either. Anything else would invent history.
 *
 * `probation` staff are deliberately LEFT ALONE — they really are on probation, and the
 * new rule is correct for them from the moment it lands. So are `resigned`/`terminated`/
 * `retired`/`contract_ended` rows: they take no more leave, and stamping a date on a
 * closed record only invents a fact nobody checked.
 *
 * Idempotent: a row that already has a `confirmationDate` is skipped, so re-running is
 * safe. DRY-RUN by default; pass --commit to write. Uses MONGODB_URI from env (never
 * printed) — check `databaseName` in the output before committing, the repo `.env`
 * points at a TEST copy whose ObjectIds match prod.
 *
 *   npx tsx server/scripts/backfill-staff-confirmation-date.ts            # dry-run
 *   npx tsx server/scripts/backfill-staff-confirmation-date.ts --commit   # apply
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../src/db";
import { StaffProfile } from "../src/modules/foundation/models/StaffProfile";

const COMMIT = process.argv.includes("--commit");

/** UTC midnight for a Date, matching how every other profile date is stored (D-#545). */
function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function main(): Promise<void> {
  await connectDb();
  console.log(`databaseName: ${mongoose.connection.db?.databaseName ?? "(unknown)"}`);
  console.log(COMMIT ? "MODE: COMMIT (writing)" : "MODE: dry-run (no writes)");

  const candidates = await StaffProfile.find({
    employmentStatus: "confirmed",
    confirmationDate: { $exists: false },
  })
    .select("schoolId name employmentStatus joiningDate")
    .lean();

  const today = utcMidnight(new Date());
  let fromJoining = 0;
  let fromToday = 0;

  for (const s of candidates) {
    const stamp = s.joiningDate ? utcMidnight(new Date(s.joiningDate)) : today;
    if (s.joiningDate) fromJoining++;
    else fromToday++;
    console.log(
      `  ${s.schoolId}  ${s.name}  →  ${stamp.toISOString().slice(0, 10)}` +
        (s.joiningDate ? "  (joining date)" : "  (today — no joining date on file)"),
    );
    if (COMMIT) {
      await StaffProfile.updateOne({ _id: s._id }, { $set: { confirmationDate: stamp } });
    }
  }

  // Reported, not touched — so the operator can see the rule is landing correctly for
  // the people it IS meant to apply to.
  const stillProbation = await StaffProfile.countDocuments({ employmentStatus: "probation" });
  const alreadyStamped = await StaffProfile.countDocuments({ confirmationDate: { $exists: true } });

  console.log("");
  console.log(`confirmed, needed a date : ${candidates.length}`);
  console.log(`  └ from joiningDate     : ${fromJoining}`);
  console.log(`  └ from today           : ${fromToday}`);
  console.log(`already had a date       : ${alreadyStamped} (skipped)`);
  console.log(`left on probation        : ${stillProbation} (deliberately untouched)`);
  if (!COMMIT) console.log("\nDry run — nothing written. Re-run with --commit to apply.");

  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDb();
  process.exit(1);
});

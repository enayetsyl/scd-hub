/**
 * Charge the lateness that predates the first payroll run (D-#616).
 *
 *   npx tsx server/scripts/backfill-lateness-charges.ts --from 2026-01 --to 2026-07
 *   ... --write
 *
 * WHY. A lateness charge is normally computed when a payroll run is PREPARED and frozen
 * when it is approved. The school is starting payroll from August, so January–July would
 * never be computed at all — the lates are imported and visible, and they would cost
 * nothing. The owner's instruction was to settle them against the leave balance anyway,
 * so the balances are right before the first run.
 *
 * It uses the same `splitLatenessCharge` the payroll path uses, so a backfilled month
 * cannot disagree with a run month. Since D-#616 the whole charge lands on the leave
 * balance — nothing here can reach anyone's salary, which is what makes it safe to run
 * for months that were already paid outside the app.
 *
 * IDEMPOTENT. One charge row per (staff, month); re-running recomputes rather than
 * stacking. DRY RUN by default.
 */
import "dotenv/config";
import { Types } from "mongoose";
import { connectDb, disconnectDb } from "../src/db";
import { TeacherAttendanceDay } from "../src/modules/attendance/models/TeacherAttendanceDay";
import { LatenessCharge } from "../src/modules/hr/models/LatenessCharge";
import { StaffProfile } from "../src/modules/foundation/models/StaffProfile";
import { User } from "../src/modules/foundation/models/User";
import { splitLatenessCharge } from "../src/modules/hr/services/LatenessService";
import { getHrPolicy } from "../src/modules/hr/services/HrPolicyService";

const WRITE = process.argv.includes("--write");
const arg = (f: string): string | undefined => {
  const i = process.argv.indexOf(f);
  return i === -1 ? undefined : process.argv[i + 1];
};

async function main(): Promise<void> {
  const from = arg("--from") ?? "2026-01";
  const to = arg("--to") ?? "2026-07";
  await connectDb();
  console.log(`months ${from} .. ${to}   ${WRITE ? "*** WRITING ***" : "*** DRY RUN — no writes ***"}\n`);

  const policy = await getHrPolicy();
  const perCharge = policy.lateDaysPerCharge;
  console.log(`lateDaysPerCharge = ${perCharge}   (latenessRuleEnabled = ${policy.latenessRuleEnabled})\n`);

  const actor = await User.findOne({ role: "PRINCIPAL" }).lean();
  if (!actor) throw new Error("no PRINCIPAL user to attribute the charges to");

  const staff = await StaffProfile.find({}).select("name monthlySalary").lean();
  const nameOf = new Map(staff.map((s) => [s._id.toString(), s.name]));

  // LATE days in the window, grouped per staff per calendar month — the rule resets
  // monthly and the leftover 1–2 are forgiven, which is why this cannot be a total.
  const rows = await TeacherAttendanceDay.find({
    status: "LATE",
    dateKey: { $gte: `${from}-01`, $lte: `${to}-31` },
  })
    .select("staffProfileId dateKey")
    .lean();

  const counts = new Map<string, number>();
  const datesFor = new Map<string, string[]>();
  for (const r of rows) {
    const key = `${r.staffProfileId.toString()}|${r.dateKey.slice(0, 7)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    datesFor.set(key, [...(datesFor.get(key) ?? []), r.dateKey].sort());
  }

  let charged = 0, rowsWritten = 0, forgiven = 0;
  const perStaff = new Map<string, number>();

  for (const [key, lateCount] of [...counts].sort()) {
    const [staffId, monthKey] = key.split("|");
    // poolRemaining is ignored since D-#616 — the whole charge goes to the balance.
    const split = splitLatenessCharge(lateCount, perCharge, 0);
    forgiven += split.forgivenLates;
    if (split.chargedDays === 0) continue;
    charged += split.chargedDays;
    perStaff.set(staffId, (perStaff.get(staffId) ?? 0) + split.chargedDays);

    if (WRITE) {
      await LatenessCharge.findOneAndUpdate(
        { staffProfileId: new Types.ObjectId(staffId), monthKey },
        {
          $set: {
            lateDateKeys: datesFor.get(key) ?? [],
            lateDaysPerCharge: perCharge,
            chargedDays: split.chargedDays,
            paidFromLeave: split.paidFromLeave,
            chargedToSalary: split.chargedToSalary,
            dayRate: 0, // no salary component (D-#616), so the rate is not priced in
            amount: 0,
            payrollRunId: null,
            frozen: true,
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );
      rowsWritten++;
    }
  }

  console.log("name".padEnd(24) + "charge-days");
  for (const [id, days] of [...perStaff].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(nameOf.get(id) ?? id).padEnd(22)} ${String(days).padStart(3)}`);
  }
  console.log(`\n${WRITE ? "written" : "would write"}: ${charged} charge-days across ${perStaff.size} staff` +
    (WRITE ? ` (${rowsWritten} monthly rows)` : ""));
  console.log(`late days forgiven as month-end leftovers: ${forgiven}`);
  console.log("\nThese come off the LEAVE BALANCE only — no salary is affected (D-#616).");
  await disconnectDb();
}

main().catch(async (e) => {
  console.error("ABORTED: " + (e as Error).message);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});

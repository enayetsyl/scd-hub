/**
 * Turn imported ℞ attendance into real leave applications (D-#615).
 *
 *   npx tsx server/scripts/backfill-leave-from-attendance.ts            # dry run
 *   ... --write                                                        # do it
 *   ... --skip "Name"                                                  # exclude someone (repeatable)
 *
 * WHY. After D-#611 the biometric ℞ days are stored as attendance `LEAVE`, so the
 * staff hub finally SHOWS leave. But the leave POOL and payroll are driven by approved
 * leave APPLICATIONS — `takenPooledDays` reads applications, and payroll's only
 * attendance-shaped deduction is unpaid days off an application. Nothing bridges the
 * two, so 117 recorded leave days moved nobody's balance and nobody's pay.
 *
 * This walks each staff member's LEAVE days, groups them into contiguous spells, and
 * files each spell through the REAL service path — `applyForLeave` then
 * `decideLeave(approve)` — never by writing rows. That matters: approval is where the
 * probation hold (D-#540), the pooled paid/unpaid split and the debt ledger happen. A
 * hand-written row would reimplement all three and drift from the path the app uses.
 *
 * DEDUPE. Ten staff already applied through the app; a day already covered by a
 * non-rejected application is skipped, so re-running this cannot double-count.
 *
 * DELIBERATELY NOT AUTOMATIC:
 *   - HALF DAYS (℞◑/℞◐). The app's partial day is late-entry/early-leave at 1/3 of a
 *     day; the biometric's is a half. Filing them as full days would silently overstate
 *     the pool, so they are listed for a human instead.
 *   - ✘ ABSENT days. The marking is not reliable — one staff member's entire leave was
 *     entered as ✘ — so only a person can say which absences were leave. They are
 *     reported grouped into blocks, never filed.
 */
import "dotenv/config";
import { connectDb, disconnectDb } from "../src/db";
import { TeacherAttendanceDay } from "../src/modules/attendance/models/TeacherAttendanceDay";
import { StaffLeaveApplication } from "../src/modules/hr/models/StaffLeaveApplication";
import { StaffProfile } from "../src/modules/foundation/models/StaffProfile";
import { User } from "../src/modules/foundation/models/User";
import { applyForLeave, decideLeave } from "../src/modules/hr/services/StaffLeaveService";

const WRITE = process.argv.includes("--write");
const SKIP = process.argv.reduce<string[]>((a, x, i) => (x === "--skip" && process.argv[i + 1] ? [...a, process.argv[i + 1]] : a), []);
const ONLY = process.argv.reduce<string[]>((a, x, i) => (x === "--only" && process.argv[i + 1] ? [...a, process.argv[i + 1]] : a), []);
/**
 * The leave type to file under. Default `casual` — pooled, so approval draws the
 * allowance and the split falls out. `unpaid_lwp` is neither paid NOR balance-tracked,
 * which is the shape of "we did not pay her for these days and her balance is
 * unchanged": one teacher's 30 days in 2026 were exactly that.
 */
// indexOf returns -1 when the flag is absent, and argv[-1 + 1] is argv[0] — the node
// binary. That shipped as the leave type on the first run; applyForLeave rejected all
// 50 before writing anything, which is the only reason it was a nuisance and not a mess.
const typeIdx = process.argv.indexOf("--type");
const TYPE = (typeIdx === -1 ? "casual" : process.argv[typeIdx + 1]) as "casual" | "unpaid_lwp";
const REASON = "Recorded from the biometric attendance report (℞)";

const nextDay = (iso: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

interface Spell { from: string; to: string; days: number }

/** Contiguous calendar runs. A gap of any length starts a new spell. */
function spellsOf(dates: string[]): Spell[] {
  const out: Spell[] = [];
  for (const d of [...dates].sort()) {
    const last = out[out.length - 1];
    if (last && d === nextDay(last.to)) { last.to = d; last.days++; } else out.push({ from: d, to: d, days: 1 });
  }
  return out;
}

async function main(): Promise<void> {
  await connectDb();
  console.log(WRITE ? "*** WRITING ***\n" : "*** DRY RUN — no writes ***\n");

  const actor = await User.findOne({ role: "PRINCIPAL" }).lean();
  if (!actor) throw new Error("no PRINCIPAL user to attribute the applications to");

  const staff = await StaffProfile.find({}).select("name").lean();
  const nameOf = new Map(staff.map((s) => [s._id.toString(), s.name]));

  const rows = await TeacherAttendanceDay.find({ status: "LEAVE" }).select("staffProfileId dateKey halfDay").lean();
  const existing = await StaffLeaveApplication.find({ status: { $ne: "rejected" } }).select("staffProfileId fromKey toKey").lean();

  /** Every date already covered by a live application, per staff. */
  const covered = new Map<string, Set<string>>();
  for (const a of existing) {
    const key = a.staffProfileId.toString();
    if (!covered.has(key)) covered.set(key, new Set());
    for (let d = a.fromKey; d <= a.toKey; d = nextDay(d)) covered.get(key)!.add(d);
  }

  const byStaff = new Map<string, { full: string[]; half: string[] }>();
  for (const r of rows) {
    const key = r.staffProfileId.toString();
    if (!byStaff.has(key)) byStaff.set(key, { full: [], half: [] });
    (r.halfDay ? byStaff.get(key)!.half : byStaff.get(key)!.full).push(r.dateKey);
  }

  let filed = 0, days = 0, skippedCovered = 0, halfFlagged = 0, skippedStaff = 0;
  const problems: string[] = [];

  for (const [staffId, sets] of byStaff) {
    const name = nameOf.get(staffId) ?? staffId;
    if (ONLY.length > 0 && !ONLY.includes(name)) continue;
    if (SKIP.includes(name)) {
      console.log(`  ${name.padEnd(24)} SKIPPED by --skip (${sets.full.length + sets.half.length} leave days)`);
      skippedStaff++;
      continue;
    }
    const cov = covered.get(staffId) ?? new Set<string>();
    const todo = sets.full.filter((d) => !cov.has(d));
    skippedCovered += sets.full.length - todo.length;
    halfFlagged += sets.half.length;

    const spells = spellsOf(todo);
    if (spells.length === 0 && sets.half.length === 0) continue;
    console.log(`  ${name.padEnd(24)} ${String(todo.length).padStart(3)} day(s) in ${spells.length} spell(s)` +
      (sets.half.length ? `   [${sets.half.length} HALF-DAY not filed: ${sets.half.join(", ")}]` : "") +
      (sets.full.length - todo.length ? `   [${sets.full.length - todo.length} already covered]` : ""));

    for (const s of spells) {
      console.log(`      ${s.from}${s.from === s.to ? "" : " → " + s.to}  ${s.days}d`);
      if (!WRITE) { filed++; days += s.days; continue; }
      try {
        const app = await applyForLeave({
          staffProfileId: staffId, leaveType: TYPE,
          fromKey: s.from, toKey: s.to, reason: REASON, actorId: actor._id.toString(),
        });
        const decided = await decideLeave(app._id.toString(), "approve", actor._id.toString(), REASON);
        console.log(`        -> paid ${decided.paidDays}  unpaid ${decided.unpaidDays}  held ${decided.probationHeld ?? false}`);
        filed++; days += s.days;
      } catch (e) {
        problems.push(`${name} ${s.from}..${s.to}: ${(e as Error).message}`);
      }
    }
  }

  console.log(`\n${WRITE ? "filed" : "would file"}: ${filed} application(s), ${days} day(s)`);
  console.log(`already covered by an existing application: ${skippedCovered} day(s)`);
  console.log(`half-days NOT filed (need a human): ${halfFlagged}`);
  if (skippedStaff) console.log(`staff skipped by --skip: ${skippedStaff}`);
  if (problems.length) { console.log("\nPROBLEMS:"); for (const p of problems) console.log("  " + p); }

  // The ✘ worklist — never filed, only reported.
  console.log("\n=== ABSENCE BLOCKS FOR REVIEW (✘ — not filed) ===");
  const abs = await TeacherAttendanceDay.find({ status: "ABSENT" }).select("staffProfileId dateKey").lean();
  const absBy = new Map<string, string[]>();
  for (const r of abs) {
    const key = r.staffProfileId.toString();
    absBy.set(key, [...(absBy.get(key) ?? []), r.dateKey]);
  }
  let blocks = 0;
  for (const [staffId, dates] of [...absBy].sort((a, b) => b[1].length - a[1].length)) {
    const sp = spellsOf(dates);
    blocks += sp.length;
    console.log(`  ${(nameOf.get(staffId) ?? staffId).padEnd(24)} ${String(dates.length).padStart(3)} day(s) in ${sp.length} block(s)`);
    for (const s of sp) console.log(`      ${s.from}${s.from === s.to ? "" : " → " + s.to}  ${s.days}d`);
  }
  console.log(`\n${abs.length} absence days in ${blocks} blocks across ${absBy.size} people`);
  await disconnectDb();
}

main().catch(async (e) => {
  console.error("ABORTED: " + (e as Error).message);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});

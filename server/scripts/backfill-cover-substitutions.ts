/**
 * Backfill the RoutineSubstitution for leave-cover slots approved BEFORE the fix
 * (owner 2026-07-26). The leave-cover flow (CoverService) minted a proxy grant but
 * never a RoutineSubstitution, so the routine-based gates — publishClassNote and the
 * homework accessible-class list — didn't recognise the cover teacher: they couldn't
 * submit class notes or homework for the covered class.
 *
 * This finds every APPROVED section cover slot that has a proxy grant + routineSlotId
 * but no matching RoutineSubstitution, and creates it (linking proxyGrantId).
 *
 * DRY RUN by default — lists what would be created and writes nothing.
 *   npx tsx server/scripts/backfill-cover-substitutions.ts            # preview
 *   npx tsx server/scripts/backfill-cover-substitutions.ts --apply    # create
 *
 * Idempotent: skips slots that already have the substitution. Run on the VM
 * (/opt/scdhub/prod) where MONGODB_URI resolves to prod.
 */
import { Types } from "mongoose";
import { connectDb } from "../src/db";
import { StaffCoverSlot } from "../src/modules/hr/models/StaffCoverSlot";
import { RoutineSubstitution } from "../src/modules/routine/models/RoutineSubstitution";
import { RoutineSlot } from "../src/modules/routine/models/RoutineSlot";
import { parseDateKey } from "../src/modules/hr/services/dates";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await connectDb();

  const slots = await StaffCoverSlot.find({
    status: "approved",
    groupType: "section",
    proxyGrantId: { $ne: null },
    routineSlotId: { $ne: null },
    finalCoverTeacherUserId: { $ne: null },
  }).select("dateKey periodNumber routineSlotId finalCoverTeacherUserId absentTeacherUserId proxyGrantId");

  console.log(`Approved section covers with a proxy grant: ${slots.length}${apply ? " (APPLY)" : " (dry run)"}`);

  let created = 0;
  let skipped = 0;
  for (const slot of slots) {
    const date = parseDateKey(slot.dateKey);
    const cover = slot.finalCoverTeacherUserId!;
    const existing = await RoutineSubstitution.findOne({
      slotId: slot.routineSlotId,
      date,
      coverTeacherId: cover,
    }).lean();
    if (existing) {
      skipped++;
      continue;
    }
    const label = `${slot.dateKey} P${slot.periodNumber} cover=${cover.toString().slice(-6)}`;
    if (!apply) {
      console.log(`  would create  ${label}`);
      continue;
    }
    // Absent teacher = the slot's own absent staff, else the routine slot's owner.
    let absentTeacherId = slot.absentTeacherUserId ?? null;
    if (!absentTeacherId) {
      const rl = await RoutineSlot.findById(slot.routineSlotId).select("teacherId").lean();
      absentTeacherId = (rl?.teacherId as Types.ObjectId | undefined) ?? null;
    }
    await RoutineSubstitution.create({
      slotId: slot.routineSlotId,
      date,
      coverTeacherId: cover,
      absentTeacherId,
      proxyGrantId: slot.proxyGrantId,
      createdBy: cover,
    });
    created++;
    console.log(`  created  ${label}`);
  }

  console.log(`\nDone. created=${created} already-ok=${skipped} total=${slots.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

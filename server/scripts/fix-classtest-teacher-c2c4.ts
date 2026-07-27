/**
 * One-off (D-#367 follow-up): reassign two class tests that the Principal created
 * to their real English subject teacher. The routine names no English teacher for
 * these section×subject cells on the exam date, so createRequest fell back to the
 * creator (the Principal) — the D-#366 guard now blocks that, but these two rows
 * predate it and must be corrected by hand (owner named the teachers).
 *
 *   CT-C2-ENG-0002  ->  Tazkir   (C2 English)
 *   CT-C4-ENG-0001  ->  Mahzabin (C4 English)
 *
 * teacherId is reassigned; requestedBy (who entered it) is left untouched, so the
 * exam appears in the teacher's "My class tests" (and results-entry) while the
 * Principal still sees it as the requester.
 *
 * DRY RUN by default — prints intended changes, writes nothing. Pass --apply.
 *   node --env-file=.env --import tsx server/scripts/fix-classtest-teacher-c2c4.ts
 *   node --env-file=.env --import tsx server/scripts/fix-classtest-teacher-c2c4.ts --apply
 *
 * NOTE: the repo .env points at the LOCAL test copy (same ObjectIds as prod). Run
 * against production on the VM (/opt/scdhub/prod) so MONGODB_URI resolves to prod.
 */
import { connectDb } from "../src/db";
import { ClassTest } from "../src/modules/trackers/models/ClassTest";
import { User } from "../src/modules/foundation/models/User";

const MAP: ReadonlyArray<{ ctId: string; teacherName: string }> = [
  { ctId: "CT-C2-ENG-0002", teacherName: "Tazkir" },
  { ctId: "CT-C4-ENG-0001", teacherName: "Mahzabin" },
];

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await connectDb();

  let ok = 0;
  let blocked = 0;

  for (const { ctId, teacherName } of MAP) {
    const test = await ClassTest.findOne({ ctId }).select("ctId teacherId requestedBy subject").lean();
    if (!test) {
      console.log(`SKIP  ${ctId} — no such class test`);
      blocked += 1;
      continue;
    }

    // Case-insensitive name match on active teachers; require EXACTLY one hit.
    const rx = new RegExp(teacherName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const candidates = await User.find({ name: rx, active: true }).select("name role").lean();
    if (candidates.length === 0) {
      console.log(`SKIP  ${ctId} — no active user matches "${teacherName}"`);
      blocked += 1;
      continue;
    }
    if (candidates.length > 1) {
      console.log(
        `SKIP  ${ctId} — "${teacherName}" is ambiguous (${candidates.length} matches): ` +
          candidates.map((c) => `${c.name} [${c.role}] ${c._id}`).join(", "),
      );
      blocked += 1;
      continue;
    }

    const teacher = candidates[0];
    const currentId = test.teacherId ? test.teacherId.toString() : "(none)";
    const currentUser = test.teacherId
      ? await User.findById(test.teacherId).select("name").lean()
      : null;
    const currentName = currentUser?.name ?? currentId;

    if (currentId === teacher._id.toString()) {
      console.log(`keep  ${ctId} — already owned by ${teacher.name}`);
      ok += 1;
      continue;
    }

    console.log(`MOVE  ${ctId} (${test.subject})  ${currentName}  ->  ${teacher.name} [${teacher.role}] ${teacher._id}`);
    if (apply) {
      await ClassTest.updateOne({ _id: test._id }, { $set: { teacherId: teacher._id } });
    }
    ok += 1;
  }

  console.log(`\n${apply ? "APPLIED" : "DRY RUN"} — ${ok} resolved, ${blocked} blocked.`);
  if (!apply && blocked === 0) console.log("Re-run with --apply to persist.");
  if (blocked > 0) console.log("Resolve the blocked rows (name mismatch/ambiguous) before applying.");
  process.exit(blocked > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

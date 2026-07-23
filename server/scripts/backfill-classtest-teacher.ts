/**
 * Backfill ClassTest.teacherId (D-#352) for exams created before the field existed.
 *
 * Those rows only recorded `requestedBy` (who entered the exam), so a Principal/
 * Office registration on a teacher's behalf reads as the admin's exam. This sets
 * the ACCOUNTABLE subject teacher from the routine (the same rule createRequest
 * now applies), leaving `requestedBy` untouched.
 *
 * DRY RUN by default — prints every intended change and writes nothing.
 * Pass --apply to persist. Idempotent: only rows with no teacherId are touched.
 *
 *   npx tsx server/scripts/backfill-classtest-teacher.ts            # preview
 *   npx tsx server/scripts/backfill-classtest-teacher.ts --apply    # persist
 *
 * NOTE: the repo .env points at the LOCAL test copy. Run against production on
 * the VM (/opt/scdhub/prod) so MONGODB_URI/databaseName resolve to prod.
 */
import { connectDb } from "../src/db";
import { ClassTest } from "../src/modules/trackers/models/ClassTest";
import { User } from "../src/modules/foundation/models/User";
import { resolveSubjectTeachers } from "../src/modules/trackers/subjectTeacher";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await connectDb();

  const rows = await ClassTest.find({ teacherId: { $exists: false } })
    .select("ctId sectionId subject examDate requestedBy")
    .lean();
  console.log(`ClassTest rows without teacherId: ${rows.length}`);
  if (rows.length === 0) {
    console.log("Nothing to backfill.");
    process.exit(0);
  }

  const resolved = await resolveSubjectTeachers(
    rows.map((r) => ({
      key: r._id.toString(),
      sectionId: r.sectionId.toString(),
      subject: r.subject,
      on: new Date(r.examDate),
    })),
  );

  const userIds = [
    ...new Set([
      ...rows.map((r) => r.requestedBy.toString()),
      ...resolved.values(),
    ]),
  ];
  const users = await User.find({ _id: { $in: userIds } }).select("name").lean();
  const nameOf = (id: string): string =>
    users.find((u) => u._id.toString() === id)?.name ?? id;

  let changed = 0;
  let unchanged = 0;
  for (const r of rows) {
    const requester = r.requestedBy.toString();
    // No routine teacher → the requester stays accountable (same fallback as
    // createRequest), so stamp it explicitly and stop re-deriving every read.
    const teacher = resolved.get(r._id.toString()) ?? requester;
    const moved = teacher !== requester;
    if (moved) changed += 1;
    else unchanged += 1;
    console.log(
      `${moved ? "MOVE  " : "keep  "} ${r.ctId} ${r.subject} ` +
        `${new Date(r.examDate).toISOString().slice(0, 10)}  ` +
        `${nameOf(requester)}${moved ? ` -> ${nameOf(teacher)}` : ""}`,
    );
    if (apply) {
      await ClassTest.updateOne({ _id: r._id }, { $set: { teacherId: teacher } });
    }
  }

  console.log(
    `\n${apply ? "APPLIED" : "DRY RUN"} — ${rows.length} row(s): ` +
      `${changed} re-attributed to the routine's subject teacher, ${unchanged} stay with the requester.`,
  );
  if (!apply) console.log("Re-run with --apply to persist.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

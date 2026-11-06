/**
 * One-off cleanup (owner report 2026-11-06): class-test results marked ABSENT that
 * still carry teacher comments (weakness / teacherAction / guardianAction). The entry
 * form used to show the comment boxes for an absent child, and the server saved them;
 * enterResult now refuses comments on ABSENT and clears them on save, so this only
 * fixes rows written before that change.
 *
 * Every row it touches is printed in full (ctId, student, the three texts) BEFORE the
 * write, so the output is the record of what was removed — keep it.
 *
 * Runs on the VM, piped on stdin so nothing lands in the deploy dir (reads .env itself —
 * sourcing it truncates the URI at the unquoted '&'):
 *
 *   ssh <vm> 'cd /opt/scdhub/prod && node' < server/scripts/clear-absent-ct-comments.cjs
 *   ssh <vm> 'cd /opt/scdhub/prod && APPLY=1 node' < server/scripts/clear-absent-ct-comments.cjs
 *
 * Without APPLY=1 it only lists. Idempotent: a second run finds nothing.
 */
const fs = require("fs");
const mongoose = require("mongoose");

const APPLY = process.env.APPLY === "1";
const FIELDS = ["weakness", "teacherAction", "guardianAction"];

(async () => {
  const uri = fs.readFileSync(".env", "utf8").split("\n")
    .find((l) => l.startsWith("MONGODB_URI=")).slice("MONGODB_URI=".length).trim().replace(/^["']|["']$/g, "");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const db = mongoose.connection.db;
  const results = db.collection("classtestresults");
  console.log(`db=${db.databaseName} mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

  const filter = { status: "ABSENT", $or: FIELDS.map((f) => ({ [f]: { $exists: true } })) };
  const rows = await results.find(filter).toArray();

  const tests = new Map(
    (await db.collection("classtests")
      .find({ _id: { $in: [...new Set(rows.map((r) => r.testId.toString()))].map((id) => new mongoose.Types.ObjectId(id)) } })
      .project({ ctId: 1 })
      .toArray()).map((t) => [t._id.toString(), t.ctId]),
  );
  const students = new Map(
    (await db.collection("students")
      .find({ _id: { $in: rows.map((r) => r.studentId) } })
      .project({ name: 1, schoolId: 1 })
      .toArray()).map((s) => [s._id.toString(), `${s.name} (${s.schoolId})`]),
  );

  for (const r of rows) {
    console.log(JSON.stringify({
      _id: r._id,
      ctId: tests.get(r.testId.toString()) ?? r.testId,
      student: students.get(r.studentId.toString()) ?? r.studentId,
      published: !!r.publishedAt,
      weakness: r.weakness ?? null,
      teacherAction: r.teacherAction ?? null,
      guardianAction: r.guardianAction ?? null,
    }));
  }
  console.log(`absent rows with comments: ${rows.length}`);

  if (APPLY && rows.length) {
    const res = await results.updateMany(
      { _id: { $in: rows.map((r) => r._id) }, status: "ABSENT" },
      { $unset: Object.fromEntries(FIELDS.map((f) => [f, ""])) },
    );
    console.log(`cleared: ${res.modifiedCount}`);
    const left = await results.countDocuments(filter);
    console.log(`left after apply: ${left}`);
  }
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

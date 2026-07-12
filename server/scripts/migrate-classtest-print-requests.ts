/**
 * Migration (PQ-5, D-#281): back-fill a `PrintRequest` for every existing `ClassTest`.
 *
 * A ClassTest has always BEEN a print request (`REQUESTED → PRINTED`). PQ-5 moves the
 * printing concern onto the unified queue, so every historical test needs its queue row
 * — otherwise class tests created before the change would simply vanish from the
 * Office's view.
 *
 * MUST run before a server carrying PQ-5 serves the print queue against this DB.
 * Idempotent: a ClassTest that already has `printRequestId` (or already has a
 * PrintRequest pointing back at it) is skipped, so re-running is safe.
 *
 * Status is carried across 1:1 — REQUESTED / PRINTED / CANCELLED. Nothing becomes
 * DELIVERED: that state did not exist before, and claiming a historical job was handed
 * over would be a lie. Printed-but-not-delivered rows land in the Office's "Printing
 * done" bucket, which is exactly where a printed-and-uncollected job belongs.
 *
 *   npx tsx server/scripts/migrate-classtest-print-requests.ts [--commit]
 *   SYNC_TO_URI=<uri> npx tsx server/scripts/migrate-classtest-print-requests.ts --commit
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
import { mongoose } from "../src/db";

const COMMIT = process.argv.includes("--commit");
const URI = process.env.SYNC_TO_URI ?? process.env.MONGODB_URI!;

/** ClassTest status → PrintRequest status. DELIVERED is never back-filled. */
const STATUS_MAP: Record<string, string> = {
  REQUESTED: "REQUESTED",
  PRINTED: "PRINTED",
  CANCELLED: "CANCELLED",
};

interface ClassTestRow {
  _id: mongoose.Types.ObjectId;
  ctId: string;
  subject: string;
  source: string;
  status: string;
  setId?: mongoose.Types.ObjectId;
  questionFileId?: mongoose.Types.ObjectId;
  classId?: mongoose.Types.ObjectId;
  sectionId?: mongoose.Types.ObjectId;
  notes?: string;
  requestedBy: mongoose.Types.ObjectId;
  requestedAt: Date;
  printedBy?: mongoose.Types.ObjectId;
  printedAt?: Date;
  printRequestId?: mongoose.Types.ObjectId;
}

async function main(): Promise<void> {
  const conn = await mongoose.createConnection(URI).asPromise();
  try {
    console.log(`DB: ${conn.name}   Mode: ${COMMIT ? "COMMIT" : "DRY-RUN"}\n`);

    const tests = (await conn.collection("classtests").find({}).toArray()) as unknown as ClassTestRow[];
    console.log(`ClassTests: ${tests.length}`);

    // Already-migrated tests, found by the back-reference (survives a half-run where the
    // PrintRequest was written but `printRequestId` was not).
    const existing = await conn
      .collection("printrequests")
      .find({ classTestId: { $exists: true } })
      .project({ classTestId: 1 })
      .toArray();
    const linked = new Set(existing.map((p) => String((p as { classTestId: unknown }).classTestId)));
    console.log(`PrintRequests already linked to a ClassTest: ${linked.size}\n`);

    let created = 0;
    let relinked = 0;
    let skipped = 0;
    const problems: string[] = [];

    for (const t of tests) {
      if (t.printRequestId && linked.has(String(t._id))) {
        skipped++;
        continue;
      }

      // A PrintRequest exists but the back-link is missing → repair the link only.
      if (!t.printRequestId && linked.has(String(t._id))) {
        const pr = await conn.collection("printrequests").findOne({ classTestId: t._id });
        if (pr) {
          relinked++;
          if (COMMIT) {
            await conn
              .collection("classtests")
              .updateOne({ _id: t._id }, { $set: { printRequestId: pr._id } });
          }
          continue;
        }
      }

      const status = STATUS_MAP[t.status];
      if (!status) {
        problems.push(`  WARN: ${t.ctId} has unknown status '${t.status}' — skipped`);
        continue;
      }

      const isPool = t.source === "POOL_SET";
      if (isPool && !t.setId) {
        problems.push(`  WARN: ${t.ctId} is POOL_SET but has no setId — skipped`);
        continue;
      }
      if (!isPool && !t.questionFileId) {
        problems.push(`  WARN: ${t.ctId} is UPLOADED_PAPER but has no questionFileId — skipped`);
        continue;
      }

      const doc = {
        title: `${t.ctId} · ${t.subject}`,
        purpose: "CLASS_TEST",
        sourceType: isPool ? "SET" : "UPLOAD",
        ...(isPool ? { setId: t.setId } : { fileIds: [t.questionFileId] }),
        classTestId: t._id,
        copies: 1,
        ...(t.classId ? { classId: t.classId } : {}),
        ...(t.sectionId ? { sectionId: t.sectionId } : {}),
        subject: t.subject,
        ...(t.notes ? { notes: t.notes } : {}),
        status,
        requestedBy: t.requestedBy,
        requestedAt: t.requestedAt,
        ...(t.printedBy ? { printedBy: t.printedBy } : {}),
        ...(t.printedAt ? { printedAt: t.printedAt } : {}),
        createdAt: t.requestedAt,
        updatedAt: new Date(),
      };

      created++;
      if (COMMIT) {
        const res = await conn.collection("printrequests").insertOne(doc);
        await conn
          .collection("classtests")
          .updateOne({ _id: t._id }, { $set: { printRequestId: res.insertedId } });
      }
    }

    for (const p of problems) console.log(p);
    console.log(
      `\nCreate: ${created}   Repair-link: ${relinked}   Already migrated: ${skipped}   Problems: ${problems.length}`,
    );
    if (!COMMIT) console.log("\nDRY-RUN — nothing written. Re-run with --commit.");
  } finally {
    await conn.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

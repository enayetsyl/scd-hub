/**
 * One-time catch-up for the D-#682 hand-back notice. Run ONCE, AFTER D-#682 is
 * deployed. Owner-approved 2026-09-16 for the FULL open backlog.
 *
 * WHY IT IS REQUIRED. A resubmission is a NEW record on an OLD HW_ID, so until
 * D-#682 nothing announced one: no declaration notice covers it, and the guardian
 * list filed it under the original declaration's date, often weeks back and
 * outside the window a parent looks at. The only message these families ever got
 * was the CHASE for not returning work nobody had told them about. At the time of
 * the fix production held 123 open hand-backs, 111 of them actively being chased,
 * across 44 children, the oldest handed back on 2 July.
 *
 * The code fix is retroactive for VISIBILITY — the records surface on the next
 * read — but a notification is an event, and no past event will ever fire. Hence
 * this script.
 *
 * WHAT IT DOES. For every homework record that is a resubmission (`resubOf` set)
 * and still open (GIVEN / DUE / CHASE), emit `HW_RESUBMIT_ISSUED` to the child's
 * login-enabled guardians through the ORDINARY emitter — same wording, same refs,
 * same deep link, same dedupe key as a live spawn. Nothing bespoke is written, so
 * a family cannot receive a shape the app does not already render.
 *
 * Idempotent through the emitter's `dedupeKey` (record + guardian): a second run
 * sends nothing, and a record that has since been notified by the live path is
 * skipped by the same key. Safe to re-run after a partial failure.
 *
 * DELIBERATELY NOT INCLUDED:
 *   - `ABSENT_REDELIVER` records (899 of them). Those were never handed out at
 *     all, so there is nothing to tell a parent to return — that is a backlog for
 *     the school, not a message for a family.
 *   - Closed records. A notice about work already submitted is pure noise.
 *
 * DRY-RUN by default; pass --commit to send. Uses MONGODB_URI from env (never
 * printed) — check `databaseName` in the output before committing, the repo
 * `.env` points at a TEST copy whose ObjectIds match prod.
 *
 *   npx tsx server/scripts/catchup-resubmit-notices.ts            # dry-run
 *   npx tsx server/scripts/catchup-resubmit-notices.ts --commit   # send
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import mongoose from "mongoose";
import { HW_SUBJECT_LABELS_BN, type HwSubject } from "@scd/shared";
import { connectDb, disconnectDb } from "../src/db";
import { HomeworkStudentRecord } from "../src/modules/trackers/models/HomeworkStudentRecord";
import { HomeworkItem } from "../src/modules/trackers/models/HomeworkItem";
import { emitHwResubmitIssued } from "../src/modules/notifications/services/emitters";

const COMMIT = process.argv.includes("--commit");
const OPEN_STATES = ["GIVEN", "DUE", "CHASE"];

/** The day the script actually reached the child — its own last GIVEN stamp. */
function handedBackAt(stateDates: Array<{ state: string; at: Date }>): Date | null {
  for (let i = stateDates.length - 1; i >= 0; i--) {
    if (stateDates[i].state === "GIVEN") return new Date(stateDates[i].at);
  }
  return null;
}

async function main(): Promise<void> {
  await connectDb();
  const db = mongoose.connection;
  console.log(`database: ${db.name}`);
  console.log(COMMIT ? "MODE: COMMIT — notices will be sent" : "MODE: dry-run");

  const records = await HomeworkStudentRecord.find({
    resubOf: { $ne: null },
    state: { $in: OPEN_STATES },
  }).lean();

  console.log(`open resubmissions: ${records.length}`);
  if (records.length === 0) {
    await disconnectDb();
    return;
  }

  const itemIds = [...new Set(records.map((r) => r.hwItemId.toString()))];
  const items = await HomeworkItem.find({ _id: { $in: itemIds } })
    .select("subject")
    .lean();
  const subjectById = new Map(items.map((i) => [i._id.toString(), i.subject]));

  // Oldest first, so a family with several rows reads them in the order the
  // scripts actually came home.
  const ordered = [...records].sort((a, b) => {
    const at = handedBackAt(a.stateDates)?.getTime() ?? 0;
    const bt = handedBackAt(b.stateDates)?.getTime() ?? 0;
    return at - bt;
  });

  let sent = 0;
  let failed = 0;
  for (const r of ordered) {
    const subject = subjectById.get(r.hwItemId.toString());
    const label = subject ? HW_SUBJECT_LABELS_BN[subject as HwSubject] ?? subject : "";
    const when = handedBackAt(r.stateDates);
    const line =
      `${r.hwId} · ${r.state} · handed back ` +
      `${when ? when.toISOString().slice(0, 10) : "?"} · student ${r.studentId}`;

    if (!COMMIT) {
      console.log(`  would notify: ${line}`);
      sent++;
      continue;
    }

    try {
      // The ordinary emitter: it resolves the links, filters to login-enabled
      // guardians, renders the same template and carries the same dedupe key.
      await emitHwResubmitIssued({
        recordId: r._id,
        hwItemId: r.hwItemId,
        hwId: r.hwId,
        studentId: r.studentId,
        sectionId: r.sectionId,
        subjectLabelBn: label,
        dueDate: r.dueDate ?? null,
      });
      sent++;
      console.log(`  notified: ${line}`);
    } catch (err) {
      failed++;
      console.error(`  FAILED: ${line} — ${(err as Error).message}`);
    }
  }

  console.log(
    COMMIT
      ? `done — ${sent} record(s) emitted, ${failed} failed`
      : `dry-run — ${sent} record(s) would be notified (re-run with --commit)`,
  );
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

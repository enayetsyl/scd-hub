#!/usr/bin/env node
/**
 * Load the PRINTED parents'-meeting numbers as the guardian-release snapshots (D-#1635).
 *
 *   npx tsx scripts/load-meeting-release-snapshots.ts <meetingId> <briefs.json> [--force]
 *   APPLY=1 npx tsx scripts/load-meeting-release-snapshots.ts <meetingId> <briefs.json>
 *
 * `briefs.json` is the list of brief rows that were printed for the meeting (the `MeetingBrief`
 * shape: studentId, numbers, classBest). Only the numbers are read — never any comment text.
 * Dry run by default: prints what would be written and writes nothing. With APPLY=1 each row
 * is upserted as a "printed" snapshot, which publishing keeps in preference to a recompute.
 * Refuses a meeting already published to guardians unless --force.
 *
 * Run where the server's .env points at the right database (the VM for prod).
 */
import "dotenv/config";
import { promises as fs } from "fs";
import { connectDb, disconnectDb } from "../src/db";
import { ParentMeeting } from "../src/modules/comments/models/ParentMeeting";
import { ParentMeetingSlot } from "../src/modules/comments/models/ParentMeetingSlot";
import { ParentMeetingRelease } from "../src/modules/comments/models/ParentMeetingRelease";
import { saveMeetingReleaseSnapshots, snapshotRowsFromBriefs } from "../src/modules/comments/services/MeetingReleaseService";

async function main(): Promise<void> {
  const [meetingId, file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const force = process.argv.includes("--force");
  const apply = process.env.APPLY === "1";
  if (!meetingId || !file) {
    console.error("usage: npx tsx scripts/load-meeting-release-snapshots.ts <meetingId> <briefs.json> [--force]   (APPLY=1 to write)");
    process.exit(2);
  }
  const rows = snapshotRowsFromBriefs(JSON.parse(await fs.readFile(file, "utf8")));
  await connectDb();
  try {
    const meeting = await ParentMeeting.findById(meetingId).lean();
    if (!meeting) throw new Error(`meeting ${meetingId} not found`);
    const existing = await ParentMeetingRelease.countDocuments({ meetingId: meeting._id });
    console.log(`${apply ? "APPLY" : "DRY RUN"}: "${meeting.instanceLabel}" — ${rows.length} printed rows (${existing} snapshot rows exist now)`);
    // Safety report: rows for children NOT on this meeting's slots, and rows that replace a snapshot.
    const slots = (await ParentMeetingSlot.find({ meetingId: meeting._id }).select("studentIds").lean()) as unknown as Array<{ studentIds: Array<{ toString(): string }> }>;
    const onSlots = new Set(slots.flatMap((s) => s.studentIds.map((i) => i.toString())));
    const offSlot = rows.filter((r) => !onSlots.has(r.studentId));
    const have = new Set(
      (await ParentMeetingRelease.find({ meetingId: meeting._id }).select("studentId").lean()).map((r) => r.studentId.toString()),
    );
    const overwrite = rows.filter((r) => have.has(r.studentId));
    console.log(`rows not on this meeting's slots: ${offSlot.length}${offSlot.length ? ` (${offSlot.slice(0, 5).map((r) => r.studentId).join(", ")}${offSlot.length > 5 ? ", ..." : ""})` : ""}`);
    console.log(`rows that would overwrite an existing snapshot: ${overwrite.length}`);
    if (offSlot.length > 0 && !force) {
      console.error("refusing: some rows are for children not on this meeting — fix the file, or pass --force to load them anyway");
      process.exitCode = 1;
      return;
    }
    const sample = rows[0];
    if (sample) console.log("first row:", JSON.stringify({ studentId: sample.studentId, window: sample.window, numbers: sample.numbers, classBest: sample.classBest }));
    if (!apply) {
      console.log("nothing written — set APPLY=1 to load these as the printed snapshots");
      return;
    }
    const n = await saveMeetingReleaseSnapshots(meetingId, rows, "printed", { force });
    console.log(`wrote ${n} printed snapshot rows`);
  } finally {
    await disconnectDb();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

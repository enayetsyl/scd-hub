/**
 * Migration: denormalize `track` onto SubjectGroupMembership rows and build the
 * UNIQUE (studentId, track) index that enforces ≤1 group per track per student.
 *
 * MUST run before a server carrying the new index starts against this DB (an
 * un-backfilled row set would fail the unique-index build). Idempotent.
 * DRY-RUN by default; pass --commit to write.
 *
 *   npx tsx server/scripts/migrate-subgroup-membership-track.ts [--commit]
 *   SYNC_TO_URI=<uri> npx tsx server/scripts/migrate-subgroup-membership-track.ts --commit
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
import { mongoose } from "../src/db";

const COMMIT = process.argv.includes("--commit");
const URI = process.env.SYNC_TO_URI ?? process.env.MONGODB_URI!;

async function main(): Promise<void> {
  const conn = await mongoose.createConnection(URI).asPromise();
  try {
    console.log(`DB: ${conn.name}   Mode: ${COMMIT ? "COMMIT" : "DRY-RUN"}\n`);
    const groups = await conn.collection("subjectgroups").find({}).toArray();
    const trackOf = new Map(groups.map((g: any) => [g._id.toString(), g.track]));

    const rows = await conn.collection("subjectgroupmemberships").find({}).toArray();
    console.log(`Memberships: ${rows.length}`);

    // 1) Backfill track from each row's group.
    let toSet = 0;
    for (const r of rows as any[]) {
      const track = trackOf.get(r.groupId.toString());
      if (!track) { console.log(`  WARN: membership ${r._id} → unknown group ${r.groupId}`); continue; }
      if (r.track !== track) {
        toSet++;
        if (COMMIT) {
          await conn.collection("subjectgroupmemberships").updateOne({ _id: r._id }, { $set: { track } });
        }
      }
    }
    console.log(`${COMMIT ? "Set" : "Would set"} track on ${toSet} row(s).`);

    // 2) Pre-flight: any student already in 2+ groups of the same track? The unique
    //    index would refuse to build — report them so they're fixed first.
    const perStudentTrack = new Map<string, Record<string, number>>();
    for (const r of rows as any[]) {
      const track = trackOf.get(r.groupId.toString());
      if (!track) continue;
      const sid = r.studentId.toString();
      const rec = perStudentTrack.get(sid) ?? {};
      rec[track] = (rec[track] ?? 0) + 1;
      perStudentTrack.set(sid, rec);
    }
    const violations: string[] = [];
    for (const [sid, rec] of perStudentTrack) for (const t of Object.keys(rec)) if (rec[t] > 1) violations.push(`${sid} has ${rec[t]} ${t} groups`);
    if (violations.length) {
      console.log(`\nABORT: ${violations.length} existing violation(s) — fix before building the index:`);
      for (const v of violations) console.log(`   ${v}`);
      return;
    }
    console.log("Pre-flight: no (studentId, track) violations.");

    // 3) Build the unique index.
    if (COMMIT) {
      await conn.collection("subjectgroupmemberships").createIndex({ studentId: 1, track: 1 }, { unique: true });
      const idx = await conn.collection("subjectgroupmemberships").indexes();
      console.log(`\nIndexes now: ${idx.map((i) => i.name).join(", ")}`);
    } else {
      console.log("\nWould create UNIQUE index { studentId: 1, track: 1 }.");
    }
    console.log(COMMIT ? "\nDone." : "\nDRY-RUN complete — re-run with --commit to apply.");
  } finally {
    await conn.close();
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

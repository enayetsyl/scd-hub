/**
 * Retire LEGACY attendance-marker overrides (D-#278 follow-up).
 *
 * Before D-#278 the admin assigning a marker WAS the normal path. Under D-#278 the
 * marker is derived from the routine (the first-class teacher), and an admin assignment
 * is only an ESCAPE HATCH — but it still wins. So legacy rows silently defeat the new
 * rule: the first-period teacher never gets the section, and only the previously-assigned
 * teacher can mark it.
 *
 * This deactivates assignments created BEFORE a cutoff (default: D-#278's build date),
 * handing marking back to the routine. Assignments you make from now on are untouched.
 *
 * Rows are DEACTIVATED, never deleted (append-only history, ADR-008), so who-was-
 * responsible-when is preserved for the escalation log.
 *
 * DRY-RUN by default; pass --commit to write.
 *
 *   npx tsx server/scripts/revoke-legacy-attendance-markers.ts [--commit] [--before=YYYY-MM-DD]
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
import { mongoose } from "../src/db";

const COMMIT = process.argv.includes("--commit");
const beforeArg = process.argv.find((a) => a.startsWith("--before="))?.split("=")[1];
/** D-#278 landed 2026-07-09; anything created before it is a legacy row. */
const CUTOFF = new Date(`${beforeArg ?? "2026-07-09"}T00:00:00`);
const URI = process.env.MONGODB_URI!;

async function main(): Promise<void> {
  const conn = await mongoose.createConnection(URI).asPromise();
  try {
    console.log(`DB: ${conn.name}   Mode: ${COMMIT ? "COMMIT" : "DRY-RUN"}`);
    console.log(`Deactivating ACTIVE marker assignments created before ${CUTOFF.toISOString().slice(0, 10)}\n`);

    const rows = await conn
      .collection("sectionattendanceassignments")
      .find({ active: true, createdAt: { $lt: CUTOFF } })
      .toArray();

    if (rows.length === 0) {
      console.log("Nothing to do — no legacy active assignments.");
      return;
    }

    for (const r of rows) {
      const sec = r.sectionId ? await conn.collection("sections").findOne({ _id: r.sectionId }) : null;
      const cls = sec ? await conn.collection("classes").findOne({ _id: sec.classId }) : null;
      const t = await conn.collection("users").findOne({ _id: r.teacherId as never });
      const where = sec ? `${cls?.nameBn ?? "?"} / ${sec.nameBn ?? sec.code}` : `group ${String(r.subjectGroupId)}`;
      console.log(`  ${where}  ->  ${t?.name ?? "?"}   [${r.fromKey}..${r.toKey}]  created ${String(r.createdAt).slice(0, 10)}`);
    }

    console.log(`\nWould deactivate: ${rows.length}`);
    if (COMMIT) {
      const res = await conn
        .collection("sectionattendanceassignments")
        .updateMany(
          { active: true, createdAt: { $lt: CUTOFF } },
          { $set: { active: false, revokedAt: new Date() } },
        );
      console.log(`Deactivated: ${res.modifiedCount}   (history preserved — rows are not deleted)`);
      console.log("Marking now falls to the routine's first-class teacher.");
    } else {
      console.log("\nDRY-RUN — nothing written. Re-run with --commit.");
    }
  } finally {
    await conn.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

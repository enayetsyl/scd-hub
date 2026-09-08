/**
 * Backfill: re-spell the pre-primary class token in every minted tracker id.
 *
 *     HW-C0-BAN-0007   → HW-CK-BAN-0007        (KG,      classLevel 0)
 *     AS-C-1-MATH-0002 → AS-CN-MATH-0002       (Nursery, classLevel -1)
 *     TOP-ENG-C0-GEN   → TOP-ENG-CK-GEN
 *
 * Classes 1–5 are untouched — `C1`..`C5` were never ambiguous.
 *
 * WHY the ids are rewritten at all rather than only new ones being minted:
 * `C0` reads as "class zero" and `C-1` puts a dash inside a dash-delimited id.
 * A KG claim (`AS-C0-BAN-0007`) was read as Nursery by the Nursery class teacher
 * on prod, 2026-09-07. Owner's call: one consistent corpus, not a mixed one.
 *
 * WHAT IS DELIBERATELY NOT REWRITTEN — and must stay that way:
 *
 *   `audits.meta.{hwId,asId,ctId,workId}`  (339 values)
 *   `notifications.bodyBn`                 (1118 values)
 *
 * Both are APPEND-ONLY records of things that already happened (ADR-008; the
 * AGENTS.md append-only rule). The audit log says what an id WAS called when the
 * action was taken, and a delivered notification is a copy of text a guardian
 * has already read on their phone. Editing either would be fabricating history,
 * and neither is load-bearing: deep-links travel on `refs` ObjectIds, not on the
 * text, and every parser accepts both spellings forever (`parseClassToken`).
 *
 * SAFETY
 *   - Dry-run by default. Pass `--apply` to write.
 *   - Idempotent: matches only the legacy spelling, so a second run is a no-op.
 *   - Aborts before writing if any target id ALREADY exists in the new spelling
 *     (three of these fields are unique-indexed — a half-run must not collide).
 *
 * Run AFTER the code that mints/parses `CK`/`CN` is deployed, so nothing mints a
 * legacy id behind the migration.
 *
 *   npx tsx server/scripts/backfill-preprimary-class-token.ts            # dry run
 *   npx tsx server/scripts/backfill-preprimary-class-token.ts --apply
 */
import "dotenv/config";
import mongoose from "mongoose";

const APPLY = process.argv.includes("--apply");

/** `-C0-` / `-C-1-` anywhere in a minted id, with the prefix kept intact. */
const LEGACY_IN_ID = /\b(HW|AS|CT|TOP)((?:-[A-Z]+)*)-C(0|-1)-/g;

function respell(value: string): string {
  return value.replace(LEGACY_IN_ID, (_m, prefix, middle, level) =>
    `${prefix}${middle}-${level === "0" ? "CK" : "CN"}-`,
  );
}

/** collection → the string fields that hold a minted id. Discovered by scanning
 *  every string value of every document on prod, not read off the models — the
 *  models do not say that `homeworkitems.topTags[]` carries one. */
const TARGETS: Array<{ coll: string; field: string; array?: boolean; unique?: boolean }> = [
  { coll: "assignmentitems", field: "asId", unique: true },
  { coll: "assignmentstudentrecords", field: "asId" },
  { coll: "assignmentfollowups", field: "asId" },
  { coll: "classtests", field: "ctId", unique: true },
  { coll: "guardianworkclaims", field: "workId" },
  { coll: "homeworkitems", field: "hwId", unique: true },
  { coll: "homeworkitems", field: "topTags", array: true },
  { coll: "homeworkstudentrecords", field: "hwId" },
  { coll: "notifications", field: "refs.ctId" },
  { coll: "printrequests", field: "title" },
];

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  console.log(`db: ${db.databaseName}   mode: ${APPLY ? "APPLY" : "DRY RUN"}\n`);

  // --- pre-flight: no target may already exist in the new spelling ----------
  let collisions = 0;
  for (const t of TARGETS.filter((x) => x.unique)) {
    const n = await db.collection(t.coll).countDocuments({ [t.field]: /-C(K|N)-/ });
    if (n > 0) {
      console.error(`ABORT: ${t.coll}.${t.field} already has ${n} value(s) in the new spelling.`);
      collisions += n;
    }
  }
  if (collisions > 0) {
    console.error("\nA previous run may have partially applied. Inspect before re-running.");
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  let total = 0;
  for (const t of TARGETS) {
    const cursor = db.collection(t.coll).find({ [t.field]: /-C(0|-1)-/ });
    let touched = 0;
    for await (const doc of cursor) {
      const current = t.field.split(".").reduce<any>((o, k) => o?.[k], doc);
      const next = t.array
        ? (current as string[]).map(respell)
        : respell(current as string);
      const changed = t.array
        ? (next as string[]).some((v, i) => v !== (current as string[])[i])
        : next !== current;
      if (!changed) continue;
      touched++;
      if (touched <= 3) console.log(`  ${t.coll}.${t.field}: ${JSON.stringify(current)} → ${JSON.stringify(next)}`);
      if (APPLY) {
        await db.collection(t.coll).updateOne({ _id: doc._id }, { $set: { [t.field]: next } });
      }
    }
    total += touched;
    console.log(`${APPLY ? "updated" : "would update"} ${t.coll}.${t.field}: ${touched}`);
  }

  console.log(`\n${APPLY ? "updated" : "would update"} ${total} value(s).`);
  if (!APPLY) console.log("Dry run — nothing was written. Re-run with --apply.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

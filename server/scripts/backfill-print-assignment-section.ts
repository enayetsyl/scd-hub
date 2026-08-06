/**
 * Backfill PrintRequest.sectionId (D-#459) for ASSIGNMENT-purpose jobs filed
 * before the section picker existed on NewPrintRequestScreen.
 *
 * The assignment↔print gap report (asNotPrintedRows) matches on
 * (sectionId, subject, neededByKey) — a request with no sectionId can never
 * match, so it reports as a permanent false "not printed" even when the paper
 * was genuinely sent. For a class with exactly ONE active section, the
 * section is unambiguous and safe to infer; a multi-section class is left
 * alone and logged as AMBIGUOUS (needs a human pick, not a guess).
 *
 * DRY RUN by default — prints every intended change and writes nothing.
 * Pass --apply to persist. Idempotent: only rows with no sectionId are touched.
 *
 *   npx tsx server/scripts/backfill-print-assignment-section.ts            # preview
 *   npx tsx server/scripts/backfill-print-assignment-section.ts --apply    # persist
 *
 * NOTE: the repo .env points at the LOCAL test copy. Run against production on
 * the VM (/opt/scdhub/prod) so MONGODB_URI/databaseName resolve to prod.
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { connectDb } from "../src/db";
import { PrintRequest } from "../src/modules/printing/models/PrintRequest";
import { Section } from "../src/modules/foundation/models/Section";
import { Class } from "../src/modules/foundation/models/Class";
import { User } from "../src/modules/foundation/models/User";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await connectDb();

  const rows = await PrintRequest.find({
    purpose: "ASSIGNMENT",
    classId: { $exists: true, $ne: null },
    $or: [{ sectionId: { $exists: false } }, { sectionId: null }],
  })
    .select("title classId subject neededByKey requestedBy")
    .lean();
  console.log(`ASSIGNMENT PrintRequest rows without sectionId: ${rows.length}`);
  if (rows.length === 0) {
    console.log("Nothing to backfill.");
    process.exit(0);
  }

  const classIds = [...new Set(rows.map((r) => r.classId!.toString()))];
  const classes = await Class.find({ _id: { $in: classIds } }).select("nameBn level").lean();
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));

  const sections = await Section.find({ classId: { $in: classIds }, active: true })
    .select("classId nameBn")
    .lean();
  const sectionsByClass = new Map<string, typeof sections>();
  for (const s of sections) {
    const key = s.classId.toString();
    const list = sectionsByClass.get(key) ?? [];
    list.push(s);
    sectionsByClass.set(key, list);
  }

  const userIds = [...new Set(rows.map((r) => r.requestedBy.toString()))];
  const users = await User.find({ _id: { $in: userIds } }).select("name").lean();
  const nameOf = (id: string): string => users.find((u) => u._id.toString() === id)?.name ?? id;

  let backfilled = 0;
  let ambiguous = 0;
  let noSection = 0;
  for (const r of rows) {
    const classId = r.classId!.toString();
    const cls = classById.get(classId);
    const clsLabel = cls ? `${cls.nameBn} (L${cls.level})` : classId;
    const active = sectionsByClass.get(classId) ?? [];

    if (active.length === 1) {
      const section = active[0];
      backfilled += 1;
      console.log(
        `BACKFILL  "${r.title}"  ${clsLabel} · ${r.subject} · ${r.neededByKey}  ` +
          `by ${nameOf(r.requestedBy.toString())}  -> section "${section.nameBn}"`,
      );
      if (apply) {
        await PrintRequest.updateOne({ _id: r._id }, { $set: { sectionId: section._id } });
      }
    } else if (active.length === 0) {
      noSection += 1;
      console.log(
        `SKIP (no active section)  "${r.title}"  ${clsLabel} · ${r.subject} · ${r.neededByKey}`,
      );
    } else {
      ambiguous += 1;
      console.log(
        `AMBIGUOUS (${active.length} sections: ${active.map((s) => s.nameBn).join(", ")})  ` +
          `"${r.title}"  ${clsLabel} · ${r.subject} · ${r.neededByKey}  by ${nameOf(r.requestedBy.toString())}`,
      );
    }
  }

  console.log(
    `\n${apply ? "APPLIED" : "DRY RUN"} — ${rows.length} row(s): ` +
      `${backfilled} backfilled (single active section), ${ambiguous} ambiguous (multiple sections, needs a human pick), ` +
      `${noSection} skipped (no active section on the class).`,
  );
  if (!apply) console.log("Re-run with --apply to persist.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

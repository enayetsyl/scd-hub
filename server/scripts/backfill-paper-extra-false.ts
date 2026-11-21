/**
 * AL-4 (docs/prd-academic-loop-2027.md §3.1, D-#1669): backfill `MasteryPaper.extra = false`, check that no two class
 * homework papers share a tracker item, then build the partial unique index on `links.hwItemId`. The work lives in
 * `server/src/modules/mastery/services/PaperLinkIndex.ts` (so the tests run it too).
 *
 * IDEMPOTENT. DRY RUN by default — counts what it would change and writes nothing. Pass --apply to persist.
 *
 *   npx tsx server/scripts/backfill-paper-extra-false.ts            # preview
 *   npx tsx server/scripts/backfill-paper-extra-false.ts --apply    # persist (index only when the duplicate check is clean)
 *
 * NOTE: the repo .env points at the LOCAL test copy. Run against production only on the VM (/opt/scdhub/prod),
 * after a dry run, by the lead.
 */
import { connectDb } from "../src/db";
import { backfillPaperExtraFalse } from "../src/modules/mastery/services/PaperLinkIndex";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await connectDb();
  const r = await backfillPaperExtraFalse({ apply });
  console.log(apply ? "APPLIED" : "DRY RUN");
  console.log(`papers without an extra flag: ${r.missingExtra} (${apply ? "set to false" : "would be set to false"})`);
  console.log(`homework items with more than one class paper: ${r.duplicates.length}`);
  for (const d of r.duplicates) console.log(`  ${d.hwItemId}: ${d.papers.join(", ")}`);
  console.log(`unique index: ${r.indexBuilt ? "BUILT" : r.indexPresent ? "already present" : r.duplicates.length > 0 ? "NOT built — fix the duplicates first" : apply ? "not built" : "would be built"}`);
  if (!apply) console.log("Re-run with --apply to persist.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

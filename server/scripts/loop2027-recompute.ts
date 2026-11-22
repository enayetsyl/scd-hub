/**
 * AL-6 (docs/prd-academic-loop-2027.md §3.6): the one-time recompute when `academicLoop2027On` is switched on.
 * The work lives in `server/src/modules/mastery/services/Loop2027Recompute.ts` (so the tests run it too).
 *
 * States are computed on read, so this does two things: REPORTS what the in-school rule (§3.8) changes against the
 * 2026 rule per শাখা × subject (and lists open re-teach proposals that no longer meet the in-school trigger — it never
 * closes them), and with --apply runs the section-trigger evaluation for every mastery-ON শাখা × subject.
 * DRY RUN by default. --apply refuses while the switch is off.
 *
 *   npx tsx server/scripts/loop2027-recompute.ts            # report
 *   npx tsx server/scripts/loop2027-recompute.ts --apply    # report + open the proposals the in-school rule now earns
 *
 * NOTE: the repo .env points at the LOCAL test copy. Run against production only on the VM (/opt/scdhub/prod),
 * after a dry run, by the lead.
 */
import { connectDb } from "../src/db";
import { recomputeForSwitch } from "../src/modules/mastery/services/Loop2027Recompute";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await connectDb();
  const r = await recomputeForSwitch({ apply });
  console.log(apply ? "APPLIED" : "DRY RUN", `— release switch ${r.switchOn ? "ON" : "OFF"}`);
  let moved = 0;
  for (const row of r.rows) {
    moved += row.statesChanged;
    if (row.statesChanged === 0 && row.staleProposals.length === 0 && row.newTriggers.length === 0) continue;
    console.log(
      `${row.classToken} ${row.subject} ${row.sectionId}: ${row.statesChanged} states move (${row.masteredLost} MASTERED lost)` +
        (row.staleProposals.length ? `; stale proposals: ${row.staleProposals.join(", ")}` : "") +
        (row.newTriggers.length ? `; new triggers: ${row.newTriggers.join(", ")}` : ""),
    );
  }
  console.log(`${r.rows.length} section x subject read; ${moved} student x objective states move under the 2027 rule; ${r.opened} proposals opened.`);
  if (!apply) console.log("Re-run with --apply (switch ON) to evaluate the section triggers.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

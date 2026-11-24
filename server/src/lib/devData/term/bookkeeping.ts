/**
 * Run bookkeeping that must never block the dev site: the guardian weekly-message run log (`GuardianSummaryRun`, one row per run
 * key with `lastRunAt`). The term runs the Wednesday guardian job on fake days, which moves `lastRunAt` into 2027; left there it
 * would make the dev site's own job think it has already run. The run records the rows before it starts (in the manifest) and puts
 * them back at the end - and `--remove` puts them back too, so a crashed run is also undone. Create-vs-update is handled: a row the
 * run created is deleted, a row that existed gets its old `lastRunAt` back.
 */
import { GuardianSummaryRun } from "../../../modules/mastery/models/GuardianSummaryRun";

export interface GuardianRunRow {
  key: string;
  lastRunAt: string;
}

export async function snapshotGuardianRun(): Promise<GuardianRunRow[]> {
  const rows = await GuardianSummaryRun.collection.find({}).project({ key: 1, lastRunAt: 1 }).toArray();
  return rows.map((r) => ({ key: String(r.key), lastRunAt: new Date(r.lastRunAt as Date).toISOString() }));
}

export async function restoreGuardianRun(before: GuardianRunRow[]): Promise<void> {
  const keep = new Map(before.map((b) => [b.key, b.lastRunAt]));
  const now = await GuardianSummaryRun.collection.find({}).project({ key: 1 }).toArray();
  for (const r of now) {
    const key = String(r.key);
    const old = keep.get(key);
    if (old) await GuardianSummaryRun.collection.updateOne({ _id: r._id }, { $set: { lastRunAt: new Date(old) } });
    else await GuardianSummaryRun.collection.deleteOne({ _id: r._id }); // created by the run
  }
  for (const [key, old] of keep) {
    if (!now.some((r) => String(r.key) === key)) await GuardianSummaryRun.collection.insertOne({ key, lastRunAt: new Date(old), createdAt: new Date(), updatedAt: new Date() }); // deleted since: put back
  }
}

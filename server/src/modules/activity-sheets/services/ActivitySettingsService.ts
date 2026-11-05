/**
 * Activity-sheet rules (D-#991 defaults, owner-unconfirmed): read-time defaults until Office
 * saves the singleton (the D-#97 pattern — never seeded). activity_sheets:settings writes.
 */
import { writeAudit } from "../../platform/services/AuditService";
import { ActivitySettings, DEFAULT_ACTIVITY_SETTINGS } from "../models/ActivitySettings";
import { ActivityError } from "./ActivityBankService";

export type ActivityRules = { -readonly [K in keyof typeof DEFAULT_ACTIVITY_SETTINGS]: (typeof DEFAULT_ACTIVITY_SETTINGS)[K] extends boolean ? boolean : number };

const BOUNDS: Record<Exclude<keyof ActivityRules, "busyMode">, [number, number]> = {
  weeklyRequests: [0, 50],
  maxOpen: [1, 50],
  monthlyTarget: [1, 100],
  levelUpAfter: [1, 50],
  notReturnedDays: [1, 120],
  restockSheets: [1, 50],
  restockCopies: [1, 10],
  lowTray: [0, 100],
};

export async function activityRules(): Promise<ActivityRules & { isDefault: boolean }> {
  const row = await ActivitySettings.findOne({ key: "singleton" }).lean();
  const out = { ...DEFAULT_ACTIVITY_SETTINGS } as ActivityRules;
  if (row) {
    for (const k of Object.keys(DEFAULT_ACTIVITY_SETTINGS) as (keyof ActivityRules)[]) {
      const v = (row as Record<string, unknown>)[k];
      if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
    }
  }
  return { ...out, isDefault: !row };
}

export async function saveActivityRules(patch: Partial<Record<keyof ActivityRules, number | boolean | null | undefined>>, actorId: string): Promise<ActivityRules & { isDefault: boolean }> {
  const set: Record<string, unknown> = { updatedBy: actorId };
  for (const [k, [lo, hi]] of Object.entries(BOUNDS)) {
    const v = patch[k as keyof ActivityRules];
    if (v === undefined || v === null) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) throw new ActivityError(`নিয়মের মান ${lo}–${hi} এর মধ্যে দিন`);
    set[k] = v;
  }
  if (typeof patch.busyMode === "boolean") set.busyMode = patch.busyMode;
  await ActivitySettings.updateOne({ key: "singleton" }, { $set: set }, { upsert: true });
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetKind: "ActivitySettings", meta: { op: "saveActivityRules", ...set } });
  return activityRules();
}

/**
 * The Principal's mistake rules (D-#943): read with defaults, write with validation.
 */
import {
  STAFF_MISTAKE_DEFAULT_SETTINGS,
  STAFF_MISTAKE_KINDS,
  STAFF_WARNING_STEPS,
  staffMistakeSettingsError,
  type StaffMistakeSettingsShape,
} from "@scd/shared";
import { Types } from "mongoose";
import { StaffMistakeSettings } from "../models/StaffMistakeSettings";
import { writeAudit } from "../../platform/services/AuditService";
import { StaffMistakeError } from "./errors";

export async function getStaffMistakeSettings(): Promise<StaffMistakeSettingsShape> {
  const row = await StaffMistakeSettings.findOne({ key: "default" }).lean();
  const d = STAFF_MISTAKE_DEFAULT_SETTINGS;
  if (!row) return { ...d, rungs: d.rungs.map((r) => ({ ...r })), tierWeights: { ...d.tierWeights } };
  // Every step always present, in ladder order (a partial row falls back per step).
  const rungs = STAFF_WARNING_STEPS.map((step) => {
    const r = row.rungs.find((x) => x.step === step) ?? d.rungs.find((x) => x.step === step)!;
    return { step, count: r.count, windowDays: r.windowDays };
  });
  return {
    rungs,
    tierWeights: {
      1: row.tierWeights?.[1] ?? d.tierWeights[1],
      2: row.tierWeights?.[2] ?? d.tierWeights[2],
      3: row.tierWeights?.[3] ?? d.tierWeights[3],
    },
    deadline: row.deadline ?? d.deadline,
    disabledKinds: row.disabledKinds ?? [],
  };
}

export async function setStaffMistakeSettings(input: StaffMistakeSettingsShape, actorId: string): Promise<StaffMistakeSettingsShape> {
  const bad = staffMistakeSettingsError(input);
  if (bad) throw new StaffMistakeError(bad);
  const disabledKinds = [...new Set(input.disabledKinds)].filter((k) => (STAFF_MISTAKE_KINDS as readonly string[]).includes(k));
  const before = await getStaffMistakeSettings();
  await StaffMistakeSettings.updateOne(
    { key: "default" },
    {
      $set: {
        rungs: STAFF_WARNING_STEPS.map((step) => {
          const r = input.rungs.find((x) => x.step === step)!;
          return { step, count: r.count, windowDays: r.windowDays };
        }),
        tierWeights: input.tierWeights,
        deadline: input.deadline,
        disabledKinds,
        updatedBy: new Types.ObjectId(actorId),
      },
    },
    { upsert: true },
  );
  const after = await getStaffMistakeSettings();
  await writeAudit({
    eventKind: "STAFF_MISTAKE_SETTINGS_SET",
    actorId,
    targetKind: "StaffMistakeSettings",
    meta: { before, after },
  });
  return after;
}

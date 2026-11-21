/**
 * DevFakeRun (AL-2, prd-academic-loop-2027 section 9.3) - the manifest row of one fake-2027 generator run.
 *
 * A DEV-ONLY collection written by `dev-fake-2027` (never by the app, never copied from prod). Every row the run
 * creates in a declared collection carries `devFakeRun: <runId>`; `--remove <runId>` deletes by that stamp across
 * `collections` and then deletes this row. A plain collection of its own (instead of a field on a settings row) so a
 * crashed run still leaves its manifest behind for `--remove`.
 */
import { Schema, model, Document } from "mongoose";

export type DevFakeRunStatus = "RUNNING" | "DONE" | "FAILED";

export interface IDevFakeRun extends Document {
  runId: string;
  status: DevFakeRunStatus;
  seed: number;
  /** "2027" = run on the year-change-made 2027 year; "2026-fallback" = `--allow-2026` scenario-0 run. */
  dateMode: "2027" | "2026-fallback";
  academicYearId: string;
  fromDateKey: string;
  toDateKey: string;
  classLevels: number[];
  scenarioIds: number[];
  /** Declared collection names (base list + the scenarios' lists). */
  collections: string[];
  /** Per-scenario / per-collection counters written at the end. */
  counts: Record<string, unknown>;
  /** Config the run switched on (kept after remove; see the runbook). */
  switchedOn: string[];
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DevFakeRunSchema = new Schema<IDevFakeRun>(
  {
    runId: { type: String, required: true, unique: true },
    status: { type: String, enum: ["RUNNING", "DONE", "FAILED"], required: true, default: "RUNNING" },
    seed: { type: Number, required: true },
    dateMode: { type: String, enum: ["2027", "2026-fallback"], required: true },
    academicYearId: { type: String, required: true },
    fromDateKey: { type: String, required: true },
    toDateKey: { type: String, required: true },
    classLevels: { type: [Number], default: [] },
    scenarioIds: { type: [Number], default: [] },
    collections: { type: [String], default: [] },
    counts: { type: Schema.Types.Mixed, default: {} },
    switchedOn: { type: [String], default: [] },
    error: { type: String },
  },
  { timestamps: true },
);

export const DevFakeRun = model<IDevFakeRun>("DevFakeRun", DevFakeRunSchema);

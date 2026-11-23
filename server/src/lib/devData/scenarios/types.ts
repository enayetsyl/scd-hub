/**
 * Scenario plug-in shape for the fake-2027 generator (AL-2, prd-academic-loop-2027 section 9.3).
 *
 * Each later slice adds ONE file `scenarios/<n>-<name>.ts` that exports a `Scenario` and registers it in
 * `scenarios/index.ts`. A scenario writes THROUGH the existing services with explicit dates and calls
 * `ctx.tagDay(...)` (or `ctx.tagSince(...)`) after each batch so every row it created is stamped.
 */
import type { ModelRef } from "../collections";

export interface SectionInfo {
  sectionId: string;
  classId: string;
  /** Nursery = -1, KG = 0, Class 1..5 = 1..5. */
  level: number;
  nameBn: string;
}

export interface ScenarioCtx {
  runId: string;
  seed: number;
  /** Seeded PRNG in [0, 1): the ONLY randomness a scenario may use (so a seed reproduces a run). */
  rng: () => number;
  academicYearId: string;
  /** Candidate school days (YYYY-MM-DD, Sun..Thu) of the run's 8 weeks, holidays NOT yet removed. */
  dayKeys: string[];
  sections: SectionInfo[];
  log: (line: string) => void;
  /** Config a scenario switched on (not run data: kept after `--remove`); recorded in the manifest. */
  switchedOn: string[];
  /**
   * Stamp `devFakeRun: runId` (raw updateMany) on every row created since `since` (real time) in the declared
   * collections. Call it after each day / batch of service calls.
   */
  tagSince: (since: Date) => Promise<number>;
  /**
   * Set the dev clock to 11:00 Dhaka of this fake day (`null` clears it). The services read `appNow()` for every "date <= today",
   * "today's routine teacher", "delivery day reached" and evidence-window rule, so work dated in 2027 passes them. Call it
   * at the start of each fake day; the frame clears it after each scenario. Dev only (refused unless the DB ends in `_dev`).
   */
  clock: (dayKey: string | null) => void;
  /**
   * Record one refusal by reason. `tag` is the scenario's own counter name ("declareRefused"); the frame logs each distinct
   * (tag, message) once with its count and puts the map in the report (`reasons`). A scenario still bumps its own counter.
   */
  refuse: (tag: string, err: unknown) => void;
  /** Pick `k` distinct items at random (seeded). */
  pick: <T>(items: T[], k: number) => T[];
}

export interface Scenario {
  id: number;
  name: string;
  /** Model names this scenario writes into (declared in the manifest; removal covers them). */
  collections: ModelRef[];
  /** Returns counters for the manifest. */
  run: (ctx: ScenarioCtx) => Promise<Record<string, number>>;
}

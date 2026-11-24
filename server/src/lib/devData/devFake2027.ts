/**
 * Fake-2027 activity generator - the frame (AL-2, prd-academic-loop-2027 section 9.3, D-#1677).
 *
 * Dev only (same refusals as dev-mask). Nursery to Class 5, 8 school weeks, dry run by default, `--apply`,
 * `--remove <runId>`. One scenario per later slice plugs in through `scenarios/` (scenario 0 lives there now).
 *
 *   Year rule     the current academic year must be 2027 AND made by a year-change run (a `YearChangeRun` with
 *                 `toYearId` = that year, status CUT_OVER). `--allow-2026` lifts it for scenario 0 ONLY (the run
 *                 then uses the 8 school weeks ending last Thursday on the 2026 year, until the rehearsal).
 *   Manifest      `runId = fake-<yyyymmdd-hhmm>`, seed, classes, dates, the declared collection list: written
 *                 as a `DevFakeRun` row (a plain collection of its own, so a crashed run still has a manifest).
 *   Tag + remove  every row created in a declared collection is stamped `devFakeRun: runId` by a raw
 *                 `updateMany` after the service calls (`tagSince`: createdAt / eventAt / ObjectId time >= the
 *                 step's start). `--remove` deletes by that stamp across the declared list and verifies 0 residue.
 *                 A re-run first removes every earlier run.
 *   Muted         while the run is on, `emit()` writes no Notification (setDevNotificationMute), on top of the
 *                 AL-1 outgoing guard.
 */
import mongoose, { Types } from "mongoose";
import { assertDevTarget, DevGuardError, type GuardInput } from "./guards";
import { FAKE_BASE_MODELS, loadAllModels, resolveCollections, type ModelRef } from "./collections";
import { SCENARIOS, type Scenario, type ScenarioCtx, type SectionInfo } from "./scenarios";
import { MasteryCatalogueReview } from "../../modules/mastery/models/MasteryCatalogueReview";
import { setEnablement } from "../../modules/mastery/services/MasteryCatalogueService";
import { DevFakeRun, type IDevFakeRun } from "../../modules/platform/models/DevFakeRun";
import { AcademicYear } from "../../modules/foundation/models/AcademicYear";
import { Class } from "../../modules/foundation/models/Class";
import { Section } from "../../modules/foundation/models/Section";
import { YearChangeRun } from "../../modules/year-change/models/YearChangeRun";
import { setDevNotificationMute } from "../../modules/notifications/services/NotificationService";
import { setDevClock } from "../devClock";
import { dateKeyOf } from "../../modules/attendance/dates";
import { adoptCalendar, DEV_EXAM, removeCalendarRows, seedDevCalendar, setExamWindow, type CalendarResult } from "./term/calendar";
import { restoreGuardianRun, type GuardianRunRow } from "./term/bookkeeping";

export const FAKE_CLASS_LEVELS = [-1, 0, 1, 2, 3, 4, 5];
export const FAKE_WEEKS = 8;
export const FAKE_2027_START_KEY = "2027-01-03"; // a Sunday
/** The realistic term runs to here unless `--until` says otherwise. */
export const FAKE_DEFAULT_UNTIL = "2027-06-30";

export interface FakeOptions {
  apply: boolean;
  /** Remove this run (and nothing else) instead of generating. */
  remove?: string;
  /** Academic year id; default = the current year. */
  year?: string;
  /** Lift the "2027 made by a year-change run" rule for scenario 0 only. */
  allow2026?: boolean;
  seed?: number;
  /** Scenario ids to run; default = every registered scenario. */
  scenarioIds?: number[];
  /** The last day of the run (YYYY-MM-DD, default 2027-06-30 for the default selection). `--scenario` alone keeps the 8-week window. */
  until?: string;
  /** Test knob: move a guaranteed event of the realistic term to another day (stage id -> YYYY-MM-DD). */
  eventDays?: Record<string, string>;
  /** Alias of the old fixed window: N school weeks from 3 Jan (ignored when `until` is given). */
  weeks?: number;
  /** `--remove` also deletes the dev calendar rows (they are kept by default). */
  removeCalendar?: boolean;
  now?: Date;
  guard?: GuardInput;
  log?: (line: string) => void;
}

export interface FakeManifest {
  runId: string;
  seed: number;
  dateMode: "2027" | "2026-fallback";
  academicYearId: string;
  fromDateKey: string;
  toDateKey: string;
  classLevels: number[];
  scenarioIds: number[];
  collections: string[];
  skippedFutureModels: string[];
  sections: number;
  until?: string;
}

export interface FakeReport {
  applied: boolean;
  manifest?: FakeManifest;
  /** Earlier runs removed first (apply) or that would be removed (dry run). */
  removedRuns: string[];
  /** Per-scenario counters (apply). */
  counts: Record<string, Record<string, number>>;
  /** Tagged rows per collection after the run (apply). */
  tagged: Record<string, number>;
  /** Per scenario: `"<counter>: <refusal message>"` -> how many times (every refusal a scenario counted, by reason). */
  reasons: Record<string, Record<string, number>>;
  /** `--remove`: rows deleted per collection and the residue (must be all 0). */
  removed?: Record<string, number>;
  residue?: Record<string, number>;
  /** The dev calendar seed of the realistic term (apply). */
  calendar?: CalendarResult;
}

// ---------------------------------------------------------------------------

/** Small seeded PRNG (mulberry32): [0, 1). */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const p2 = (n: number): string => String(n).padStart(2, "0");

export function fakeRunId(now: Date): string {
  return `fake-${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}`;
}

/** Sun..Thu keys from the Sunday `startKey` to `untilKey` (inclusive). */
export function dayKeysUntil(startKey: string, untilKey: string): string[] {
  const [y, m, d] = startKey.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < 366; i++) {
    const day = new Date(y, m - 1, d + i);
    const k = dateKeyOf(day);
    if (k > untilKey) break;
    if (day.getDay() <= 4) out.push(k); // Sun..Thu
  }
  return out;
}

/** Sun..Thu keys of `weeks` weeks starting at the Sunday `startKey`. */
export function weekDayKeys(startKey: string, weeks: number): string[] {
  const [y, m, d] = startKey.split("-").map(Number);
  const out: string[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let i = 0; i < 5; i++) out.push(dateKeyOf(new Date(y, m - 1, d + w * 7 + i)));
  }
  return out;
}

/** The Sunday that starts the 8 school weeks ending on the last Thursday strictly before `now`. */
export function fallbackStartKey(now: Date, weeks = FAKE_WEEKS): string {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let back = (day.getDay() - 4 + 7) % 7; // days since the last Thursday (0 = today is Thursday)
  if (back === 0) back = 7;
  const thursday = new Date(day.getFullYear(), day.getMonth(), day.getDate() - back);
  const start = new Date(thursday.getFullYear(), thursday.getMonth(), thursday.getDate() - 4 - 7 * (weeks - 1));
  return dateKeyOf(start);
}

/** Every model the run may have written into: the base list + all registered scenarios. */
function declaredRefs(scenarios: Scenario[]): ModelRef[] {
  return [...FAKE_BASE_MODELS, ...scenarios.flatMap((s) => s.collections)];
}

/**
 * Stamp `devFakeRun` on rows created since `since` in the given models (raw driver, bypasses strict mode).
 *
 * A row counts as new when its timestamp (createdAt, else eventAt) is >= since, OR when it has no such timestamp at all and its
 * ObjectId time is >= since. The second branch matters: a writer that upserts with an update PIPELINE (QuestionUse's `recordUses`,
 * the ledger) gets no `createdAt` from mongoose, so a timestamp-only filter never saw those rows and `--remove` left them behind.
 * A model with no timestamp field (StoredFile) is matched by ObjectId time alone.
 */
export async function tagRowsSince(models: string[], runId: string, since: Date, until: Date = new Date()): Promise<number> {
  let n = 0;
  // The window is [since, until] in REAL time. The dev API runs on the dev clock (2027), so a tester's rows carry 2027 timestamps /
  // ObjectId times; the generator process has no global clock patch (only `appNow()` is faked), so `new Date()` here is the real clock.
  // Bounding the top keeps every row dated after real "now" - a tester's, written on the dev clock - out of the run.
  const sinceId = Types.ObjectId.createFromTime(Math.floor(since.getTime() / 1000));
  const untilId = Types.ObjectId.createFromTime(Math.floor(until.getTime() / 1000) + 1);
  for (const name of models) {
    const model = mongoose.model(name);
    const field = model.schema.path("createdAt") ? "createdAt" : model.schema.path("eventAt") ? "eventAt" : null;
    const idWindow = { $gte: sinceId, $lt: untilId };
    const when: Record<string, unknown> = field
      ? { $or: [{ [field]: { $gte: since, $lte: until } }, { [field]: { $exists: false }, _id: idWindow }] }
      : { _id: idWindow };
    const res = await model.collection.updateMany({ ...when, devFakeRun: { $exists: false } }, { $set: { devFakeRun: runId } });
    n += res.modifiedCount;
  }
  return n;
}

/** Delete every row stamped with `runId` across the declared list (+ the run's own stored list) and verify 0 residue. */
export async function removeFakeRun(
  runId: string,
  scenarios: Scenario[] = SCENARIOS,
  opts: { calendar?: boolean } = {},
): Promise<{ removed: Record<string, number>; residue: Record<string, number> }> {
  loadAllModels();
  const stored = (await DevFakeRun.findOne({ runId }).lean()) as unknown as IDevFakeRun | null;
  const names = new Set(resolveCollections(declaredRefs(scenarios)).found.map((f) => f.model));
  // The manifest stores COLLECTION names; map them back to models.
  for (const model of mongoose.modelNames()) {
    if (stored?.collections.includes(mongoose.model(model).collection.collectionName)) names.add(model);
  }
  const removed: Record<string, number> = {};
  const residue: Record<string, number> = {};
  // the dev calendar (devCalendar rows) is configuration the testers rely on: kept unless `--remove-calendar`
  const filter = { devFakeRun: runId, ...(opts.calendar ? {} : { devCalendar: { $ne: true } }) };
  // bookkeeping the run moved (the guardian run log) goes back to its pre-run value, whether the run finished or crashed
  const before = (stored as unknown as { bookkeeping?: { guardianRunBefore?: GuardianRunRow[] } } | null)?.bookkeeping?.guardianRunBefore;
  if (before) await restoreGuardianRun(before);
  for (const name of [...names].sort()) {
    const c = mongoose.model(name).collection;
    const res = await c.deleteMany(filter);
    removed[c.collectionName] = res.deletedCount;
    residue[c.collectionName] = await c.countDocuments(filter);
  }
  if (opts.calendar) {
    // every calendar row, whatever run id it carries, and the dates the calendar wrote onto a real exam
    for (const [k, n] of Object.entries(await removeCalendarRows())) removed[k] = (removed[k] ?? 0) + n;
  }
  const left = Object.entries(residue).filter(([, n]) => n > 0);
  if (left.length) throw new Error(`remove ${runId}: residue left in ${left.map(([k, n]) => `${k}=${n}`).join(", ")}`);
  await DevFakeRun.deleteOne({ runId });
  return { removed, residue };
}

async function yearMadeByRun(yearId: Types.ObjectId): Promise<boolean> {
  return (await YearChangeRun.exists({ toYearId: yearId, status: "CUT_OVER" })) !== null;
}

// ---------------------------------------------------------------------------

/** Switch mastery on for every class x subject with a LOCKED review round (idempotent). Config - never removed with a run. */
async function switchOnLockedPairs(yearId: string, switchedOn: string[], log: (l: string) => void): Promise<void> {
  const rounds = (await MasteryCatalogueReview.find({ state: "LOCKED" }).select("classToken subject").lean()) as unknown as Array<{ classToken: string; subject: string }>;
  const pairs = [...new Map(rounds.map((r) => [`${r.classToken}|${r.subject}`, r])).values()];
  const actor = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
  for (const r of pairs) {
    try {
      await setEnablement(yearId, r.classToken as never, r.subject as never, true, actor);
      switchedOn.push(`mastery:${r.classToken}:${r.subject}`);
    } catch (e) {
      log(`[dev-fake] mastery switch refused for ${r.classToken} ${r.subject}: ${String((e as Error)?.message ?? e)}`);
    }
  }
}

export async function runFake(opts: FakeOptions, scenarios: Scenario[] = SCENARIOS): Promise<FakeReport> {
  const log = opts.log ?? (() => undefined);
  assertDevTarget(opts.guard);
  loadAllModels();

  // --- --remove <runId> -------------------------------------------------------
  if (opts.remove) {
    const report: FakeReport = { applied: opts.apply, removedRuns: [opts.remove], counts: {}, tagged: {}, reasons: {} };
    if (!opts.apply) {
      const c = await DevFakeRun.countDocuments({ runId: opts.remove });
      log(`[dev-fake] dry run: would remove run ${opts.remove} (${c ? "manifest found" : "no manifest row - tagged rows only"})`);
      return report;
    }
    const { removed, residue } = await removeFakeRun(opts.remove, scenarios, { calendar: opts.removeCalendar });
    report.removed = removed;
    report.residue = residue;
    log(`[dev-fake] removed ${opts.remove}: ${JSON.stringify(removed)}`);
    return report;
  }

  const now = opts.now ?? new Date();
  // The default selection is the realistic term (+ the health read); the older phases (`legacy`) are chosen with `--scenario`.
  const chosen = scenarios.filter((s) => (opts.scenarioIds ? opts.scenarioIds.includes(s.id) : !s.legacy)).sort((a, b) => a.id - b.id);
  if (chosen.length === 0) throw new DevGuardError("refused: no scenario selected");

  // --- year rule ----------------------------------------------------------------
  const year = opts.year
    ? await AcademicYear.findById(opts.year)
    : await AcademicYear.findOne({ current: true });
  if (!year) throw new DevGuardError("refused: no academic year (none is current and --year was not given)");
  const is2027 = year.startDate.getFullYear() === 2027 || /2027/.test(year.label);
  const made = is2027 && (await yearMadeByRun(year._id));
  let dateMode: FakeManifest["dateMode"] = "2027";
  if (!made) {
    if (!opts.allow2026) {
      throw new DevGuardError(
        "refused: the academic year is not 2027 made by a year-change run (run the YC rehearsal first, or pass --allow-2026 for scenario 0)",
      );
    }
    if (chosen.some((s) => s.id !== 0)) {
      throw new DevGuardError("refused: --allow-2026 is for scenario 0 only");
    }
    dateMode = "2026-fallback";
  }

  // --- classes, dates, manifest -----------------------------------------------
  const classes = (await Class.find({ academicYearId: year._id, level: { $in: FAKE_CLASS_LEVELS }, active: true })
    .select("_id level")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; level: number }>;
  const levelOf = new Map(classes.map((c) => [String(c._id), c.level]));
  const secRows = (await Section.find({ classId: { $in: classes.map((c) => c._id) }, active: true })
    .select("_id classId code nameBn")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; classId: Types.ObjectId; code: string; nameBn: string }>;
  const sections: SectionInfo[] = secRows
    .map((s) => ({
      sectionId: String(s._id),
      classId: String(s.classId),
      level: levelOf.get(String(s.classId)) as number,
      nameBn: s.nameBn,
      code: s.code,
    }))
    .sort((a, b) => a.level - b.level || a.code.localeCompare(b.code) || a.sectionId.localeCompare(b.sectionId))
    .map(({ code: _code, ...rest }) => rest);

  const startKey = dateMode === "2027" ? FAKE_2027_START_KEY : fallbackStartKey(now);
  // `--until` (or the default 30 June when the realistic term is in the selection); `--weeks N` / a bare `--scenario` keep the old window
  const untilKey = dateMode === "2027" ? opts.until ?? (opts.weeks ? undefined : opts.scenarioIds ? undefined : FAKE_DEFAULT_UNTIL) : undefined;
  if (untilKey && !/^\d{4}-\d{2}-\d{2}$/.test(untilKey)) throw new DevGuardError(`refused: --until must be YYYY-MM-DD (got ${untilKey})`);
  const dayKeys = untilKey ? dayKeysUntil(startKey, untilKey) : weekDayKeys(startKey, opts.weeks ?? FAKE_WEEKS);
  const resolved = resolveCollections(declaredRefs(chosen));
  const seed = opts.seed ?? Number(`${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`) ;
  const runId = fakeRunId(now);

  const manifest: FakeManifest = {
    runId,
    seed,
    dateMode,
    academicYearId: String(year._id),
    fromDateKey: dayKeys[0],
    toDateKey: dayKeys[dayKeys.length - 1],
    classLevels: FAKE_CLASS_LEVELS,
    scenarioIds: chosen.map((s) => s.id),
    collections: resolved.found.map((f) => f.collection),
    skippedFutureModels: resolved.skipped,
    sections: sections.length,
    ...(untilKey ? { until: untilKey } : {}),
  };

  const previous = (await DevFakeRun.find({}).select("runId").lean()) as unknown as Array<{ runId: string }>;
  const report: FakeReport = { applied: opts.apply, manifest, removedRuns: previous.map((p) => p.runId), counts: {}, tagged: {}, reasons: {} };
  log(`[dev-fake] manifest ${JSON.stringify(manifest)}`);

  if (!opts.apply) {
    log(`[dev-fake] dry run: would remove ${previous.length} earlier run(s), then run scenarios ${manifest.scenarioIds.join(",")} over ${dayKeys.length} candidate days x ${sections.length} sections`);
    return report;
  }

  // --- apply ---------------------------------------------------------------------
  for (const p of previous) await removeFakeRun(p.runId, scenarios, { calendar: false });
  await DevFakeRun.create({
    runId,
    status: "RUNNING",
    seed,
    dateMode,
    academicYearId: manifest.academicYearId,
    fromDateKey: manifest.fromDateKey,
    toDateKey: manifest.toDateKey,
    classLevels: manifest.classLevels,
    scenarioIds: manifest.scenarioIds,
    collections: manifest.collections,
  });

  const rng = seededRng(seed);
  const models = resolved.found.map((f) => f.model);
  // Every refusal a scenario counts, by reason (ctx.refuse): logged once per distinct reason with its count, and kept in the report.
  let reasonBook = new Map<string, number>();
  const switchedOn: string[] = [];
  const ctx: ScenarioCtx = {
    runId,
    seed,
    rng,
    academicYearId: manifest.academicYearId,
    dayKeys,
    sections,
    log,
    switchedOn,
    until: dayKeys[dayKeys.length - 1] as string,
    ...(opts.eventDays ? { eventDays: opts.eventDays } : {}),
    saveManifest: async (patch) => {
      await DevFakeRun.updateOne({ runId }, { $set: patch });
    },
    tagSince: (since) => tagRowsSince(models, runId, since),
    clock: (dayKey) => setDevClock(dayKey ? new Date(`${dayKey}T11:00:00+06:00`) : null), // 11:00 Dhaka: school hours of the fake day
    refuse: (tag, err) => {
      const msg = String((err as Error)?.message ?? err).replace(/[0-9a-f]{24}/gi, "<id>").replace(/\s+/g, " ").trim().slice(0, 300);
      const key = `${tag}: ${msg}`;
      reasonBook.set(key, (reasonBook.get(key) ?? 0) + 1);
    },
    pick: <T>(items: T[], k: number): T[] => {
      const pool = [...items];
      const out: T[] = [];
      while (out.length < k && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      return out;
    },
  };

  setDevNotificationMute(true);
  const runStart = new Date();
  try {
    // PRD 9.3: the 2027 scenarios run with mastery switched ON for every class x subject whose objective list is LOCKED (dev only,
    // the 2027 year only). It is CONFIG, not run data: it is recorded in `switchedOn` and `--remove` leaves it. Through the
    // enablement service itself, so its own rules apply; a pair it refuses is skipped.
    if (dateMode === "2027") await switchOnLockedPairs(String(year._id), switchedOn, log);
    // The dev calendar (section 2 of docs/dev-test-scenarios-2027.md) goes in first when a selected scenario reads it.
    // every apply (a legacy run too) puts the calendar rows an earlier run left under THIS run's id, so `--remove-calendar` finds them
    await adoptCalendar(runId);
    setExamWindow(DEV_EXAM.startDateKey, DEV_EXAM.endDateKey);
    if (dateMode === "2027" && chosen.some((s) => s.needsCalendar)) {
      report.calendar = await seedDevCalendar({ runId, academicYearId: manifest.academicYearId, classes: classes.map((c) => ({ classId: String(c._id), level: c.level })), actorId: new Types.ObjectId().toString(), log });
      await DevFakeRun.updateOne({ runId }, { $set: { calendar: report.calendar } });
      await tagRowsSince(models, runId, runStart); // the audit rows of the calendar writes (exam created / routine saved) belong to the run
    }
    for (const s of chosen) {
      const since = new Date();
      log(`[dev-fake] scenario ${s.id} (${s.name})`);
      reasonBook = new Map();
      try {
        report.counts[String(s.id)] = await s.run(ctx);
      } finally {
        ctx.clock(null);
        report.reasons[String(s.id)] = Object.fromEntries([...reasonBook.entries()].sort((a, b) => b[1] - a[1]));
        for (const [key, count] of [...reasonBook.entries()].sort((a, b) => b[1] - a[1])) {
          const i = key.indexOf(": ");
          log(`[dev-fake] s${s.id} ${key.slice(0, i)} x${count}: ${key.slice(i + 2)}`);
        }
      }
      await ctx.tagSince(since);
    }
    for (const f of resolved.found) {
      report.tagged[f.collection] = await mongoose.model(f.model).collection.countDocuments({ devFakeRun: runId });
    }
    await DevFakeRun.updateOne(
      { runId },
      { $set: { status: "DONE", counts: { scenarios: report.counts, tagged: report.tagged }, switchedOn } },
    );
  } catch (err) {
    // Tag whatever a failed scenario managed to write, so `--remove <runId>` still cleans it.
    await tagRowsSince(models, runId, runStart);
    await DevFakeRun.updateOne({ runId }, { $set: { status: "FAILED", error: String((err as Error)?.message ?? err) } });
    throw err;
  } finally {
    setDevNotificationMute(false);
    setDevClock(null);
  }
  log(`[dev-fake] done ${runId}: ${JSON.stringify(report.counts)}; tagged ${JSON.stringify(report.tagged)}`);
  return report;
}

/**
 * ObservationRotaService (CO-14, D-#426) — turn a written instruction into a dated
 * review rota.
 *
 * The division of labour is the whole design (D-#426):
 *
 *   SERVER  builds the option space first — which dates are school days (via the ONE
 *           calendar source, `resolveDayType`, so holidays are honoured), which slots
 *           are effective on each of those dates, which class levels are eligible, and
 *           the clock time of every period (`computePeriodTimes` off the active
 *           `ScheduleWindow` + the `PeriodGrid` serving that class level).
 *   MODEL   picks one candidate id per school day and restates the constraints it acted
 *           on. It never emits a date, a period, a time or a class.
 *   SERVER  validates the answer back against the same set (`validateRota`) and, on
 *           violation, retries ONCE with the problems named, then REFUSES.
 *
 * There is deliberately no fallback rota. A monthly comment can degrade to a template;
 * a plausible-looking wrong rota cannot degrade to anything, because nobody can tell by
 * looking that it is wrong.
 *
 * Staff/operational plane (names teachers) — no corpus or student path (ADR-005).
 */
import { Types } from "mongoose";
import { DAYS_OF_WEEK } from "@scd/shared";
import { RoutineSlot, type IRoutineSlot } from "../../routine/models/RoutineSlot";
import { ScheduleWindow, type IScheduleWindow } from "../../routine/models/ScheduleWindow";
import { PeriodGrid, type IPeriodGrid } from "../../routine/models/PeriodGrid";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import { computePeriodTimes, windowFor } from "../../routine/schedule";
import { resolveDayType } from "../../routine/calendar";
import { dateKeyOf } from "../../attendance/dates";
import { writeAudit } from "../../platform/services/AuditService";
import { ObservationRota, type IObservationRota } from "../models/ObservationRota";
import {
  candidatesForDate,
  datesInRange,
  normalizeEcho,
  validateRota,
  type PeriodClock,
  type RotaCandidate,
  type RotaConstraintEcho,
  type RotaRow,
  type SlotForRota,
} from "../rota";

export class ObservationRotaError extends Error {
  /** Named violations when the model's answer failed validation twice. */
  readonly violations: string[];
  constructor(message: string, violations: string[] = []) {
    super(message);
    this.name = "ObservationRotaError";
    this.violations = violations;
  }
}

export const ROTA_PROMPT_VERSION = "co14-1";

/** Eligible roster levels by default — Nursery (-1) and KG (0) are out (owner rule). */
export const DEFAULT_CLASS_LEVELS = [1, 2, 3, 4, 5];

// ---------------------------------------------------------------------------
// Candidate expansion
// ---------------------------------------------------------------------------

export interface ExpandInput {
  from: string; // YYYY-MM-DD
  to: string;
  classLevels?: number[];
  excludeTeacherIds?: string[];
}

export interface ExpandResult {
  schoolDays: string[];
  candidates: RotaCandidate[];
}

/**
 * Expand the live routine into every dated, eligible session in the range.
 *
 * School days come from `resolveDayType` — FULL only. QURAN_ONLY (Saturday) is excluded
 * because a REF-11 observation targets general teaching; OFF and HOLIDAY carry no
 * routine at all. That keeps this on the same calendar source as attendance and the
 * trackers rather than inventing a second definition of "a school day".
 */
export async function expandRotaCandidates(input: ExpandInput): Promise<ExpandResult> {
  const classLevels = input.classLevels?.length ? input.classLevels : DEFAULT_CLASS_LEVELS;
  const excludeTeacherIds = input.excludeTeacherIds ?? [];

  const dates = datesInRange(input.from, input.to);
  if (!dates.length) return { schoolDays: [], candidates: [] };

  // --- reference data, read once ---------------------------------------------
  const [windows, grids, sections, classes, groups, users] = await Promise.all([
    ScheduleWindow.find({ active: true }).lean() as unknown as Promise<IScheduleWindow[]>,
    PeriodGrid.find({ active: true }).lean() as unknown as Promise<IPeriodGrid[]>,
    Section.find({}).select("code nameBn classId").lean() as unknown as Promise<
      Array<{ _id: Types.ObjectId; code: string; nameBn: string; classId: Types.ObjectId }>
    >,
    Class.find({}).select("level nameBn").lean() as unknown as Promise<
      Array<{ _id: Types.ObjectId; level: number; nameBn: string }>
    >,
    SubjectGroup.find({}).select("nameBn name").lean() as unknown as Promise<
      Array<{ _id: Types.ObjectId; nameBn?: string; name?: string }>
    >,
    User.find({ active: { $ne: false } }).select("name").lean() as unknown as Promise<
      Array<{ _id: Types.ObjectId; name: string }>
    >,
  ]);

  const classById = new Map(classes.map((c) => [c._id.toString(), c]));
  const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));
  const groupById = new Map(groups.map((g) => [g._id.toString(), g]));
  const userName = new Map(users.map((u) => [u._id.toString(), u.name]));

  const allSlots = (await RoutineSlot.find({ active: true }).lean()) as unknown as IRoutineSlot[];

  const schoolDays: string[] = [];
  const candidates: RotaCandidate[] = [];

  for (const date of dates) {
    // ONE calendar source — holidays included (D-#50).
    const dayType = await resolveDayType(date);
    if (dayType !== "FULL") continue;
    const dateKey = dateKeyOf(date);
    schoolDays.push(dateKey);

    const dow = DAYS_OF_WEEK[date.getDay()];
    const win = windowFor(date, windows);
    const dayStartMinutes = win ? win.dayStartMinutes : 420;
    const season = win ? win.season : "regular";

    // Effective-dated (R2.7): a slot counts only inside [effectiveFrom, effectiveTo).
    const live = allSlots.filter(
      (s) =>
        s.dayOfWeek === dow &&
        !s.isBreak &&
        new Date(s.effectiveFrom).getTime() <= date.getTime() &&
        (!s.effectiveTo || new Date(s.effectiveTo).getTime() >= date.getTime()),
    );

    // A grid per class level (nursery_kg vs class_1_5 have different period counts,
    // so the clock differs by audience — never one grid for the whole school).
    const clockFor = new Map<number, PeriodClock[]>();
    const gridPeriods = (level: number): PeriodClock[] => {
      const cached = clockFor.get(level);
      if (cached) return cached;
      const grid = grids.find((g) => g.season === season && g.classLevels.includes(level));
      const computed = grid ? computePeriodTimes(dayStartMinutes, grid.periods) : [];
      const list = computed.map((p) => ({ number: p.number, startHHMM: p.startHHMM, endHHMM: p.endHHMM }));
      clockFor.set(level, list);
      return list;
    };

    const flat: SlotForRota[] = [];
    for (const s of live) {
      const sectionId = s.groupType === "section" ? s.groupId.toString() : null;
      const sec = sectionId ? sectionById.get(sectionId) : undefined;
      const klass = sec ? classById.get(sec.classId?.toString() ?? "") : undefined;
      const level = klass ? klass.level : null;
      const groupLabel = sec && klass
        ? `${klass.nameBn} · ${sec.nameBn}`
        : (groupById.get(s.groupId.toString())?.nameBn ?? groupById.get(s.groupId.toString())?.name ?? "—");
      flat.push({
        slotId: s._id.toString(),
        teacherId: s.teacherId ? s.teacherId.toString() : null,
        teacherName: s.teacherId ? (userName.get(s.teacherId.toString()) ?? "") : "",
        sectionId,
        subjectGroupId: s.groupType === "subjectgroup" ? s.groupId.toString() : null,
        classLevel: level,
        groupLabel,
        subject: s.subject,
        periodNumber: s.periodNumber,
        isBreak: !!s.isBreak,
      });
    }

    // Group the per-level clocks: a slot's times come from ITS class's grid.
    for (const f of flat) {
      if (f.classLevel === null) continue;
      const built = candidatesForDate(date, dow, [f], gridPeriods(f.classLevel), {
        classLevels,
        excludeTeacherIds,
      });
      candidates.push(...built);
    }
  }

  // A slot with no resolvable teacher name is dropped — the model must not be shown a
  // blank name it would then echo back into a constraint.
  return { schoolDays, candidates: candidates.filter((c) => c.teacherName) };
}

// ---------------------------------------------------------------------------
// The provider seam (mirrors MR-4's CommentProvider, D-#399(e))
// ---------------------------------------------------------------------------

export interface RotaProvider {
  readonly model: string;
  /** Returns the model's raw text — expected to be JSON, parsed by the caller. */
  generate(prompt: string): Promise<string>;
}

/** Gemini over the public REST endpoint with a response schema, so the shape is
 *  constrained at decode time rather than hoped for. No SDK — one fetch, matching the
 *  MR-4 precedent, so the seam stays swappable and the server gains no vendor package. */
export class GeminiRotaProvider implements RotaProvider {
  readonly model: string;
  private readonly apiKey: string;
  resolvedModel: string | null = null;

  constructor(apiKey: string, model = "gemini-flash-latest") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(prompt: string): Promise<string> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            // Must cover the model's REASONING as well as its answer (MR-4 learned this
            // the hard way: a small budget returns a truncated fragment).
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
            responseSchema: ROTA_RESPONSE_SCHEMA,
          },
        }),
      },
    );
    if (!res.ok) throw new ObservationRotaError(`Gemini returned ${res.status}`);
    const body = (await res.json()) as {
      candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
      modelVersion?: string;
    };
    if (body.modelVersion) this.resolvedModel = body.modelVersion;
    const cand = body.candidates?.[0];
    if (cand?.finishReason && cand.finishReason !== "STOP") {
      throw new ObservationRotaError(`Gemini stopped early (${cand.finishReason}) — the reply was cut off`);
    }
    const text = (cand?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) throw new ObservationRotaError("Gemini returned no text");
    return text;
  }
}

/** Null when no key is configured — the caller refuses politely rather than crashing. */
export function rotaProviderFromEnv(): RotaProvider | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GeminiRotaProvider(key, process.env.GEMINI_MODEL || undefined);
}

/** The response shape the model is CONSTRAINED to — ids only, plus its restatement. */
const ROTA_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    constraints: {
      type: "object",
      properties: {
        intensive: {
          type: "array",
          items: {
            type: "object",
            properties: {
              teacherName: { type: "string" },
              everyNDays: { type: "integer" },
              rotateClasses: { type: "boolean" },
            },
            required: ["teacherName", "everyNDays"],
          },
        },
        excluded: {
          type: "array",
          items: {
            type: "object",
            properties: { teacherName: { type: "string" }, reason: { type: "string" } },
            required: ["teacherName"],
          },
        },
        caps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              teacherName: { type: "string" },
              max: { type: "integer" },
              window: { type: "string" },
            },
            required: ["teacherName", "max"],
          },
        },
        classLevels: { type: "array", items: { type: "integer" } },
        perDay: { type: "integer" },
      },
      required: ["perDay"],
    },
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          candidateId: { type: "string" },
          reason: { type: "string" },
        },
        required: ["date", "candidateId"],
      },
    },
  },
  required: ["constraints", "rows"],
} as const;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export function buildRotaPrompt(
  instruction: string,
  schoolDays: string[],
  candidates: RotaCandidate[],
  history: Array<{ teacherName: string; lastReviewedOn: string | null; reviewCount: number }>,
  problems: string[] = [],
): string {
  const compact = candidates.map((c) => ({
    id: c.id,
    date: c.date,
    day: c.dayOfWeek,
    teacher: c.teacherName,
    cls: c.groupLabel,
    subject: c.subject,
    period: c.periodNumber,
  }));
  const retry = problems.length
    ? `\nYOUR PREVIOUS ANSWER WAS REJECTED. Fix exactly these problems:\n${problems.map((p) => `- ${p}`).join("\n")}\n`
    : "";
  return [
    "You are scheduling classroom-observation video reviews for a school.",
    "",
    "RULES — these are absolute:",
    "1. Choose sessions ONLY from the CANDIDATES list, by their `id`. Never invent an id.",
    "2. Every SCHOOL DAY listed must appear exactly `perDay` times. No day missing, none doubled.",
    "3. A row's `date` must equal the chosen candidate's `date`.",
    "4. Do NOT output a period, a time, or a class name — only the id.",
    "5. Restate the instruction you acted on in `constraints`, using the exact teacher names from the candidates.",
    retry,
    `INSTRUCTION FROM THE PRINCIPAL:\n${instruction}`,
    "",
    `SCHOOL DAYS (${schoolDays.length}): ${schoolDays.join(", ")}`,
    "",
    `REVIEW HISTORY (for ordering — who is most overdue):\n${history
      .map((h) => `- ${h.teacherName}: ${h.reviewCount} review(s), last ${h.lastReviewedOn ?? "never"}`)
      .join("\n")}`,
    "",
    `CANDIDATES (${compact.length}):`,
    JSON.stringify(compact),
    "",
    "Return JSON only.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

export interface GenerateRotaInput {
  from: string;
  to: string;
  instruction: string;
  classLevels?: number[];
  excludeTeacherIds?: string[];
  actorId: string;
  /** Injected in tests; production uses `rotaProviderFromEnv()`. */
  provider?: RotaProvider | null;
}

export interface GeneratedRota {
  from: string;
  to: string;
  instruction: string;
  constraintEcho: RotaConstraintEcho;
  rows: Array<RotaRow & { candidate: RotaCandidate }>;
  model: string;
  promptVersion: string;
}

interface ParsedAnswer {
  echo: RotaConstraintEcho;
  rows: RotaRow[];
}

function parseAnswer(text: string): ParsedAnswer {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // A fenced block sometimes survives even with responseMimeType set.
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new ObservationRotaError("The model did not return JSON.");
    raw = JSON.parse(m[0]);
  }
  const o = (raw ?? {}) as Record<string, unknown>;
  const rows = (Array.isArray(o.rows) ? o.rows : []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      date: String(x.date ?? ""),
      candidateId: String(x.candidateId ?? ""),
      reason: x.reason ? String(x.reason) : null,
    };
  });
  return { echo: normalizeEcho(o.constraints), rows };
}

/**
 * Generate a rota. Validates the model's answer, retries ONCE with the violations
 * named, then throws with them attached — the caller shows the violations rather than
 * an unvalidated table.
 */
export async function generateRota(input: GenerateRotaInput): Promise<GeneratedRota> {
  const instruction = (input.instruction ?? "").trim();
  if (instruction.length < 3) throw new ObservationRotaError("Write the scheduling instruction first.");

  const provider = input.provider !== undefined ? input.provider : rotaProviderFromEnv();
  if (!provider) {
    throw new ObservationRotaError(
      "No AI provider is configured (GEMINI_API_KEY). The rota cannot be generated automatically.",
    );
  }

  const { schoolDays, candidates } = await expandRotaCandidates({
    from: input.from,
    to: input.to,
    classLevels: input.classLevels,
    excludeTeacherIds: input.excludeTeacherIds,
  });
  if (!schoolDays.length) throw new ObservationRotaError("There are no school days in that range.");
  if (!candidates.length) {
    throw new ObservationRotaError("The routine has no eligible sessions in that range (classes 1–5).");
  }

  const history = await reviewHistoryFor(candidates);

  let problems: string[] = [];
  let parsed: ParsedAnswer | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = buildRotaPrompt(instruction, schoolDays, candidates, history, problems);
    const text = await provider.generate(prompt);
    parsed = parseAnswer(text);
    problems = validateRota(parsed.rows, candidates, schoolDays, parsed.echo);
    if (!problems.length) break;
  }
  if (!parsed) throw new ObservationRotaError("The model returned nothing usable.");
  if (problems.length) {
    throw new ObservationRotaError("The generated rota broke the rules you set.", problems);
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const rows = parsed.rows
    .map((r) => ({ ...r, candidate: byId.get(r.candidateId)! }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    from: input.from,
    to: input.to,
    instruction,
    constraintEcho: parsed.echo,
    rows,
    model:
      provider instanceof GeminiRotaProvider && provider.resolvedModel ? provider.resolvedModel : provider.model,
    promptVersion: ROTA_PROMPT_VERSION,
  };
}

/** Per-teacher review history over the candidates' teachers — the ordering signal the
 *  CO-6 scheduler already derives, passed in as a FACT rather than left to the model. */
async function reviewHistoryFor(
  candidates: RotaCandidate[],
): Promise<Array<{ teacherName: string; lastReviewedOn: string | null; reviewCount: number }>> {
  const { ClassroomObservation } = await import("../models/ClassroomObservation");
  const ids = [...new Set(candidates.map((c) => c.teacherId))];
  const names = new Map(candidates.map((c) => [c.teacherId, c.teacherName]));
  const out: Array<{ teacherName: string; lastReviewedOn: string | null; reviewCount: number }> = [];
  for (const id of ids) {
    const rows = (await ClassroomObservation.find({
      teacherId: new Types.ObjectId(id),
      state: { $in: ["REVIEWED", "TEACHER_RESPONDED", "SUPERSEDED"] },
    })
      .select("classDate")
      .sort({ classDate: -1 })
      .lean()) as unknown as Array<{ classDate: string }>;
    out.push({
      teacherName: names.get(id) ?? "",
      lastReviewedOn: rows[0]?.classDate ?? null,
      reviewCount: rows.length,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Save / read
// ---------------------------------------------------------------------------

export interface SaveRotaInput extends GeneratedRota {
  actorId: string;
}

export async function saveRota(input: SaveRotaInput): Promise<string> {
  const doc = await ObservationRota.create({
    periodFrom: input.from,
    periodTo: input.to,
    instruction: input.instruction,
    constraintEcho: input.constraintEcho,
    rows: input.rows.map((r) => ({
      date: r.date,
      candidateId: r.candidateId,
      teacherId: new Types.ObjectId(r.candidate.teacherId),
      teacherName: r.candidate.teacherName,
      sectionId: r.candidate.sectionId ? new Types.ObjectId(r.candidate.sectionId) : null,
      subjectGroupId: r.candidate.subjectGroupId ? new Types.ObjectId(r.candidate.subjectGroupId) : null,
      groupLabel: r.candidate.groupLabel,
      subject: r.candidate.subject,
      periodNumber: r.candidate.periodNumber,
      startHHMM: r.candidate.startHHMM,
      endHHMM: r.candidate.endHHMM,
      reason: r.reason,
    })),
    modelId: input.model,
    promptVersion: input.promptVersion,
    createdBy: new Types.ObjectId(input.actorId),
  });

  await writeAudit({
    eventKind: "OBSERVATION_ROTA_SAVED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "ObservationRota",
    meta: { periodFrom: input.from, periodTo: input.to, rows: input.rows.length, model: input.model },
  });

  return doc._id.toString();
}

export interface StoredRotaRowShape {
  date: string;
  candidateId: string;
  teacherId: string;
  teacherName: string;
  groupLabel: string;
  subject: string;
  periodNumber: number;
  startHHMM: string;
  endHHMM: string;
  reason: string | null;
  /** True when the routine slot behind this row is no longer live — the routine changes
   *  often and is edited in place, so a stored rota must degrade VISIBLY rather than
   *  quietly show a period that has moved. */
  slotChanged: boolean;
}

export interface StoredRotaShape {
  id: string;
  periodFrom: string;
  periodTo: string;
  instruction: string;
  constraintEcho: RotaConstraintEcho;
  rows: StoredRotaRowShape[];
  model: string;
  promptVersion: string;
  createdBy: string;
  createdAt: string;
}

/** Re-resolve a stored rota against the LIVE routine, flagging rows whose slot has
 *  moved or gone. The stored values are still shown — a flag, not a silent rewrite. */
export async function getRota(rotaId: string): Promise<StoredRotaShape | null> {
  const doc = (await ObservationRota.findById(rotaId).lean()) as unknown as IObservationRota | null;
  if (!doc) return null;

  const liveIds = new Set(
    ((await RoutineSlot.find({ active: true }).select("_id").lean()) as unknown as Array<{ _id: Types.ObjectId }>).map(
      (s) => s._id.toString(),
    ),
  );

  return {
    id: doc._id.toString(),
    periodFrom: doc.periodFrom,
    periodTo: doc.periodTo,
    instruction: doc.instruction,
    constraintEcho: doc.constraintEcho as unknown as RotaConstraintEcho,
    rows: (doc.rows ?? []).map((r) => ({
      date: r.date,
      candidateId: r.candidateId,
      teacherId: r.teacherId.toString(),
      teacherName: r.teacherName,
      groupLabel: r.groupLabel,
      subject: r.subject,
      periodNumber: r.periodNumber,
      startHHMM: r.startHHMM,
      endHHMM: r.endHHMM,
      reason: r.reason ?? null,
      slotChanged: !liveIds.has(r.candidateId.split("#")[1] ?? ""),
    })),
    model: doc.modelId,
    promptVersion: doc.promptVersion,
    createdBy: doc.createdBy.toString(),
    createdAt: new Date(doc.createdAt).toISOString(),
  };
}

export async function listRotas(limit = 12): Promise<StoredRotaShape[]> {
  const docs = (await ObservationRota.find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .select("_id")
    .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  const out: StoredRotaShape[] = [];
  for (const d of docs) {
    const full = await getRota(d._id.toString());
    if (full) out.push(full);
  }
  return out;
}

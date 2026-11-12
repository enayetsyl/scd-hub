/**
 * Session home guides (GH-4, docs/prd-guardian-help.md §5; D-#1523/#1528).
 *
 *  - `checkSessionHomeGuides` — the pure file check: refuses an unknown class token / subject, steps
 *    not 5–7, empty text, missing classworkItems, a bad chapter / session / minutes figure, a
 *    repeated address. All-or-nothing: one bad guide and nothing is written.
 *  - `importSessionHomeGuides(json, actorId, { dryRun })` — upsert by (classToken, subject, chapter,
 *    sessionIndex). Dry run is the DEFAULT and writes nothing. A changed guide bumps `version`.
 *  - `guidesForSessions` — the guardian read: guides for the sessions of one class level x subject.
 *
 * The caller's `home_guide:import` gate lives in the resolver; the script runs from the shell.
 */
import { Types } from "mongoose";
import { MASTERY_CLASS_TOKENS, MASTERY_SUBJECTS } from "@scd/shared";
import { classTokenForLevel } from "../../mastery/services/MasteryWorkService";
import { SessionHomeGuide, type ISessionHomeGuide } from "../models/SessionHomeGuide";

export const HOME_GUIDE_MIN_STEPS = 5;
export const HOME_GUIDE_MAX_STEPS = 7;
export const HOME_GUIDE_MAX_MINUTES = 60;

export interface HomeGuideInput {
  classToken: string;
  subject: string;
  chapter: number;
  sessionIndex: number;
  planArtifactId?: string;
  steps: string[];
  classworkItems: Array<{ label: string; textBn: string }>;
  homeTimeMin: number;
}

export interface HomeGuideCheck {
  guides: HomeGuideInput[];
  errors: string[];
}

const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;
const addressOf = (g: Pick<HomeGuideInput, "classToken" | "subject" | "chapter" | "sessionIndex">) =>
  `${g.classToken}/${g.subject}/ch${g.chapter}/s${g.sessionIndex}`;

/** Pure: parse + validate one pack file. Never throws on content; problems come back in `errors`. */
export function checkSessionHomeGuides(input: unknown): HomeGuideCheck {
  const errors: string[] = [];
  let data: unknown = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch {
      return { guides: [], errors: ["the file is not valid JSON"] };
    }
  }
  const list = (data as { guides?: unknown } | null)?.guides;
  if (!Array.isArray(list) || list.length === 0) return { guides: [], errors: ['the file needs a non-empty "guides" list'] };
  const out: HomeGuideInput[] = [];
  const seen = new Set<string>();
  list.forEach((raw, i) => {
    const at = `guides[${i}]`;
    const g = (raw ?? {}) as Record<string, unknown>;
    const before = errors.length;
    if (!(MASTERY_CLASS_TOKENS as readonly string[]).includes(String(g.classToken))) errors.push(`${at}: unknown classToken "${String(g.classToken)}"`);
    if (!(MASTERY_SUBJECTS as readonly string[]).includes(String(g.subject))) errors.push(`${at}: unknown subject "${String(g.subject)}"`);
    if (!isPosInt(g.chapter)) errors.push(`${at}: chapter must be a whole number from 1`);
    if (!isPosInt(g.sessionIndex)) errors.push(`${at}: sessionIndex must be a whole number from 1`);
    if (!isPosInt(g.homeTimeMin) || g.homeTimeMin > HOME_GUIDE_MAX_MINUTES) {
      errors.push(`${at}: homeTimeMin must be a whole number of minutes, 1–${HOME_GUIDE_MAX_MINUTES}`);
    }
    if (g.planArtifactId !== undefined && g.planArtifactId !== null && !(typeof g.planArtifactId === "string" && Types.ObjectId.isValid(g.planArtifactId))) {
      errors.push(`${at}: planArtifactId is not a valid id`);
    }
    if (!Array.isArray(g.steps) || g.steps.length < HOME_GUIDE_MIN_STEPS || g.steps.length > HOME_GUIDE_MAX_STEPS) {
      errors.push(`${at}: steps must be ${HOME_GUIDE_MIN_STEPS}–${HOME_GUIDE_MAX_STEPS} lines`);
    } else if (!g.steps.every(isText)) errors.push(`${at}: a step is empty`);
    if (!Array.isArray(g.classworkItems)) errors.push(`${at}: classworkItems is missing`);
    else if (!g.classworkItems.every((c) => isText((c as { label?: unknown })?.label) && isText((c as { textBn?: unknown })?.textBn))) {
      errors.push(`${at}: every classwork item needs a label and a text`);
    }
    if (errors.length > before) return;
    const guide: HomeGuideInput = {
      classToken: String(g.classToken),
      subject: String(g.subject),
      chapter: g.chapter as number,
      sessionIndex: g.sessionIndex as number,
      planArtifactId: typeof g.planArtifactId === "string" ? g.planArtifactId : undefined,
      steps: (g.steps as string[]).map((s) => s.trim()),
      classworkItems: (g.classworkItems as Array<{ label: string; textBn: string }>).map((c) => ({ label: c.label.trim(), textBn: c.textBn.trim() })),
      homeTimeMin: g.homeTimeMin as number,
    };
    const key = addressOf(guide);
    if (seen.has(key)) {
      errors.push(`${at}: ${key} appears twice in the file`);
      return;
    }
    seen.add(key);
    out.push(guide);
  });
  return { guides: errors.length ? [] : out, errors };
}

export interface HomeGuideImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

const sameContent = (row: ISessionHomeGuide, g: HomeGuideInput): boolean =>
  row.homeTimeMin === g.homeTimeMin &&
  String(row.planArtifactId ?? "") === (g.planArtifactId ?? "") &&
  JSON.stringify(row.steps.map((s) => s.textBn)) === JSON.stringify(g.steps) &&
  JSON.stringify(row.classworkItems.map((c) => ({ label: c.label, textBn: c.textBn }))) === JSON.stringify(g.classworkItems);

export async function importSessionHomeGuides(
  json: unknown,
  actorId: string,
  opts: { dryRun?: boolean } = {},
): Promise<HomeGuideImportResult> {
  const dryRun = opts.dryRun !== false; // dry run unless asked otherwise
  const { guides, errors } = checkSessionHomeGuides(json);
  const result: HomeGuideImportResult = { dryRun, total: guides.length, created: 0, updated: 0, unchanged: 0, errors };
  if (errors.length) return result;
  const actor = new Types.ObjectId(actorId);
  for (const g of guides) {
    const key = { classToken: g.classToken, subject: g.subject, chapter: g.chapter, sessionIndex: g.sessionIndex };
    const row = await SessionHomeGuide.findOne(key);
    if (!row) {
      result.created++;
      if (!dryRun) {
        await SessionHomeGuide.create({
          ...key,
          planArtifactId: g.planArtifactId ? new Types.ObjectId(g.planArtifactId) : undefined,
          steps: g.steps.map((textBn) => ({ textBn })),
          classworkItems: g.classworkItems,
          homeTimeMin: g.homeTimeMin,
          version: 1,
          updatedBy: actor,
        });
      }
      continue;
    }
    if (sameContent(row, g)) {
      result.unchanged++;
      continue;
    }
    result.updated++;
    if (!dryRun) {
      row.planArtifactId = g.planArtifactId ? new Types.ObjectId(g.planArtifactId) : undefined;
      row.steps = g.steps.map((textBn) => ({ textBn })) as never;
      row.classworkItems = g.classworkItems as never;
      row.homeTimeMin = g.homeTimeMin;
      row.version += 1;
      row.updatedBy = actor;
      await row.save();
    }
  }
  return result;
}

export interface SessionHomeGuideView {
  steps: string[];
  classworkItems: Array<{ label: string; textBn: string }>;
  homeTimeMin: number;
}

/** The guides for some sessions of one class level x subject, keyed `<chapter>:<sessionIndex>` (the delivery's session key). */
export async function guidesForSessions(
  classLevel: number,
  subject: string,
  sessions: Array<{ chapter: string; sessionIndex: number }>,
): Promise<Map<string, SessionHomeGuideView>> {
  const out = new Map<string, SessionHomeGuideView>();
  const token = classTokenForLevel(classLevel); // Nursery = -1, KG = 0 as well as C1–C6
  if (!token || sessions.length === 0) return out;
  const wanted = sessions.filter((s) => /^\d+$/.test(s.chapter)).map((s) => ({ chapter: Number(s.chapter), sessionIndex: s.sessionIndex }));
  if (wanted.length === 0) return out;
  const rows = await SessionHomeGuide.find({ classToken: token, subject, $or: wanted }).lean();
  for (const r of rows) {
    out.set(`${r.chapter}:${r.sessionIndex}`, {
      steps: r.steps.map((s) => s.textBn),
      classworkItems: r.classworkItems.map((c) => ({ label: c.label, textBn: c.textBn })),
      homeTimeMin: r.homeTimeMin,
    });
  }
  return out;
}

/**
 * Shared helpers for the data-assistant tools: typed argument pieces, date ranges, row caps and
 * the class/section labels every row carries (PRD §4.3 rule 3, §10). No gate lives here.
 */
import { Types } from "mongoose";
import { z } from "zod";
import { ROSTER_CLASS_LABELS_BN } from "@scd/shared";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { currentAcademicYearId } from "../../foundation/services/currentYear";
import { ToolInvalid } from "../types";

export const DATE_KEY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD (Dhaka date)");
export const MONTH_KEY = z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM");
export const OBJECT_ID = z.string().regex(/^[0-9a-fA-F]{24}$/, "an id returned by another tool");
export const CLASS_LEVEL = z.number().int().min(-1).max(6).describe("-1 Nursery, 0 KG, 1..6 Class 1..6");
export const SUBJECT = z.string().regex(/^[A-Za-z_]{2,20}$/, "a subject code, e.g. BAN, ENG, MATH");
/** Names only: letters (any script), digits, spaces, dot, hyphen; ≤ 60 characters (§9). */
export const NAME_QUERY = z.string().min(1).max(60).regex(/^[\p{L}\p{M}\p{N} .'-]+$/u, "letters, digits and spaces only");
export const limitArg = (def: number, max: number) => z.number().int().min(1).max(max).describe(`rows to return (default ${def}, max ${max})`);

const DAY_MS = 86_400_000;

export function keyToUtc(key: string): number {
  const t = Date.parse(`${key}T00:00:00Z`);
  if (Number.isNaN(t)) throw new ToolInvalid(`Invalid date ${key}`);
  return t;
}

export function addDays(key: string, days: number): string {
  return new Date(keyToUtc(key) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive day count of a range; throws `invalid` when reversed or longer than `maxDays`. */
export function checkRange(from: string, to: string, maxDays: number): number {
  const n = Math.round((keyToUtc(to) - keyToUtc(from)) / DAY_MS) + 1;
  if (n < 1) throw new ToolInvalid(`"from" (${from}) is after "to" (${to}).`);
  if (n > maxDays) throw new ToolInvalid(`The range is ${n} days; at most ${maxDays} days are allowed. Ask for a shorter range.`);
  return n;
}

/** A date no further back than `maxBack` days and not in the future. */
export function checkDay(key: string, today: string, maxBack: number): void {
  if (key > today) throw new ToolInvalid(`${key} is in the future (today is ${today}).`);
  checkRange(key, today, maxBack + 1);
}

export function cap<T>(rows: readonly T[], max: number): { rows: T[]; truncated: boolean; total: number } {
  return { rows: rows.slice(0, max), truncated: rows.length > max, total: rows.length };
}

export async function currentYearIdOrThrow(): Promise<string> {
  const id = await currentAcademicYearId();
  if (!id) throw new ToolInvalid("No current academic year is set in the app.");
  return String(id);
}

export const classLabelBn = (level: number | null | undefined): string | null =>
  level == null ? null : (ROSTER_CLASS_LABELS_BN as Record<number, string>)[level] ?? null;

export interface SectionLabel {
  section_id: string;
  class_id: string;
  class_level: number | null;
  class_label_bn: string | null;
  section_code: string | null;
  section_label_bn: string | null;
}

/** Labels for a set of sections (one query each for Section and Class). */
export async function sectionLabels(ids: readonly string[]): Promise<Map<string, SectionLabel>> {
  const valid = [...new Set(ids.filter((i) => Types.ObjectId.isValid(i)))];
  const out = new Map<string, SectionLabel>();
  if (valid.length === 0) return out;
  const secs = (await Section.find({ _id: { $in: valid } }).select("classId code nameBn").lean()) as Array<{ _id: Types.ObjectId; classId: Types.ObjectId; code?: string; nameBn?: string }>;
  const classes = (await Class.find({ _id: { $in: secs.map((s) => s.classId) } }).select("level").lean()) as Array<{ _id: Types.ObjectId; level?: number }>;
  const lvl = new Map(classes.map((c) => [String(c._id), c.level ?? null]));
  for (const s of secs) {
    const level = lvl.get(String(s.classId)) ?? null;
    out.set(String(s._id), {
      section_id: String(s._id),
      class_id: String(s.classId),
      class_level: level,
      class_label_bn: classLabelBn(level),
      section_code: s.code ?? null,
      section_label_bn: s.nameBn ?? null,
    });
  }
  return out;
}

/** Active sections of the current year, optionally one class level. */
export async function currentSections(classLevel?: number | null): Promise<Array<{ sectionId: string; classId: string }>> {
  const yearId = await currentAcademicYearId();
  const classFilter: Record<string, unknown> = { active: { $ne: false } };
  if (yearId) classFilter.academicYearId = yearId;
  if (classLevel != null) classFilter.level = classLevel;
  const classes = (await Class.find(classFilter).select("_id").lean()) as Array<{ _id: Types.ObjectId }>;
  const secs = (await Section.find({ classId: { $in: classes.map((c) => c._id) }, active: { $ne: false } }).select("classId").lean()) as Array<{ _id: Types.ObjectId; classId: Types.ObjectId }>;
  return secs.map((s) => ({ sectionId: String(s._id), classId: String(s.classId) }));
}

export async function sectionClassId(sectionId: string): Promise<string> {
  const s = (await Section.findById(sectionId).select("classId").lean()) as { classId: Types.ObjectId } | null;
  if (!s) throw new ToolInvalid("Section not found.");
  return String(s.classId);
}

export const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

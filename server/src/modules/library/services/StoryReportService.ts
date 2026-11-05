/**
 * Storybook reports (SB-6, D-#980, docs/prd-storybook-reading.md, W10) — one switch per tab:
 *
 *   reports:storybook_series   per series: books lent, books read (the desk's tick), distinct
 *                              readers, read rate, children waiting now, copies
 *   reports:storybook_books    the same per book + "print a second copy" (≤ 1 copy and ≥ 3
 *                              waiting) + never borrowed
 *   reports:storybook_readers  per child: books read, favourite type (most-read tag), last
 *                              visit, overdue now, "stopped" (read before, nothing for 21 days);
 *                              and reads per series by class and by section (boys / girls)
 *
 * Window: the last 30 / 90 days, or this calendar year (Dhaka). Identity plane — names children
 * (readers tab); no corpus path (ADR-005).
 */
import { ROSTER_CLASS_LABELS_BN, type RosterClassLevel } from "@scd/shared";
import { Student } from "../../foundation/models/Student";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { BookLoan, type IBookLoan } from "../models/BookLoan";
import { BookTitle, type IBookTitle } from "../models/BookTitle";
import { BookCopy } from "../models/BookCopy";
import { BookReservation } from "../models/BookReservation";
import { StorySeries, type IStorySeries } from "../models/StorySeries";
import { StoryTag } from "../models/StoryTag";
import { LibraryError } from "../errors";

export const STORY_REPORT_WINDOWS = ["d30", "d90", "year"] as const;
export type StoryReportWindow = (typeof STORY_REPORT_WINDOWS)[number];
const DAY_MS = 86_400_000;
export const STOPPED_AFTER_DAYS = 21;
export const SECOND_COPY_WAITING = 3;

export function windowStart(w: string, now = new Date()): Date {
  if (w === "d30") return new Date(now.getTime() - 30 * DAY_MS);
  if (w === "d90") return new Date(now.getTime() - 90 * DAY_MS);
  if (w === "year") return new Date(`${dhakaDayKey(now).slice(0, 4)}-01-01T00:00:00+06:00`);
  throw new LibraryError("সময়কাল ঠিক নয়");
}

interface Base {
  titles: IBookTitle[];
  series: IStorySeries[];
  loans: IBookLoan[];
  copies: Map<string, number>;
  waiting: Map<string, number>;
  everLent: Set<string>;
}

async function base(): Promise<Base> {
  const titles = (await BookTitle.find({ seriesId: { $exists: true }, active: true }).lean()) as unknown as IBookTitle[];
  const ids = titles.map((t) => t._id);
  const [series, loans, copyRows, waitRows] = await Promise.all([
    StorySeries.find({}).sort({ sortOrder: 1, nameBn: 1 }).lean() as unknown as Promise<IStorySeries[]>,
    BookLoan.find({ titleId: { $in: ids }, borrowerType: "STUDENT" }).lean() as unknown as Promise<IBookLoan[]>,
    BookCopy.find({ titleId: { $in: ids }, status: { $nin: ["WITHDRAWN", "LOST"] } }).select("titleId").lean(),
    BookReservation.find({ titleId: { $in: ids }, status: { $in: ["QUEUED", "READY"] } }).select("titleId").lean(),
  ]);
  const count = (rows: Array<{ titleId: { toString(): string } }>) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.titleId.toString(), (m.get(r.titleId.toString()) ?? 0) + 1);
    return m;
  };
  return { titles, series, loans, copies: count(copyRows), waiting: count(waitRows), everLent: new Set(loans.map((l) => l.titleId.toString())) };
}

const isRead = (l: IBookLoan, from: Date) => l.status === "RETURNED" && l.readAtReturn === true && !!l.returnedAt && new Date(l.returnedAt) >= from;

export interface StoryStatRow {
  id: string;
  nameBn: string;
  seriesNo: number | null;
  lent: number;
  read: number;
  returned: number;
  readers: number;
  waiting: number;
  copies: number;
  neverBorrowed: boolean;
  secondCopy: boolean;
}

function stat(id: string, nameBn: string, seriesNo: number | null, loans: IBookLoan[], from: Date, waiting: number, copies: number, everLent: boolean): StoryStatRow {
  const inWindow = loans.filter((l) => new Date(l.issuedAt) >= from);
  const returned = loans.filter((l) => l.status === "RETURNED" && !!l.returnedAt && new Date(l.returnedAt) >= from);
  const reads = loans.filter((l) => isRead(l, from));
  return {
    id,
    nameBn,
    seriesNo,
    lent: inWindow.length,
    read: reads.length,
    returned: returned.length,
    readers: new Set(reads.map((l) => l.studentId?.toString())).size,
    waiting,
    copies,
    neverBorrowed: !everLent,
    secondCopy: copies <= 1 && waiting >= SECOND_COPY_WAITING,
  };
}

export async function storySeriesReport(w: string, now = new Date()): Promise<StoryStatRow[]> {
  const from = windowStart(w, now);
  const b = await base();
  return b.series.map((s) => {
    const own = b.titles.filter((t) => t.seriesId?.toString() === s._id.toString());
    const ids = new Set(own.map((t) => t._id.toString()));
    const loans = b.loans.filter((l) => ids.has(l.titleId.toString()));
    const sum = (m: Map<string, number>) => own.reduce((n, t) => n + (m.get(t._id.toString()) ?? 0), 0);
    return stat(s._id.toString(), s.nameBn, null, loans, from, sum(b.waiting), sum(b.copies), own.some((t) => b.everLent.has(t._id.toString())));
  });
}

export async function storyBooksReport(w: string, seriesId?: string | null, now = new Date()): Promise<StoryStatRow[]> {
  const from = windowStart(w, now);
  const b = await base();
  const titles = seriesId ? b.titles.filter((t) => t.seriesId?.toString() === seriesId) : b.titles;
  const seriesName = new Map(b.series.map((s) => [s._id.toString(), s.nameBn]));
  return titles
    .map((t) => {
      const k = t._id.toString();
      const row = stat(k, t.titleBn, t.seriesNo ?? null, b.loans.filter((l) => l.titleId.toString() === k), from, b.waiting.get(k) ?? 0, b.copies.get(k) ?? 0, b.everLent.has(k));
      return { ...row, nameBn: seriesId ? t.titleBn : `${t.titleBn} · ${seriesName.get(t.seriesId!.toString()) ?? ""}` };
    })
    .sort((a, b2) => b2.read - a.read || b2.waiting - a.waiting || a.nameBn.localeCompare(b2.nameBn));
}

export interface StoryReaderRow {
  studentId: string;
  name: string;
  classLabelBn: string;
  sectionNameBn: string;
  read: number;
  favouriteTagBn: string | null;
  lastVisit: Date | null;
  overdue: boolean;
  stopped: boolean;
}

export interface StoryPreferenceCell {
  seriesNameBn: string;
  groupLabelBn: string;
  read: number;
}

export interface StoryReadersReport {
  readers: StoryReaderRow[];
  byClass: StoryPreferenceCell[];
  bySection: StoryPreferenceCell[];
}

export async function storyReadersReport(w: string, now = new Date()): Promise<StoryReadersReport> {
  const from = windowStart(w, now);
  const b = await base();
  const titleById = new Map(b.titles.map((t) => [t._id.toString(), t]));
  const seriesName = new Map(b.series.map((s) => [s._id.toString(), s.nameBn]));
  const studentIds = [...new Set(b.loans.map((l) => l.studentId?.toString()).filter((x): x is string => !!x))];
  const students = await Student.find({ _id: { $in: studentIds } }).select("name nameBn classId sectionId").lean();
  const [classes, sections, tags] = await Promise.all([
    Class.find({ _id: { $in: students.map((s) => s.classId) } }).select("level").lean(),
    Section.find({ _id: { $in: students.map((s) => s.sectionId) } }).select("nameBn").lean(),
    StoryTag.find({}).select("nameBn").lean(),
  ]);
  const levelOf = new Map(classes.map((c) => [c._id.toString(), c.level as number]));
  const secName = new Map(sections.map((s) => [s._id.toString(), s.nameBn as string]));
  const tagName = new Map(tags.map((t) => [t._id.toString(), t.nameBn as string]));
  const classLabel = (lv: number | undefined) => (lv === undefined ? "" : ROSTER_CLASS_LABELS_BN[lv as RosterClassLevel] ?? String(lv));

  const readers: StoryReaderRow[] = [];
  const cls = new Map<string, number>();
  const sec = new Map<string, number>();
  for (const s of students) {
    const mine = b.loans.filter((l) => l.studentId?.toString() === s._id.toString());
    const reads = mine.filter((l) => isRead(l, from));
    const tagCount = new Map<string, number>();
    for (const l of reads) for (const t of titleById.get(l.titleId.toString())?.tagIds ?? []) tagCount.set(t.toString(), (tagCount.get(t.toString()) ?? 0) + 1);
    const fav = [...tagCount.entries()].sort((a, c) => c[1] - a[1])[0]?.[0];
    const visits = mine.flatMap((l) => [new Date(l.issuedAt).getTime(), l.returnedAt ? new Date(l.returnedAt).getTime() : 0]);
    const last = visits.length ? Math.max(...visits) : 0;
    const everRead = mine.some((l) => l.readAtReturn === true);
    const classLabelBn = classLabel(levelOf.get(s.classId.toString()));
    const sectionNameBn = secName.get(s.sectionId.toString()) ?? "";
    readers.push({
      studentId: s._id.toString(),
      name: (s.nameBn || s.name) as string,
      classLabelBn,
      sectionNameBn,
      read: reads.length,
      favouriteTagBn: fav ? tagName.get(fav) ?? null : null,
      lastVisit: last ? new Date(last) : null,
      overdue: mine.some((l) => l.status === "ACTIVE" && new Date(l.dueDate).getTime() < now.getTime()),
      stopped: everRead && now.getTime() - last > STOPPED_AFTER_DAYS * DAY_MS,
    });
    for (const l of reads) {
      const t = titleById.get(l.titleId.toString());
      const sn = t?.seriesId ? seriesName.get(t.seriesId.toString()) ?? "" : "";
      cls.set(`${sn}\u0000${classLabelBn}`, (cls.get(`${sn}\u0000${classLabelBn}`) ?? 0) + 1);
      sec.set(`${sn}\u0000${sectionNameBn}`, (sec.get(`${sn}\u0000${sectionNameBn}`) ?? 0) + 1);
    }
  }
  const cells = (m: Map<string, number>): StoryPreferenceCell[] =>
    [...m.entries()].map(([k, read]) => {
      const [seriesNameBn, groupLabelBn] = k.split("\u0000");
      return { seriesNameBn, groupLabelBn, read };
    }).sort((a, c) => a.seriesNameBn.localeCompare(c.seriesNameBn) || c.read - a.read);
  return {
    readers: readers.sort((a, c) => Number(c.stopped) - Number(a.stopped) || c.read - a.read || a.name.localeCompare(c.name)),
    byClass: cells(cls),
    bySection: cells(sec),
  };
}

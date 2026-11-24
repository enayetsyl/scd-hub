/**
 * The dev calendar of the realistic term (docs/dev-test-scenarios-2027.md section 2): dev-only holiday exceptions, the
 * half-yearly preparation / exam pause windows, the half-yearly Exam dates and an ExamRoutine for every class.
 *
 * It is CONFIG the testers rely on, so it is not removed with an ordinary `--remove`: every row it creates is stamped
 * `devFakeRun: <runId>` AND `devCalendar: true`, and `removeFakeRun` leaves `devCalendar` rows alone unless `--remove-calendar`.
 * Every apply adopts the existing calendar rows (re-stamps them with its own run id) instead of creating twins.
 *
 * The calendar NEVER rewrites a real row: a holiday / pause is created only when no active row overlaps its dates, the real
 * half-yearly exam's own dates are used as they are (dev dates are written only when BOTH are empty, and the exam is marked
 * `devCalendarDates` so the calendar removal clears exactly those), and an exam routine that is not the calendar's own is left alone.
 * Only rows this step created (by id) are stamped: nothing a tester wrote is touched.
 */
import mongoose from "mongoose";
import { ROUTINE_SUBJECTS } from "@scd/shared";
import { HolidayException } from "../../../modules/routine/models/HolidayException";
import { RoutineSlot } from "../../../modules/routine/models/RoutineSlot";
import { AcademicPause } from "../../../modules/academic-pause/models/AcademicPause";
import { createPause } from "../../../modules/academic-pause/services/AcademicPauseService";
import { Exam } from "../../../modules/exams/models/Exam";
import { ExamRoutine } from "../../../modules/exams/models/ExamRoutine";
import { createExam, updateExam } from "../../../modules/exams/services/ExamService";
import { saveExamRoutineClass, publishExamRoutine } from "../../../modules/exams/services/ExamRoutineService";
import type { AppContext } from "../../../context";

export interface DevHoliday {
  fromKey: string;
  toKey: string;
  type: "eid" | "govt" | "special";
  nameBn: string;
}

/** Section 2 of the spec. The dates are test assumptions (the Office edits the real ones). */
export const DEV_HOLIDAYS: DevHoliday[] = [
  { fromKey: "2027-02-21", toKey: "2027-02-21", type: "govt", nameBn: "সরকারি ছুটি (ডেভ ক্যালেন্ডার)" },
  { fromKey: "2027-03-09", toKey: "2027-03-18", type: "eid", nameBn: "ঈদুল ফিতরের ছুটি (ডেভ ক্যালেন্ডার)" },
  { fromKey: "2027-04-14", toKey: "2027-04-14", type: "govt", nameBn: "নববর্ষের ছুটি (ডেভ ক্যালেন্ডার)" },
  { fromKey: "2027-05-16", toKey: "2027-05-20", type: "eid", nameBn: "ঈদুল আযহার ছুটি (ডেভ ক্যালেন্ডার)" },
];

export const DEV_EXAM = { startDateKey: "2027-06-13", endDateKey: "2027-06-24", name: "অর্ধবার্ষিক পরীক্ষা ২০২৭" };

const keyPlus = (key: string, days: number): string => {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const t = new Date(y, m - 1, d + days);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

/** The exam window in force for this run: the dev dates, or the REAL exam's own dates when it already has both. */
const win = { start: DEV_EXAM.startDateKey, end: DEV_EXAM.endDateKey };
export function setExamWindow(start: string, end: string): void {
  win.start = start;
  win.end = end;
}

/** Is `dayKey` inside the half-yearly exam window (an exam day: no teaching, AL-11)? */
export const isExamDay = (dayKey: string): boolean => dayKey >= win.start && dayKey <= win.end;
/** The preparation week: the Sunday-Thursday before the exam window (homework optional, no weekly assignment, no class test). */
export const isPrepDay = (dayKey: string): boolean => dayKey >= keyPlus(win.start, -7) && dayKey <= keyPlus(win.start, -3);

/** The pause windows of the calendar for the window in force. */
export const devPauses = (): Array<{ fromKey: string; toKey: string; label: string; pauses: string[] }> => [
  { fromKey: keyPlus(win.start, -7), toKey: keyPlus(win.start, -3), label: "অর্ধবার্ষিক পরীক্ষার প্রস্তুতি (ডেভ)", pauses: ["ASSIGNMENT_GENERATION", "ASSIGNMENT_CHASE", "HOMEWORK_REQUIRED"] },
  { fromKey: win.start, toKey: win.end, label: "অর্ধবার্ষিক পরীক্ষা (ডেভ)", pauses: ["ASSIGNMENT_GENERATION", "ASSIGNMENT_CHASE", "HOMEWORK_REQUIRED", "CLASS_NOTE_CHASE"] },
];

/** Up to ten Sunday-Thursday days inside the window. */
function examDays(): string[] {
  const out: string[] = [];
  for (let k = win.start; k <= win.end && out.length < 10; k = keyPlus(k, 1)) {
    const [y, m, d] = k.split("-").map(Number) as [number, number, number];
    if (new Date(y, m - 1, d).getDay() <= 4) out.push(k);
  }
  return out;
}

export interface CalendarResult {
  holidaysCreated: number;
  holidaysExisting: number;
  pausesCreated: number;
  pausesExisting: number;
  examId: string | null;
  /** The dev dates were written onto an EXISTING exam that had both dates empty (cleared again by `--remove-calendar`). */
  examDatesSet: boolean;
  /** The exam row itself was created by the calendar. */
  examCreated: boolean;
  examRoutineClasses: number;
  /** A routine that is not the calendar's own exists: nothing was created or published over it. */
  routineLeftAlone: boolean;
  adopted: number;
  notes: string[];
}

const CALENDAR_MODELS = ["HolidayException", "AcademicPause", "Exam", "ExamRoutine"];

/** Every earlier calendar row passes to this run's id (a plain `--remove` or a legacy run left them under an older one). Runs on EVERY apply. */
export async function adoptCalendar(runId: string): Promise<number> {
  let n = 0;
  for (const model of CALENDAR_MODELS) {
    const r = await mongoose.model(model).collection.updateMany({ devCalendar: true, devFakeRun: { $ne: runId } }, { $set: { devFakeRun: runId } });
    n += r.modifiedCount;
  }
  return n;
}

/** `--remove-calendar`: drop every calendar row (whatever run id it carries) and clear the dates the calendar wrote onto a real exam. */
export async function removeCalendarRows(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const model of CALENDAR_MODELS) {
    const c = mongoose.model(model).collection;
    out[c.collectionName] = (await c.deleteMany({ devCalendar: true })).deletedCount;
  }
  await mongoose.model("Exam").collection.updateMany({ devCalendarDates: true }, { $set: { startDateKey: null, endDateKey: null }, $unset: { devCalendarDates: "" } });
  return out;
}

const localDay = (key: string, end = false): Date => {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return end ? new Date(y, m - 1, d, 23, 59, 0) : new Date(y, m - 1, d);
};

/** Seed the calendar. `classes` are the run's classes (level + id); `actorId` signs the writes (a PRINCIPAL-role context). */
export async function seedDevCalendar(args: {
  runId: string;
  academicYearId: string;
  classes: Array<{ classId: string; level: number }>;
  actorId: string;
  log: (line: string) => void;
}): Promise<CalendarResult> {
  const { runId, academicYearId, classes, actorId, log } = args;
  const res: CalendarResult = { holidaysCreated: 0, holidaysExisting: 0, pausesCreated: 0, pausesExisting: 0, examId: null, examDatesSet: false, examCreated: false, examRoutineClasses: 0, routineLeftAlone: false, adopted: 0, notes: [] };
  const ctx = { auth: { userId: actorId, role: "PRINCIPAL" } } as unknown as AppContext;
  const created: Record<string, unknown[]> = { HolidayException: [], AcademicPause: [], Exam: [], ExamRoutine: [] };
  res.adopted = await adoptCalendar(runId);

  for (const h of DEV_HOLIDAYS) {
    // overlap, not equality: a real holiday that covers any of these days means the day is already closed
    const overlap = await HolidayException.exists({ active: true, fromDate: { $lte: localDay(h.toKey, true) }, toDate: { $gte: localDay(h.fromKey) } });
    if (overlap) {
      res.holidaysExisting++;
      continue;
    }
    const row = await HolidayException.create({ fromDate: localDay(h.fromKey), toDate: localDay(h.toKey, true), type: h.type, nameBn: h.nameBn, note: "dev calendar (fake 2027 run)" });
    created.HolidayException!.push(row._id);
    res.holidaysCreated++;
  }

  // The half-yearly exam: its own dates win. Missing -> created; both dates empty -> dev dates written (marked); else untouched.
  let exam = await Exam.findOne({ academicYearId, term: "HALF_YEARLY" }).lean();
  if (!exam) {
    try {
      const row = await createExam(ctx, { academicYearId, term: "HALF_YEARLY", name: DEV_EXAM.name, startDateKey: DEV_EXAM.startDateKey, endDateKey: DEV_EXAM.endDateKey });
      created.Exam!.push(row._id);
      res.examCreated = true;
      exam = await Exam.findById(row._id).lean();
    } catch (e) {
      res.notes.push(`exam not created: ${String((e as Error)?.message ?? e)}`);
    }
  } else if (!exam.startDateKey && !exam.endDateKey) {
    try {
      await updateExam(ctx, { id: String(exam._id), startDateKey: DEV_EXAM.startDateKey, endDateKey: DEV_EXAM.endDateKey });
      await Exam.collection.updateOne({ _id: exam._id }, { $set: { devCalendarDates: true } });
      res.examDatesSet = true;
      exam = await Exam.findById(exam._id).lean();
    } catch (e) {
      res.notes.push(`exam dates not set: ${String((e as Error)?.message ?? e)}`);
    }
  }
  if (exam?.startDateKey && exam.endDateKey) setExamWindow(exam.startDateKey, exam.endDateKey);
  else if (exam) res.notes.push("the exam has only one date: it is left as it is and the dev window is used for the run's own pause / exam-day rules");

  for (const p of devPauses()) {
    const overlap = await AcademicPause.exists({ active: true, fromKey: { $lte: p.toKey }, toKey: { $gte: p.fromKey } });
    if (overlap) {
      res.pausesExisting++;
      continue;
    }
    const row = await createPause(p, actorId);
    created.AcademicPause!.push(row._id);
    res.pausesCreated++;
  }

  if (exam) {
    res.examId = String(exam._id);
    const existing = await ExamRoutine.findOne({ examId: exam._id }).lean();
    const own = existing && (existing as unknown as { devCalendar?: boolean }).devCalendar === true;
    if (existing && !own) {
      res.routineLeftAlone = true; // a real routine: nothing is created, saved or published over it
      res.notes.push("an exam routine that is not the calendar's own exists: left alone");
    } else if (!existing) {
      // One written paper a day over the exam days, the class's own subjects. Saved UNPUBLISHED first (no "published routine
      // changed" mistake is recorded for a first save), published once at the end.
      const known = new Set<string>(ROUTINE_SUBJECTS as readonly string[]);
      const days = examDays();
      for (const c of classes) {
        const subjects = (await RoutineSlot.distinct("subject", { classId: c.classId, groupType: "section", active: true }))
          .filter((s: string) => known.has(s) && s !== "QURAN")
          .sort();
        if (subjects.length === 0) continue;
        const slots = days.slice(0, subjects.length).map((dateKey, i) => ({ dateKey, subject: subjects[i] as string, kind: "WRITTEN", start: "09:30", end: "11:30", note: "" }));
        try {
          await saveExamRoutineClass(ctx, String(exam._id), c.classId, slots, "ডেভ ক্যালেন্ডার — পরীক্ষার রুটিন");
          res.examRoutineClasses++;
        } catch (e) {
          res.notes.push(`routine of level ${c.level} not saved: ${String((e as Error)?.message ?? e)}`);
        }
      }
      const row = await ExamRoutine.findOne({ examId: exam._id }).select("_id").lean();
      if (row) {
        created.ExamRoutine!.push(row._id);
        try {
          await publishExamRoutine(ctx, String(exam._id), true);
        } catch (e) {
          res.notes.push(`routine not published: ${String((e as Error)?.message ?? e)}`);
        }
      }
    }
  }

  // stamp exactly the rows this step created (by id: nothing a tester wrote is touched)
  for (const model of CALENDAR_MODELS) {
    const ids = created[model] ?? [];
    if (ids.length === 0) continue;
    await mongoose.model(model).collection.updateMany({ _id: { $in: ids as never[] } }, { $set: { devFakeRun: runId, devCalendar: true } });
  }
  log(`[dev-fake] calendar: ${JSON.stringify(res)}`);
  return res;
}

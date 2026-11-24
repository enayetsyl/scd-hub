/**
 * The dev calendar of the realistic term (docs/dev-test-scenarios-2027.md section 2): dev-only holiday exceptions, the
 * half-yearly preparation / exam pause windows, the half-yearly Exam dates and an ExamRoutine for every class.
 *
 * It is CONFIG the testers rely on, so it is not removed with an ordinary `--remove`: every row it creates is stamped
 * `devFakeRun: <runId>` AND `devCalendar: true`, and `removeFakeRun` leaves `devCalendar` rows alone unless `--remove-calendar`.
 * A later run adopts the existing calendar rows (re-stamps them with its own run id) instead of creating twins. Rows that
 * already exist on the dev DB for the same day / window (real ones copied from prod) are never touched.
 */
import mongoose from "mongoose";
import { ROUTINE_SUBJECTS } from "@scd/shared";
import { HolidayException } from "../../../modules/routine/models/HolidayException";
import { RoutineSlot } from "../../../modules/routine/models/RoutineSlot";
import { AcademicPause } from "../../../modules/academic-pause/models/AcademicPause";
import { createPause } from "../../../modules/academic-pause/services/AcademicPauseService";
import { Exam } from "../../../modules/exams/models/Exam";
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

export const DEV_PAUSES = [
  { fromKey: "2027-06-06", toKey: "2027-06-10", label: "অর্ধবার্ষিক পরীক্ষার প্রস্তুতি (ডেভ)", pauses: ["ASSIGNMENT_GENERATION", "ASSIGNMENT_CHASE", "HOMEWORK_REQUIRED"] },
  { fromKey: "2027-06-13", toKey: "2027-06-24", label: "অর্ধবার্ষিক পরীক্ষা (ডেভ)", pauses: ["ASSIGNMENT_GENERATION", "ASSIGNMENT_CHASE", "HOMEWORK_REQUIRED", "CLASS_NOTE_CHASE"] },
];

export const DEV_EXAM = { startDateKey: "2027-06-13", endDateKey: "2027-06-24", name: "অর্ধবার্ষিক পরীক্ষা ২০২৭" };
/** The ten exam days (Sun-Thu of 13-17 and 20-24 June), one written paper a day per class. */
export const DEV_EXAM_DAYS = ["2027-06-13", "2027-06-14", "2027-06-15", "2027-06-16", "2027-06-17", "2027-06-20", "2027-06-21", "2027-06-22", "2027-06-23", "2027-06-24"];

/** Is `dayKey` inside the half-yearly exam window (an exam day: no teaching, AL-11)? */
export const isExamDay = (dayKey: string): boolean => dayKey >= DEV_EXAM.startDateKey && dayKey <= DEV_EXAM.endDateKey;
/** The preparation week (homework optional, no weekly assignment). */
export const isPrepDay = (dayKey: string): boolean => dayKey >= "2027-06-06" && dayKey <= "2027-06-10";

export interface CalendarResult {
  holidaysCreated: number;
  holidaysExisting: number;
  pausesCreated: number;
  pausesExisting: number;
  examId: string | null;
  examDatesSet: boolean;
  examRoutineClasses: number;
  adopted: number;
  notes: string[];
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
  const started = new Date();
  const res: CalendarResult = { holidaysCreated: 0, holidaysExisting: 0, pausesCreated: 0, pausesExisting: 0, examId: null, examDatesSet: false, examRoutineClasses: 0, adopted: 0, notes: [] };
  const ctx = { auth: { userId: actorId, role: "PRINCIPAL" } } as unknown as AppContext;

  // earlier runs' calendar rows pass to this run (they were kept by a plain `--remove`)
  for (const model of ["HolidayException", "AcademicPause", "Exam", "ExamRoutine"]) {
    const r = await mongoose.model(model).collection.updateMany({ devCalendar: true }, { $set: { devFakeRun: runId } });
    res.adopted += r.modifiedCount;
  }

  for (const h of DEV_HOLIDAYS) {
    const exists = await HolidayException.exists({ fromDate: localDay(h.fromKey), active: true });
    if (exists) {
      res.holidaysExisting++;
      continue;
    }
    await HolidayException.create({ fromDate: localDay(h.fromKey), toDate: localDay(h.toKey, true), type: h.type, nameBn: h.nameBn, note: "dev calendar (fake 2027 run)" });
    res.holidaysCreated++;
  }

  for (const p of DEV_PAUSES) {
    const exists = await AcademicPause.exists({ fromKey: p.fromKey, toKey: p.toKey, active: true });
    if (exists) {
      res.pausesExisting++;
      continue;
    }
    await createPause(p, actorId);
    res.pausesCreated++;
  }

  // The half-yearly exam: the year-change Prepare made it; set its dates when empty (never overwrite real ones).
  let exam: { _id: unknown; startDateKey?: string | null; endDateKey?: string | null } | null = await Exam.findOne({ academicYearId, term: "HALF_YEARLY" });
  if (!exam) {
    try {
      exam = await createExam(ctx, { academicYearId, term: "HALF_YEARLY", name: DEV_EXAM.name, startDateKey: DEV_EXAM.startDateKey, endDateKey: DEV_EXAM.endDateKey });
      res.examDatesSet = true;
    } catch (e) {
      res.notes.push(`exam not created: ${String((e as Error)?.message ?? e)}`);
    }
  } else if (!exam.startDateKey || !exam.endDateKey) {
    try {
      await updateExam(ctx, { id: String(exam._id), startDateKey: DEV_EXAM.startDateKey, endDateKey: DEV_EXAM.endDateKey });
      res.examDatesSet = true;
    } catch (e) {
      res.notes.push(`exam dates not set: ${String((e as Error)?.message ?? e)}`);
    }
  }
  if (exam) {
    res.examId = String(exam._id);
    // An ExamRoutine for each class: one written paper a day over the ten exam days, the class's own subjects.
    const known = new Set<string>(ROUTINE_SUBJECTS as readonly string[]);
    for (const c of classes) {
      const subjects = (await RoutineSlot.distinct("subject", { classId: c.classId, groupType: "section", active: true }))
        .filter((s: string) => known.has(s) && s !== "QURAN")
        .sort();
      if (subjects.length === 0) continue;
      const slots = DEV_EXAM_DAYS.slice(0, subjects.length).map((dateKey, i) => ({ dateKey, subject: subjects[i] as string, kind: "WRITTEN", start: "09:30", end: "11:30", note: "" }));
      try {
        await saveExamRoutineClass(ctx, String(exam._id), c.classId, slots, "ডেভ ক্যালেন্ডার — পরীক্ষার রুটিন");
        res.examRoutineClasses++;
      } catch (e) {
        res.notes.push(`routine of level ${c.level} not saved: ${String((e as Error)?.message ?? e)}`);
      }
    }
    if (res.examRoutineClasses > 0) {
      try {
        await publishExamRoutine(ctx, String(exam._id), true);
      } catch (e) {
        res.notes.push(`routine not published: ${String((e as Error)?.message ?? e)}`);
      }
    }
  }

  // stamp what this step created
  for (const model of ["HolidayException", "AcademicPause", "Exam", "ExamRoutine"]) {
    const c = mongoose.model(model).collection;
    await c.updateMany({ createdAt: { $gte: started }, devFakeRun: { $exists: false } }, { $set: { devFakeRun: runId, devCalendar: true } });
  }
  log(`[dev-fake] calendar: ${JSON.stringify(res)}`);
  return res;
}

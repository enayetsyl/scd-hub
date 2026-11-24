/**
 * The shared state of one realistic-term run (scenario 9): the run context, the persona maps, the counters and rate tallies, the
 * per-day routine cache and the bank stock cache. One `Sim` object is passed to every daily step and every guaranteed event.
 */
import type { MasterySubject } from "@scd/shared";
import { Types } from "mongoose";
import { isTaggedRow } from "../../../modules/mastery/rollup";
import { lockedOutcomes } from "../../../modules/mastery/services/MasteryDiagnosisService";
import { goldBank, marksTable } from "../../../modules/mastery/services/MasteryAssignmentService";
import { classTokenForLevel, type Auth } from "../../../modules/mastery/services/MasteryWorkService";
import { slotsForDate } from "../../../modules/routine/services/RoutineSlotService";
import { parseDateKey } from "../../../modules/attendance/dates";
import type { ScenarioCtx, SectionInfo } from "../scenarios/types";
import type { ChildPersona, TeacherPersona } from "./personas";

export interface DaySlot {
  slotId: string;
  subject: string;
  teacherId: string;
  periodNumber: number;
}

export interface ChildStat {
  attDays: number;
  absDays: number;
  hwN: number;
  hwMiss: number;
  asN: number;
  asMiss: number;
}

export interface LevelTally {
  attDays: number;
  absDays: number;
  ctPresent: number;
  ctChildDays: number;
  ctEarned: number;
  ctAvailable: number;
  hwN: number;
  hwMiss: number;
  asN: number;
  asMiss: number;
}

export interface PlannedLeave {
  teacherId: string;
  staffProfileId: string | null;
  fromKey: string;
  toKey: string;
  leaveType: "casual" | "sick" | "unpaid_lwp";
  dayPart?: "full";
  /** Set once applied. */
  applicationId?: string;
  /** The guaranteed one (5-day sick in March). */
  guaranteed?: boolean;
}

export interface EventRecord {
  id: string;
  title: string;
  /** The day it was placed (or tried). */
  day: string;
  status: "placed" | "partly" | "not placed";
  produced: string;
  /** Dev roster names the tester can open (1-3). */
  names: string[];
  lookAt: string;
}

export interface StockEntry {
  outcomes: Awaited<ReturnType<typeof lockedOutcomes>>;
  bank: Awaited<ReturnType<typeof goldBank>>;
  marks: Awaited<ReturnType<typeof marksTable>>;
}

export class Sim {
  readonly c: Record<string, number> = {};
  readonly childPersona = new Map<string, ChildPersona>();
  readonly teacherPersona = new Map<string, TeacherPersona>();
  readonly childStat = new Map<string, ChildStat>();
  /** studentId -> sectionId, for the children on the roster at the start. */
  readonly childSection = new Map<string, string>();
  readonly level = new Map<string, number>(); // sectionId -> level
  readonly tally = new Map<number, LevelTally>();
  readonly events: EventRecord[] = [];
  /** studentId -> [firstKey, lastKey] of a long absence (C4). */
  readonly streaks = new Map<string, [string, string]>();
  /** `${slotId}|${dayKey}` -> cover teacher id (an approved cover for a teacher on leave). */
  readonly coverOf = new Map<string, string>();
  readonly leaveDays = new Map<string, number>(); // teacherId -> leave days taken
  readonly onLeave = new Map<string, Set<string>>(); // teacherId -> day keys
  leaves: PlannedLeave[] = [];
  /** School days of the run that are teaching days (open, not exam days), in order. */
  teachDays: string[] = [];
  /** All open school days (incl. exam days). */
  openDays: string[] = [];
  readonly principal: Auth = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" } as unknown as Auth;
  /** Today's routine, per section (loaded once a day). */
  private dayCache = new Map<string, DaySlot[]>();
  private dayCacheKey = "";
  private stockCache = new Map<string, StockEntry | null>();
  /** Stage id -> the child of an outside-help case (the recurring child is the first one again). */
  readonly outsideHelpChild = new Map<string, string>();
  readonly stageTries = new Map<string, number>();
  /** `${sectionId}|${subject}` -> the cell teacher (the teacher of its first routine period). */
  readonly cellTeacher = new Map<string, string>();
  /** `${sectionId}|${subject}` -> the weekdays (0 = Sun .. 4 = Thu) the section has the subject. */
  readonly subjectDays = new Map<string, Set<number>>();
  /** Class-test plan: `${sectionId}|${dayKey}` -> subject. */
  readonly ctPlan = new Map<string, string>();
  /** Days that are test days for a section (lifts that day's absence to the class-test-day rate). */
  readonly reasons = new Map<string, number>();

  constructor(
    readonly ctx: ScenarioCtx,
    readonly sections: SectionInfo[],
  ) {
    for (const s of sections) this.level.set(s.sectionId, s.level);
  }

  tries(stageId: string): number {
    return this.stageTries.get(stageId) ?? 0;
  }

  bump(key: string, n = 1): void {
    this.c[key] = (this.c[key] ?? 0) + n;
  }

  /** Run a step; a throw is counted and logged by reason, never fatal (a 30-minute run must not die on one refused call). */
  async safe<T>(tag: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      this.bump(`${tag}Refused`);
      this.ctx.refuse(`${tag}Refused`, e);
      return null;
    }
  }

  statOf(studentId: string): ChildStat {
    let s = this.childStat.get(studentId);
    if (!s) {
      s = { attDays: 0, absDays: 0, hwN: 0, hwMiss: 0, asN: 0, asMiss: 0 };
      this.childStat.set(studentId, s);
    }
    return s;
  }

  tallyOf(level: number): LevelTally {
    let t = this.tally.get(level);
    if (!t) {
      t = { attDays: 0, absDays: 0, ctPresent: 0, ctChildDays: 0, ctEarned: 0, ctAvailable: 0, hwN: 0, hwMiss: 0, asN: 0, asMiss: 0 };
      this.tally.set(level, t);
    }
    return t;
  }

  /** The routine of every section on `dayKey` (non-break periods with a teacher), cached for the day. */
  async slotsOn(dayKey: string, sectionId: string): Promise<DaySlot[]> {
    if (this.dayCacheKey !== dayKey) {
      this.dayCache = new Map();
      this.dayCacheKey = dayKey;
    }
    const hit = this.dayCache.get(sectionId);
    if (hit) return hit;
    const rows = (await slotsForDate("section", sectionId, parseDateKey(dayKey))).filter((s) => !s.isBreak && s.teacherId);
    const out = rows.map((s) => ({ slotId: String(s._id), subject: s.subject as string, teacherId: this.effectiveTeacher(String(s._id), dayKey, String(s.teacherId)), periodNumber: s.periodNumber }));
    this.dayCache.set(sectionId, out);
    return out;
  }

  /** The teacher who actually takes the period: the approved cover on a leave day, else the routine teacher. "" = nobody. */
  effectiveTeacher(slotId: string, dayKey: string, routineTeacher: string): string {
    if (!this.onLeave.get(routineTeacher)?.has(dayKey)) return routineTeacher;
    return this.coverOf.get(`${slotId}|${dayKey}`) ?? "";
  }

  /** The first teacher of `subject` in `slots` (the cell teacher), or null. */
  teacherOfSubject(slots: DaySlot[], subject: string): string | null {
    return slots.find((s) => s.subject === subject && s.teacherId)?.teacherId ?? null;
  }

  authOf(userId: string): Auth {
    return { userId, role: "TEACHER" } as unknown as Auth;
  }

  /** Bank stock of one class x subject (cached for the run); null when the class or the subject has no locked tree. */
  async stock(level: number, subject: string): Promise<StockEntry | null> {
    const key = `${level}|${subject}`;
    if (this.stockCache.has(key)) return this.stockCache.get(key) ?? null;
    let entry: StockEntry | null = null;
    const token = classTokenForLevel(level);
    if (token) {
      const outcomes = (await lockedOutcomes(token, subject as MasterySubject)).filter((o) => o.assess === "QUESTION" && isTaggedRow(o));
      if (outcomes.length > 0) {
        const bank = await goldBank(outcomes.map((o) => o.code));
        const marks = await marksTable(token, subject as MasterySubject);
        if (bank.length > 0) entry = { outcomes, bank, marks };
      }
    }
    this.stockCache.set(key, entry);
    return entry;
  }

  termFraction(dayKey: string): number {
    const i = this.teachDays.indexOf(dayKey);
    return this.teachDays.length > 1 ? Math.max(0, i) / (this.teachDays.length - 1) : 0;
  }

  /** Index of `dayKey` in the open school days (for "N school days later"). */
  idxOf(dayKey: string): number {
    return this.openDays.indexOf(dayKey);
  }

  /** The open school day `n` days after `dayKey` (clamped to the last one). */
  addSchoolDays(dayKey: string, n: number): string {
    const i = this.openDays.indexOf(dayKey);
    return this.openDays[Math.min(this.openDays.length - 1, Math.max(0, i) + n)] as string;
  }
}

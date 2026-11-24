/**
 * Teacher leave of the realistic term (T4): planned from the teacher personas (the 2026 spread: 161 applications, casual 73 %,
 * sick 20 %, unpaid 5 %, mostly one day), applied and approved THROUGH the leave service on the first leave day, and every missed
 * period given an approved cover THROUGH the cover service (a RoutineSubstitution + proxy grant). One guaranteed 5-day sick leave in
 * March. While a teacher is on leave the sim treats her periods as taken by the cover (or by nobody when none was free).
 */
import { StaffCoverSlot } from "../../../modules/hr/models/StaffCoverSlot";
import { applyForLeave, decideLeave } from "../../../modules/hr/services/StaffLeaveService";
import { decideCoverSlot } from "../../../modules/hr/services/CoverService";
import { resolveStaffProfileForUser } from "../../../modules/hr/services/staffMatch";
import { teacherAvailability } from "../../../modules/routine/services/RoutineCoverService";
import { parseDateKey } from "../../../modules/attendance/dates";
import { between, TEACHER_PERSONAS, type TeacherPersona } from "./personas";
import type { PlannedLeave, Sim } from "./state";

export const GUARANTEED_LEAVE_FROM = "2027-03-21"; // Sun
export const GUARANTEED_LEAVE_TO = "2027-03-25"; // Thu

/** Plan every teacher's leaves over the open school days (pure draw from the seeded rng; nothing is written). */
export function planLeaves(sim: Sim): PlannedLeave[] {
  const rng = sim.ctx.rng;
  const days = sim.openDays;
  const plan: PlannedLeave[] = [];
  const taken = new Map<string, Set<string>>();
  const mark = (teacherId: string, from: number, len: number): boolean => {
    const set = taken.get(teacherId) ?? new Set<string>();
    for (let i = 0; i < len; i++) if (set.has(days[from + i] ?? "")) return false;
    for (let i = 0; i < len; i++) set.add(days[from + i] ?? "");
    taken.set(teacherId, set);
    return true;
  };
  // the guaranteed 5-day sick leave: the first leave-prone teacher (T4), else the first teacher
  const teachers = [...sim.teacherPersona.keys()].sort();
  const t4 = teachers.find((t) => sim.teacherPersona.get(t) === "T4") ?? teachers[0];
  const g0 = days.indexOf(GUARANTEED_LEAVE_FROM);
  if (t4 && g0 >= 0 && days[g0 + 4] === GUARANTEED_LEAVE_TO && mark(t4, g0, 5)) {
    plan.push({ teacherId: t4, staffProfileId: null, fromKey: GUARANTEED_LEAVE_FROM, toKey: GUARANTEED_LEAVE_TO, leaveType: "sick", guaranteed: true });
  }
  for (const teacherId of teachers) {
    const persona = sim.teacherPersona.get(teacherId) as TeacherPersona;
    const spec = TEACHER_PERSONAS[persona];
    // events of 1 day (75 %), 2 (15 %) or 3 (10 %): about leaveDays / 1.4 of them
    const n = Math.max(0, Math.round(spec.leaveDays / 1.4 + (rng() - 0.5) * 2));
    for (let e = 0; e < n; e++) {
      const r = rng();
      const len = r < 0.75 ? 1 : r < 0.9 ? 2 : 3;
      const start = between(rng, 3, Math.max(3, days.length - 4)); // not the first days; never the last
      const t = rng();
      if (!days[start + len - 1] || !mark(teacherId, start, len)) continue;
      plan.push({ teacherId, staffProfileId: null, fromKey: days[start] as string, toKey: days[start + len - 1] as string, leaveType: t < 0.73 ? "casual" : t < 0.93 ? "sick" : "unpaid_lwp" });
    }
  }
  return plan.sort((a, b) => a.fromKey.localeCompare(b.fromKey) || a.teacherId.localeCompare(b.teacherId));
}

/** Apply + approve the leaves that start today and give each of their periods an approved cover. */
export async function leavesStartingOn(sim: Sim, dayKey: string): Promise<void> {
  for (const l of sim.leaves.filter((x) => x.fromKey === dayKey && !x.applicationId)) {
    const staff = await resolveStaffProfileForUser(l.teacherId);
    if (!staff) {
      sim.bump("leaveNoStaffProfile");
      continue;
    }
    const app = await sim.safe("leaveApply", () =>
      applyForLeave({ staffProfileId: String(staff._id), leaveType: l.leaveType, fromKey: l.fromKey, toKey: l.toKey, reason: "ফেক ছুটি (ডেভ ডেটা)", actorId: l.teacherId }),
    );
    if (!app) continue;
    l.applicationId = String(app._id);
    const decided = await sim.safe("leaveDecide", () => decideLeave(String(app._id), "approve", sim.principal.userId));
    if (!decided) continue;
    sim.bump("leaveApproved");
    const days = sim.openDays.filter((d) => d >= l.fromKey && d <= l.toKey);
    sim.onLeave.set(l.teacherId, new Set([...(sim.onLeave.get(l.teacherId) ?? []), ...days]));
    sim.leaveDays.set(l.teacherId, (sim.leaveDays.get(l.teacherId) ?? 0) + days.length);
    sim.bump("leaveDays", days.length);
    const slots = await StaffCoverSlot.find({ leaveApplicationId: app._id }).select("_id routineSlotId dateKey periodNumber").lean();
    for (const s of slots) {
      const free = (await teacherAvailability(parseDateKey(s.dateKey), s.periodNumber)).find((r) => r.free && r.teacherId !== l.teacherId && !sim.onLeave.get(r.teacherId)?.has(s.dateKey));
      if (!free) {
        sim.bump("coverNone");
        continue;
      }
      const done = await sim.safe("cover", () => decideCoverSlot(String(s._id), true, sim.principal.userId, free.teacherId));
      if (done) {
        sim.coverOf.set(`${String(s.routineSlotId)}|${s.dateKey}`, free.teacherId);
        sim.bump("coversAssigned");
      }
    }
  }
}

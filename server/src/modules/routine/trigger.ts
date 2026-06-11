/**
 * Routine trigger schedule — pure (R5.1, D-#52). The routine OWNS the schedule of
 * trigger points; delivery (push) rides the deferred messaging pipeline. The bell
 * schedule is each period's end time + who rings it (the per-period override, else
 * the whole-day bell-duty admin).
 */
export interface BellTrigger {
  periodNumber: number;
  endHHMM: string;
  isBreak: boolean;
  bellAdminId: string | null;
}

export function buildBellSchedule(
  periods: { number: number; isBreak: boolean; endHHMM: string }[],
  wholeDayAdminId: string | null,
  perPeriodAdmin: Record<number, string>,
): BellTrigger[] {
  return [...periods]
    .sort((a, b) => a.number - b.number)
    .map((p) => ({
      periodNumber: p.number,
      endHHMM: p.endHHMM,
      isBreak: p.isBreak,
      bellAdminId: perPeriodAdmin[p.number] ?? wholeDayAdminId ?? null,
    }));
}

/**
 * Local-calendar date keys (D-#304). `toISOString()` is UTC — in Bangladesh
 * (UTC+6) it returns YESTERDAY between midnight and 06:00 local, so any
 * "today" default built from it dated early-morning work a day back
 * (owner-reported on the Homework screen). Every client-side "today" /
 * date-key must go through this local formatter — the server-side mirror is
 * `modules/attendance/dates.dateKeyOf`.
 */
export const dateKey = (d: Date = new Date()): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

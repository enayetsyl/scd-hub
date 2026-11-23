/**
 * AL-6b (PRD §4.4): the counted time of a weekly assignment, as the server counts it at finalise —
 * (Part A marks + the MEDIAN child's own-part marks) × minutesPerMark. Pure, so the send screen can show it BEFORE sending.
 */
export function medianOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function countedMinutesOf(partAMarks: number, childPartBMarks: number[], minutesPerMark: number): number {
  return Math.round((partAMarks + medianOf(childPartBMarks)) * minutesPerMark);
}

/** The day label in the active language: the server sends both; fall back to the Bangla one. */
export function pickDayLabel(bnLabel: string | null | undefined, enLabel: string | null | undefined, lang: string): string | null {
  return (lang === "en" ? enLabel || bnLabel : bnLabel) ?? null;
}

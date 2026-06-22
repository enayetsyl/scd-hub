/**
 * groupByDate — group a flat list of items into date-wise buckets, newest date first.
 *
 * Used by the tracker "pending work" screens (Checking queue, records, etc.) to show
 * outstanding items grouped into per-date cards instead of forcing a manual date pick.
 * Pure (no clock / no I/O) so it's unit-tested directly; the human date-header label
 * lives in labels.ts (`dateHeaderLabel`) because it is language-aware.
 */
export interface DateGroup<T> {
  /** "YYYY-MM-DD" */
  dateKey: string;
  items: T[];
}

/**
 * Bucket `items` by the date returned from `getDate` (any ISO/`YYYY-MM-DD…` string —
 * only the first 10 chars are used as the key), preserving each bucket's input order.
 * Groups are returned newest-date-first.
 */
export function groupByDate<T>(items: readonly T[], getDate: (item: T) => string): DateGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const dateKey = (getDate(item) ?? "").slice(0, 10);
    const arr = buckets.get(dateKey);
    if (arr) arr.push(item);
    else buckets.set(dateKey, [item]);
  }
  return [...buckets.entries()]
    .map(([dateKey, groupItems]) => ({ dateKey, items: groupItems }))
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0));
}

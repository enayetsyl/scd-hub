/**
 * Sidebar arrangement (D-#920) — pure helpers behind DrawerContent's own order.
 *
 *   manual  sections in the person's saved order; a section they have never placed (a new
 *           feature, a newly granted tab) keeps its default spot relative to the others
 *           at the END, so nothing they arranged moves under them
 *   auto    sections by how often their items were opened (most first), and each group's
 *           items the same way; ties keep the default order
 *
 * Favourites (আমার পছন্দ) are the same in both modes: the pinned items, in pinned order.
 */

export type NavMode = "manual" | "auto";

export interface NavPrefs {
  mode: NavMode;
  order: string[];
  pinned: string[];
  usage: Record<string, number>;
}

export const DEFAULT_NAV_PREFS: NavPrefs = { mode: "manual", order: [], pinned: [], usage: {} };

/** Stable sort: equal ranks keep their incoming order. */
function stableSort<T>(items: T[], rank: (t: T) => number): T[] {
  return items
    .map((item, i) => ({ item, i, r: rank(item) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item);
}

/** Saved order first; anything never placed follows in its default order. */
export function orderByKeys<T>(items: T[], keyOf: (t: T) => string, order: string[]): T[] {
  const pos = new Map(order.map((k, i) => [k, i]));
  return stableSort(items, (t) => pos.get(keyOf(t)) ?? order.length);
}

/** Most-used first; never-used keep their default order at the end. */
export function orderByUse<T>(items: T[], useOf: (t: T) => number): T[] {
  return stableSort(items, (t) => -useOf(t));
}

/** Move the entry at `index` one step (`delta` −1 = up, +1 = down); out of range = no change. */
export function moveKey(keys: string[], index: number, delta: -1 | 1): string[] {
  const to = index + delta;
  if (index < 0 || index >= keys.length || to < 0 || to >= keys.length) return keys;
  const next = keys.slice();
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export function togglePinned(pinned: string[], key: string): string[] {
  return pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key];
}

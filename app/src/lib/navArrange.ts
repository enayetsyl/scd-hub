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

/**
 * A section that took over from older sections (D-#1652: the পরীক্ষা group replaced the
 * syllabus and scholarship groups and the Quran / oral exam items). `replaces` are the old
 * section keys; `after` is used only when none of them is in the saved order.
 */
export interface NavOrderMigration {
  key: string;
  replaces: string[];
  after?: string;
}

/**
 * Puts each new section into a saved order where its old sections were: at the first saved
 * position of any key it replaces, else right after `after`. An order that already holds
 * the key, or an empty order (nothing arranged yet), is returned unchanged; a key with no
 * anchor is left out, so it falls to the end like any section never placed. The old keys
 * stay in the list; they match no section any more, so they are harmless and the next save
 * drops them.
 */
export function migrateOrder(order: string[], migrations: NavOrderMigration[]): string[] {
  if (order.length === 0) return order;
  let next = order;
  for (const m of migrations) {
    if (next.includes(m.key)) continue;
    const at = next.findIndex((k) => m.replaces.includes(k));
    const after = m.after === undefined ? -1 : next.indexOf(m.after);
    const pos = at >= 0 ? at : after >= 0 ? after + 1 : -1;
    if (pos < 0) continue;
    next = [...next.slice(0, pos), m.key, ...next.slice(pos)];
  }
  return next;
}

/**
 * D-#1654: inside one group, two leaves that share a label (শিক্ষার্থীর অগ্রগতি and পাঠ পরিকল্পনার
 * অগ্রগতি each exist in two stacks, behind different gates) show ONE row — the first. Pass the
 * VISIBLE leaves, so a person who passes only the second gate still sees it. Order is kept.
 */
export function dedupeByLabel<T extends { labelKey: unknown }>(leaves: T[]): T[] {
  const seen = new Set<unknown>();
  return leaves.filter((l) => {
    if (seen.has(l.labelKey)) return false;
    seen.add(l.labelKey);
    return true;
  });
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

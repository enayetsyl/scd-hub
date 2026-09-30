/**
 * LoadService (WB-3, D-#701) — the Principal's load grid: open minutes per person
 * per day (manual + auto), coloured PER CATEGORY (owner ruling 2026-09-30) with the
 * thresholds in shared vocab. Pure aggregation over WorkBoardService.
 */
import { loadLevelFor, type HrCategory, type LoadLevel } from "@scd/shared";
import { dateKeysBetween } from "../../attendance/dates";
import { allStaffUsers, boardFor, categoriesFor, type BoardUser, type WorkCard } from "./WorkBoardService";

export interface LoadCell {
  dateKey: string;
  minutes: number;
  openCards: number;
  level: LoadLevel;
}

export interface LoadRow {
  userId: string;
  name: string;
  category: string | null;
  cells: LoadCell[];
  weekMinutes: number;
}

/** Sum open (not DONE) minutes per user per day. Exported for the DB-free test. */
export function aggregateLoad(
  users: Array<{ id: string; name: string; category: string | null }>,
  cards: WorkCard[],
  keys: string[],
): LoadRow[] {
  const byUserDay = new Map<string, { minutes: number; open: number }>();
  for (const c of cards) {
    if (c.status === "DONE") continue;
    const k = `${c.userId}:${c.dateKey}`;
    const cur = byUserDay.get(k) ?? { minutes: 0, open: 0 };
    cur.minutes += c.effortMin;
    cur.open += 1;
    byUserDay.set(k, cur);
  }
  return users.map((u) => {
    const cells = keys.map((dateKey) => {
      const cur = byUserDay.get(`${u.id}:${dateKey}`) ?? { minutes: 0, open: 0 };
      return { dateKey, minutes: cur.minutes, openCards: cur.open, level: loadLevelFor(u.category as HrCategory | null, cur.minutes) };
    });
    return { userId: u.id, name: u.name, category: u.category, cells, weekMinutes: cells.reduce((n, c) => n + c.minutes, 0) };
  });
}

const CATEGORY_ORDER: Record<string, number> = { teacher: 0, assistant_hifz: 1, office_accounts: 2, support: 3 };

export async function loadGrid(fromKey: string, toKey: string, now = new Date()): Promise<LoadRow[]> {
  const keys = dateKeysBetween(fromKey, toKey, 14);
  if (keys.length === 0) return [];
  const users: BoardUser[] = await allStaffUsers();
  const cats = await categoriesFor(users);
  const cards = await boardFor(users, fromKey, toKey, now);
  const rows = aggregateLoad(
    users.map((u) => ({ id: u._id.toString(), name: u.name, category: cats.get(u._id.toString()) ?? null })),
    cards,
    keys,
  );
  return rows.sort(
    (a, b) =>
      (CATEGORY_ORDER[a.category ?? ""] ?? 9) - (CATEGORY_ORDER[b.category ?? ""] ?? 9) || a.name.localeCompare(b.name),
  );
}

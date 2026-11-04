/**
 * NavPreferenceService (D-#920) — read / save the caller's own sidebar arrangement and
 * count their taps for auto mode. SELF only: every function keys on the caller's own
 * account, so no permission is involved (permissionCatalogueGates OPEN_FIELDS).
 *
 * A "View as" session (D-#638) reads the borrowed account's arrangement — that is what
 * the borrowed sidebar looks like — but never writes it: the Principal rearranging
 * while looking would rearrange the teacher's own sidebar.
 */
import { Types } from "mongoose";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { NAV_MODES, NavPreference, type NavMode } from "../models/NavPreference";

/** A refused save — a sentence for the person, never a fault (EXPECTED_ERROR_NAMES). */
export class NavPreferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NavPreferenceError";
  }
}

/** Drawer keys are `<route>:<screen>` or `g:<titleKey>` — and never a Mongo map-key hazard. */
const KEY_RE = /^[A-Za-z0-9_]{1,60}:[A-Za-z0-9_]{0,60}$/;
const MAX_KEYS = 120;
/** Auto mode compares counts; once any passes this, all are halved so recent use wins. */
const USAGE_CEILING = 500;

export interface NavPreferenceView {
  mode: NavMode;
  order: string[];
  pinned: string[];
  usage: Array<{ key: string; count: number }>;
}

const EMPTY: NavPreferenceView = { mode: "manual", order: [], pinned: [], usage: [] };

/** A lean() row's map arrives as a plain object; a hydrated one as a Map. */
const usageEntries = (usage: unknown): Array<[string, number]> =>
  usage instanceof Map
    ? [...(usage as Map<string, number>).entries()]
    : Object.entries((usage ?? {}) as Record<string, number>);

function ownerOf(ctx: AppContext): { ownerKind: "USER" | "GUARDIAN"; ownerId: Types.ObjectId } {
  const auth = ctx.auth;
  if (!auth) throw new ForbiddenError("Unauthenticated");
  return { ownerKind: auth.role === "GUARDIAN" ? "GUARDIAN" : "USER", ownerId: new Types.ObjectId(auth.userId) };
}

function cleanKeys(keys: string[], what: string): string[] {
  if (keys.length > MAX_KEYS) throw new NavPreferenceError(`Too many ${what} (most ${MAX_KEYS})`);
  const out: string[] = [];
  for (const k of keys) {
    if (!KEY_RE.test(k)) throw new NavPreferenceError(`Not a sidebar item: ${k.slice(0, 80)}`);
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

export async function getNavPreference(ctx: AppContext): Promise<NavPreferenceView> {
  const row = await NavPreference.findOne(ownerOf(ctx)).lean();
  if (!row) return EMPTY;
  return {
    mode: row.mode ?? "manual",
    order: row.order ?? [],
    pinned: row.pinned ?? [],
    usage: usageEntries(row.usage).map(([key, count]) => ({ key, count })),
  };
}

export async function saveNavPreference(
  ctx: AppContext,
  input: { mode: string; order: string[]; pinned: string[] },
): Promise<NavPreferenceView> {
  const owner = ownerOf(ctx);
  if (ctx.auth?.impersonatorId) throw new NavPreferenceError("Viewing as someone else — their sidebar is theirs to arrange");
  if (!(NAV_MODES as readonly string[]).includes(input.mode)) throw new NavPreferenceError("Unknown sidebar mode");
  const order = cleanKeys(input.order, "sections");
  const pinned = cleanKeys(input.pinned, "favourites");
  await NavPreference.updateOne(owner, { $set: { mode: input.mode, order, pinned } }, { upsert: true });
  return getNavPreference(ctx);
}

/** Reset = forget the arrangement AND the counts, so auto mode starts fresh too. */
export async function resetNavPreference(ctx: AppContext): Promise<NavPreferenceView> {
  const owner = ownerOf(ctx);
  if (ctx.auth?.impersonatorId) throw new NavPreferenceError("Viewing as someone else — their sidebar is theirs to arrange");
  await NavPreference.deleteOne(owner);
  return EMPTY;
}

/** One sidebar tap. Silent no-op for a bad key or a View-as session — it is only a counter. */
export async function recordNavUse(ctx: AppContext, key: string): Promise<boolean> {
  const owner = ownerOf(ctx);
  if (ctx.auth?.impersonatorId || !KEY_RE.test(key)) return false;
  const row = await NavPreference.findOneAndUpdate(
    owner,
    { $inc: { [`usage.${key}`]: 1 }, $setOnInsert: { mode: "manual", order: [], pinned: [] } },
    { upsert: true, new: true, projection: { usage: 1 } },
  ).lean();
  const entries = usageEntries(row?.usage);
  if (entries.some(([, n]) => n > USAGE_CEILING)) {
    const halved = Object.fromEntries(entries.map(([k, n]) => [k, Math.floor(n / 2)] as const).filter(([, n]) => n > 0));
    await NavPreference.updateOne(owner, { $set: { usage: halved } });
  }
  return true;
}

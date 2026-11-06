/**
 * HelpGuideService (prd-help-centre HC-1, D-#968–#972): the in-app help guides.
 *
 * Guides are repo files under server/assets/help/ (D-#969), loaded once and checked with
 * the same `checkHelpGuide` CI runs. A file that fails is skipped with a warning rather
 * than crashing boot, and CI keeps such a file from reaching prod.
 *
 * WHO SEES WHAT is decided here, never in the app: a guardian sees GUARDIAN guides; staff
 * see ALL_STAFF guides plus every guide naming any permission they hold. That is the same
 * effective set `myPermissions` returns, so grant → appears, revoke → gone. Drafts are
 * never served.
 *
 * SELF only, so no catalogue switch (permissionCatalogueGates OPEN_FIELDS). A "View as"
 * session (D-#638) reads the borrowed person's guides but never writes their seen-list
 * or feedback: the Principal looking around must not clear a teacher's নতুন badges.
 */
import fs from "node:fs";
import path from "node:path";
import { Types } from "mongoose";
import {
  catalogueAction,
  checkHelpCategories,
  checkHelpGuide,
  effectivePermissions,
  helpPermissionKeys,
  isPermissionActive,
  type CataloguePermission,
  type HelpCategoryFile,
  type HelpGuideFile,
} from "@scd/shared";
import type { AppContext, AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { HelpGuideSeen } from "../models/HelpGuideSeen";
import { HelpGuideFeedback } from "../models/HelpGuideFeedback";
import { guardianFeaturesFor } from "../../guardian-access/services/GuardianFeatureService";

const DEFAULT_HELP_DIR = path.resolve(__dirname, "../../../../assets/help");
/** Screenshots are served under the existing /files prefix (no new Caddy @api path). */
export const HELP_SHOT_URL_PREFIX = "/files/help/";

interface Registry {
  dir: string;
  categories: HelpCategoryFile[];
  /** Valid, non-draft guides in display order. */
  guides: HelpGuideFile[];
  skipped: Array<{ file: string; problems: string[] }>;
}

let helpDir = DEFAULT_HELP_DIR;
let registry: Registry | null = null;

/** Tests point the registry at a fixture folder; `null` restores the real one. */
export function setHelpDirForTests(dir: string | null): void {
  helpDir = dir ?? DEFAULT_HELP_DIR;
  registry = null;
}

function loadRegistry(): Registry {
  if (registry) return registry;
  const dir = helpDir;
  const read = (p: string): unknown => JSON.parse(fs.readFileSync(p, "utf8"));
  const catPath = path.join(dir, "categories.json");
  const categoriesRaw = fs.existsSync(catPath) ? read(catPath) : [];
  const catProblems = checkHelpCategories(categoriesRaw);
  if (catProblems.length) console.warn(`[help] categories.json skipped: ${catProblems.join("; ")}`);
  const categories = catProblems.length ? [] : (categoriesRaw as HelpCategoryFile[]);
  const env = {
    categoryIds: new Set(categories.map((c) => c.id)),
    permissionKeys: helpPermissionKeys(),
    shotExists: (rel: string) => fs.existsSync(path.join(dir, "shots", rel)),
  };

  const guides: HelpGuideFile[] = [];
  const skipped: Registry["skipped"] = [];
  const guideDir = path.join(dir, "guides");
  const files = fs.existsSync(guideDir) ? fs.readdirSync(guideDir).filter((f) => f.endsWith(".json")).sort() : [];
  for (const file of files) {
    let raw: unknown;
    try {
      raw = read(path.join(guideDir, file));
    } catch (e) {
      skipped.push({ file, problems: [`not valid JSON: ${(e as Error).message}`] });
      continue;
    }
    const problems = checkHelpGuide(raw, { ...env, fileId: file.replace(/\.json$/, "") });
    if (problems.length) skipped.push({ file, problems });
    else if (!(raw as HelpGuideFile).draft) guides.push(raw as HelpGuideFile);
  }
  for (const s of skipped) console.warn(`[help] guide ${s.file} skipped: ${s.problems.join("; ")}`);

  const catOrder = new Map(categories.map((c, i) => [c.id, i] as const));
  guides.sort(
    (a, b) =>
      catOrder.get(a.category)! - catOrder.get(b.category)! ||
      (a.order ?? 999) - (b.order ?? 999) ||
      a.title.localeCompare(b.title, "bn"),
  );
  registry = { dir, categories, guides, skipped };
  return registry;
}

// ── Who sees what ──────────────────────────────────────────────────────────────

function heldPermissions(auth: AuthPayload): Set<string> {
  return new Set([...effectivePermissions(auth)].filter((p) => isPermissionActive(p)));
}

/**
 * The first permission (in the guide's own order) that unlocks it, or null for an audience guide.
 * `guardianOn` = the features switched on for this guardian (D-#1011); a guide naming a
 * `guardianFeature` the guardian does not have stays hidden, like the feature itself.
 */
function unlockingPermission(g: HelpGuideFile, auth: AuthPayload, held: Set<string>, guardianOn: Set<string>): string | null | false {
  if (auth.role === "GUARDIAN") {
    if (g.audience !== "GUARDIAN") return false;
    return g.guardianFeature && !guardianOn.has(g.guardianFeature) ? false : null;
  }
  if (g.audience === "ALL_STAFF") return null;
  if (g.audience === "GUARDIAN") return false;
  return g.perms!.find((p) => held.has(p)) ?? false;
}

interface Visible {
  guide: HelpGuideFile;
  unlockedBy: string | null;
}

async function visibleGuides(auth: AuthPayload): Promise<Visible[]> {
  const guardian = auth.role === "GUARDIAN";
  const held = guardian ? new Set<string>() : heldPermissions(auth);
  const guides = loadRegistry().guides;
  const guardianOn = new Set<string>(
    guardian && guides.some((g) => g.guardianFeature) ? await guardianFeaturesFor(auth.userId) : [],
  );
  const out: Visible[] = [];
  for (const guide of guides) {
    const by = unlockingPermission(guide, auth, held, guardianOn);
    if (by !== false) out.push({ guide, unlockedBy: by });
  }
  return out;
}

/** The guide, if the caller may see it; null otherwise (unknown, draft, or not theirs). */
export async function visibleGuide(auth: AuthPayload, id: string): Promise<HelpGuideFile | null> {
  return (await visibleGuides(auth)).find((v) => v.guide.id === id)?.guide ?? null;
}

/** Absolute path of a screenshot the caller may load, or null. Only shots the guide lists. */
export async function shotPathFor(auth: AuthPayload, guideId: string, file: string): Promise<string | null> {
  const guide = await visibleGuide(auth, guideId);
  const rel = `${guideId}/${file}`;
  if (!guide || !guide.rows.some((r) => r.shot === rel)) return null;
  const shots = path.join(loadRegistry().dir, "shots");
  const abs = path.resolve(shots, rel);
  return abs.startsWith(shots + path.sep) && fs.existsSync(abs) ? abs : null;
}

// ── Views ──────────────────────────────────────────────────────────────────────

export interface HelpStepView {
  text: string;
  box: number[];
}
export interface HelpRowView {
  heading: string;
  shotUrl: string;
  width: number;
  height: number;
  steps: HelpStepView[];
}
export interface HelpGuideView {
  id: string;
  category: string;
  title: string;
  intro: string;
  keywords: string[];
  screens: string[];
  goToRoute: string | null;
  goToScreen: string | null;
  /** Bangla name of the permission that unlocks it (the "why you see this" line); null for audience guides. */
  unlockedBy: string | null;
  isNew: boolean;
  rows: HelpRowView[];
}
export interface MyHelpView {
  /** Only categories with at least one guide for this person, in display order. */
  categories: HelpCategoryFile[];
  guides: HelpGuideView[];
  /** No seen-list yet: the app calls markHelpOpened to set the baseline. */
  firstOpen: boolean;
}

function ownerOf(ctx: AppContext): { ownerKind: "USER" | "GUARDIAN"; ownerId: Types.ObjectId } {
  const auth = ctx.auth;
  if (!auth) throw new ForbiddenError("Unauthenticated");
  return { ownerKind: auth.role === "GUARDIAN" ? "GUARDIAN" : "USER", ownerId: new Types.ObjectId(auth.userId) };
}

function toView(v: Visible, seen: Set<string> | null): HelpGuideView {
  const g = v.guide;
  return {
    id: g.id,
    category: g.category,
    title: g.title,
    intro: g.intro,
    keywords: g.keywords,
    screens: g.screens ?? [],
    goToRoute: g.goTo?.route ?? null,
    goToScreen: g.goTo?.screen ?? null,
    unlockedBy: v.unlockedBy ? catalogueAction(v.unlockedBy as CataloguePermission).bn : null,
    isNew: seen !== null && !seen.has(g.id),
    rows: g.rows.map((r) => ({
      heading: r.heading,
      shotUrl: HELP_SHOT_URL_PREFIX + r.shot!,
      width: r.size![0],
      height: r.size![1],
      steps: r.steps.map((s) => ({ text: s.text, box: s.box! })),
    })),
  };
}

export async function myHelpGuides(ctx: AppContext): Promise<MyHelpView> {
  const owner = ownerOf(ctx);
  const visible = await visibleGuides(ctx.auth!);
  const row = await HelpGuideSeen.findOne(owner, { guideIds: 1 }).lean();
  const seen = row ? new Set(row.guideIds ?? []) : null;
  const used = new Set(visible.map((v) => v.guide.category));
  return {
    categories: loadRegistry().categories.filter((c) => used.has(c.id)),
    guides: visible.map((v) => toView(v, seen)),
    firstOpen: !row,
  };
}

/** Create the seen-list on first open with everything visible now (no badge on day one). */
async function ensureBaseline(ctx: AppContext): Promise<void> {
  const owner = ownerOf(ctx);
  const ids = (await visibleGuides(ctx.auth!)).map((v) => v.guide.id);
  try {
    await HelpGuideSeen.updateOne(owner, { $setOnInsert: { guideIds: ids } }, { upsert: true });
  } catch (e) {
    // Two first opens at once: the other request created the row; that is the same outcome.
    if ((e as { code?: number }).code !== 11000) throw e;
  }
}

/** The help home was opened. A silent no-op under View-as. */
export async function markHelpOpened(ctx: AppContext): Promise<boolean> {
  ownerOf(ctx);
  if (ctx.auth!.impersonatorId) return false;
  await ensureBaseline(ctx);
  return true;
}

/** One guide was opened: its নতুন badge clears. False for a guide the caller cannot see, or under View-as. */
export async function markHelpGuideRead(ctx: AppContext, guideId: string): Promise<boolean> {
  const owner = ownerOf(ctx);
  if (ctx.auth!.impersonatorId || !(await visibleGuide(ctx.auth!, guideId))) return false;
  await ensureBaseline(ctx);
  await HelpGuideSeen.updateOne(owner, { $addToSet: { guideIds: guideId } });
  return true;
}

/** কাজে লেগেছে? হ্যাঁ / না: one answer per person per guide, changeable. */
export async function recordHelpFeedback(ctx: AppContext, guideId: string, helpful: boolean): Promise<boolean> {
  const owner = ownerOf(ctx);
  if (ctx.auth!.impersonatorId || !(await visibleGuide(ctx.auth!, guideId))) return false;
  await HelpGuideFeedback.updateOne({ guideId, ...owner }, { $set: { helpful } }, { upsert: true });
  return true;
}

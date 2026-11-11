// =============================================================================
// IN-APP HELP GUIDES (prd-help-centre §3–§4, D-#968–#973)
// =============================================================================
// The file shape of one guide (server/assets/help/guides/<id>.json) and the ONE
// structural check. The server's guide registry and skills/_tools/verify_help_guides.mjs
// (CI) both run `checkHelpGuide`, so a guide that passes CI is never skipped at boot for
// a structural reason, and vice versa.
//
// A guide is ONE small task: 1–4 screen rows, at most 8 steps, one red box per step.
// Who sees it is declared once: `perms` (any-of, catalogue keys) OR `audience`
// (ALL_STAFF for SELF actions, GUARDIAN for every guardian login; a GUARDIAN guide that
// names a `guardianFeature` reaches only guardians with it switched on). The server filters;
// the app never receives a guide the person may not see (D-#969).
//
// Boxes are FRACTIONS of the screenshot ([x, y, w, h], 0–1), recorded by the capture
// script (HC-3); the app draws them over the clean picture so a tapped step can light
// its own box. A `draft` guide may lack shots and boxes and is never shown to anyone.
//
// D-#1280: a guide may instead be a READING guide (`kind: "read"`), a short training
// article with no screenshots: 1–15 `sections`, each a heading and blocks (paragraph,
// bullet list, table, checklist). A reading guide has no `rows`; every other rule
// (id, category, perms/audience, screens, goTo, order, draft) is the same.

import { FEATURE_CATALOGUE } from "./permissionCatalogue";
import { GUARDIAN_FEATURES, type GuardianFeature } from "./vocab";

export const HELP_AUDIENCES = ["ALL_STAFF", "GUARDIAN"] as const;
export type HelpAudience = (typeof HELP_AUDIENCES)[number];

export const HELP_MAX_ROWS = 4;
export const HELP_MAX_STEPS = 8;
export const HELP_MAX_SECTIONS = 15;

/** `steps` (the default when absent): screenshot rows with numbered steps. `read`: text sections (D-#1280). */
export const HELP_GUIDE_KINDS = ["steps", "read"] as const;
export type HelpGuideKind = (typeof HELP_GUIDE_KINDS)[number];

/** One block of a reading guide: exactly one of these keys. Every string: `<b>…</b>` markup only. */
export type HelpBlockFile =
  | { p: string }
  | { list: string[] }
  | { table: { head: string[]; rows: string[][] } }
  | { check: string[] };

export interface HelpSectionFile {
  heading: string;
  blocks: HelpBlockFile[];
}

export type HelpBox = [number, number, number, number];

export interface HelpStepFile {
  /** Bangla. Markup: `<b>…</b>` only. The app appends the step number to the first bold run. */
  text: string;
  box: HelpBox | null;
}

export interface HelpRowFile {
  heading: string;
  /** `<guide id>/<name>.png|jpg|webp`, relative to server/assets/help/shots/. */
  shot: string | null;
  /** Screenshot pixel size [width, height], so the app can lay out before the image loads. */
  size: [number, number] | null;
  steps: HelpStepFile[];
}

export interface HelpGuideFile {
  id: string;
  category: string;
  title: string;
  intro: string;
  keywords: string[];
  perms?: string[];
  audience?: HelpAudience;
  /**
   * D-#1011: a GUARDIAN guide for a feature released per guardian (storybooks, activity
   * sheets). Only guardians who have that feature switched on see it.
   */
  guardianFeature?: GuardianFeature;
  /** `<Route>/<Screen>` addresses whose header ? opens this guide. */
  screens?: string[];
  /** Where এই পাতায় যান goes. */
  goTo?: { route: string; screen?: string };
  /** Position inside its category (work order: import before review before lock); default last. */
  order?: number;
  draft?: boolean;
  /** Absent = "steps". */
  kind?: HelpGuideKind;
  /** A steps guide's screen rows (required there; forbidden on a reading guide). */
  rows?: HelpRowFile[];
  /** A reading guide's sections (required there; forbidden on a steps guide). */
  sections?: HelpSectionFile[];
}

export interface HelpCategoryFile {
  id: string;
  title: string;
}

export interface HelpCheckEnv {
  /** The file's basename without `.json`; the guide id must equal it. */
  fileId?: string;
  categoryIds: ReadonlySet<string>;
  permissionKeys: ReadonlySet<string>;
  /** Does `server/assets/help/shots/<rel>` exist? */
  shotExists: (rel: string) => boolean;
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCREEN_RE = /^[A-Za-z0-9_]+\/[A-Za-z0-9_]+$/;
const ROUTE_RE = /^[A-Za-z0-9_]+$/;

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isFrac = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/** Only `<b>` / `</b>`, balanced and not nested. */
function markupProblem(text: string): string | null {
  const tags = text.match(/<[^>]*>/g) ?? [];
  let open = false;
  for (const t of tags) {
    if (t === "<b>") {
      if (open) return "nested <b>";
      open = true;
    } else if (t === "</b>") {
      if (!open) return "</b> without <b>";
      open = false;
    } else return `tag ${t} (only <b> is allowed)`;
  }
  if (open) return "unclosed <b>";
  if (/[<>]/.test(text.replace(/<\/?b>/g, ""))) return "stray < or >";
  return null;
}

const BLOCK_KEYS = ["p", "list", "table", "check"] as const;

/** A reading guide's sections (D-#1280): pushes every problem onto `p`. */
function checkSections(sections: unknown, p: string[]): void {
  if (!Array.isArray(sections) || sections.length === 0 || sections.length > HELP_MAX_SECTIONS) {
    p.push(`sections: 1–${HELP_MAX_SECTIONS} sections`);
    return;
  }
  const text = (at: string, v: unknown): void => {
    if (!isStr(v)) return void p.push(`${at}: text is required`);
    const m = markupProblem(v);
    if (m) p.push(`${at}: ${m}`);
  };
  const texts = (at: string, v: unknown): void => {
    if (!Array.isArray(v) || v.length === 0) return void p.push(`${at}: a non-empty list of text`);
    v.forEach((s, i) => text(`${at}[${i}]`, s));
  };
  sections.forEach((s, si) => {
    const at = `sections[${si}]`;
    if (!s || typeof s !== "object" || Array.isArray(s)) return void p.push(`${at}: not an object`);
    const sec = s as { heading?: unknown; blocks?: unknown };
    text(`${at}.heading`, sec.heading);
    if (!Array.isArray(sec.blocks) || sec.blocks.length === 0) return void p.push(`${at}: at least one block`);
    sec.blocks.forEach((b, bi) => {
      const bat = `${at}.blocks[${bi}]`;
      if (!b || typeof b !== "object" || Array.isArray(b)) return void p.push(`${bat}: not an object`);
      const keys = Object.keys(b);
      if (keys.length !== 1 || !(BLOCK_KEYS as readonly string[]).includes(keys[0])) {
        return void p.push(`${bat}: exactly one of ${BLOCK_KEYS.join(", ")}`);
      }
      const blk = b as Record<string, unknown>;
      if (keys[0] === "p") text(`${bat}.p`, blk.p);
      else if (keys[0] === "list") texts(`${bat}.list`, blk.list);
      else if (keys[0] === "check") texts(`${bat}.check`, blk.check);
      else {
        const t = blk.table as { head?: unknown; rows?: unknown } | null;
        if (!t || typeof t !== "object" || Array.isArray(t)) return void p.push(`${bat}.table: must be { head, rows }`);
        texts(`${bat}.table.head`, t.head);
        const cols = Array.isArray(t.head) ? t.head.length : 0;
        if (!Array.isArray(t.rows) || t.rows.length === 0) return void p.push(`${bat}.table.rows: at least one row`);
        t.rows.forEach((r, ri) => {
          const rat = `${bat}.table.rows[${ri}]`;
          if (!Array.isArray(r)) return void p.push(`${rat}: a list of cells`);
          if (r.length !== cols) p.push(`${rat}: ${r.length} cells; the head has ${cols}`);
          r.forEach((c, ci) => text(`${rat}[${ci}]`, c));
        });
      }
    });
  });
}

/** Every structural problem with one guide file; [] = valid. */
export function checkHelpGuide(raw: unknown, env: HelpCheckEnv): string[] {
  const p: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return ["not a JSON object"];
  const g = raw as Partial<HelpGuideFile> & Record<string, unknown>;

  if (!isStr(g.id) || !ID_RE.test(g.id)) p.push("id must be kebab-case (a-z, 0-9, -)");
  else if (env.fileId !== undefined && g.id !== env.fileId) p.push(`id "${g.id}" must equal the file name "${env.fileId}"`);
  if (!isStr(g.category) || !env.categoryIds.has(g.category)) p.push(`unknown category "${String(g.category)}"`);
  if (!isStr(g.title)) p.push("title is required");
  if (!isStr(g.intro)) p.push("intro is required");
  if (!Array.isArray(g.keywords) || !g.keywords.every(isStr)) p.push("keywords must be a list of words");
  if (g.draft !== undefined && typeof g.draft !== "boolean") p.push("draft must be true or false");
  if (g.order !== undefined && !(Number.isInteger(g.order) && g.order >= 0 && g.order <= 999)) p.push("order must be a whole number 0–999");

  const hasPerms = g.perms !== undefined;
  const hasAudience = g.audience !== undefined;
  if (hasPerms === hasAudience) p.push("declare exactly one of perms or audience");
  if (hasPerms) {
    if (!Array.isArray(g.perms) || g.perms.length === 0) p.push("perms must be a non-empty list");
    else for (const k of g.perms) if (!env.permissionKeys.has(k)) p.push(`perms: "${k}" is not in the permission catalogue`);
  }
  if (hasAudience && !(HELP_AUDIENCES as readonly unknown[]).includes(g.audience)) {
    p.push(`audience must be one of ${HELP_AUDIENCES.join(", ")}`);
  }
  if (g.guardianFeature !== undefined) {
    if (!(GUARDIAN_FEATURES as readonly unknown[]).includes(g.guardianFeature)) {
      p.push(`guardianFeature must be one of ${GUARDIAN_FEATURES.join(", ")}`);
    } else if (g.audience !== "GUARDIAN") p.push('guardianFeature needs audience "GUARDIAN"');
  }

  if (g.screens !== undefined && (!Array.isArray(g.screens) || !g.screens.every((s) => isStr(s) && SCREEN_RE.test(s)))) {
    p.push("screens must be a list of Route/Screen");
  }
  if (g.goTo !== undefined) {
    const go = g.goTo as { route?: unknown; screen?: unknown };
    if (!go || !isStr(go.route) || !ROUTE_RE.test(go.route) || (go.screen !== undefined && !(isStr(go.screen) && ROUTE_RE.test(go.screen)))) {
      p.push("goTo must be { route, screen? }");
    }
  }

  if (g.kind !== undefined && !(HELP_GUIDE_KINDS as readonly unknown[]).includes(g.kind)) {
    p.push(`kind must be one of ${HELP_GUIDE_KINDS.join(", ")}`);
    return p;
  }
  if (g.kind === "read") {
    if (g.rows !== undefined) p.push('a reading guide (kind "read") has no rows');
    checkSections(g.sections, p);
    return p;
  }
  if (g.sections !== undefined) p.push('sections need kind "read"');

  const draft = g.draft === true;
  const id = isStr(g.id) ? g.id : "";
  if (!Array.isArray(g.rows) || g.rows.length === 0 || g.rows.length > HELP_MAX_ROWS) {
    p.push(`rows: 1–${HELP_MAX_ROWS} screen rows`);
    return p;
  }
  let steps = 0;
  const shots = new Set<string>();
  g.rows.forEach((r, ri) => {
    const at = `rows[${ri}]`;
    if (!r || typeof r !== "object") return void p.push(`${at}: not an object`);
    if (!isStr(r.heading)) p.push(`${at}: heading is required`);
    if (r.shot === null || r.shot === undefined) {
      if (!draft) p.push(`${at}: shot is required (or mark the guide draft)`);
    } else if (!isStr(r.shot) || !new RegExp(`^${id}/[a-z0-9-]+\\.(png|jpg|webp)$`).test(r.shot)) {
      p.push(`${at}: shot must be "${id}/<name>.png|jpg|webp"`);
    } else {
      if (shots.has(r.shot)) p.push(`${at}: shot ${r.shot} is used twice`);
      shots.add(r.shot);
      if (!env.shotExists(r.shot)) p.push(`${at}: shot file ${r.shot} is missing`);
    }
    const size = r.size;
    if (size === null || size === undefined) {
      if (!draft) p.push(`${at}: size [width, height] is required`);
    } else if (!Array.isArray(size) || size.length !== 2 || !size.every((n) => Number.isInteger(n) && n > 0)) {
      p.push(`${at}: size must be [width, height] in pixels`);
    }
    if (!Array.isArray(r.steps) || r.steps.length === 0) return void p.push(`${at}: at least one step`);
    r.steps.forEach((s, si) => {
      steps += 1;
      const sat = `${at}.steps[${si}]`;
      if (!s || !isStr(s.text)) return void p.push(`${sat}: text is required`);
      const m = markupProblem(s.text);
      if (m) p.push(`${sat}: ${m}`);
      if (s.box === null || s.box === undefined) {
        if (!draft) p.push(`${sat}: box is required (or mark the guide draft)`);
      } else if (!Array.isArray(s.box) || s.box.length !== 4 || !s.box.every(isFrac)) {
        p.push(`${sat}: box must be [x, y, w, h] fractions 0–1`);
      } else {
        const [x, y, w, h] = s.box;
        if (w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) p.push(`${sat}: box must sit inside the picture`);
      }
    });
  });
  if (steps > HELP_MAX_STEPS) p.push(`${steps} steps; a guide has at most ${HELP_MAX_STEPS} (split it into two tasks)`);
  return p;
}

/**
 * Every `feature:action` in the permission catalogue: the only keys a guide may name.
 * Legacy permission names are not allowed (D-#799).
 */
export function helpPermissionKeys(): Set<string> {
  const keys = new Set<string>();
  for (const [feature, def] of Object.entries(FEATURE_CATALOGUE)) {
    for (const action of Object.keys(def.actions)) keys.add(`${feature}:${action}`);
  }
  return keys;
}

/** Category list problems; [] = valid. */
export function checkHelpCategories(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return ["categories must be a non-empty list"];
  const p: string[] = [];
  const seen = new Set<string>();
  raw.forEach((c, i) => {
    const cat = c as Partial<HelpCategoryFile>;
    if (!cat || !isStr(cat.id) || !/^[a-z0-9_]+$/.test(cat.id)) p.push(`categories[${i}]: id must be snake_case`);
    else if (seen.has(cat.id)) p.push(`categories[${i}]: duplicate id ${cat.id}`);
    else seen.add(cat.id);
    if (!cat || !isStr(cat.title)) p.push(`categories[${i}]: title is required`);
  });
  return p;
}

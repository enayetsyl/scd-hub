/**
 * Permission helpers for the data-assistant tools — the screens' rules, never a role check
 * (docs/prd-data-assistant-mcp.md §5). Kept apart from runTool.ts so tool files can import them
 * without a cycle through the registry.
 */
import { callerHasPermission, catalogueAction, FEATURE_CATALOGUE, type CataloguePermission, type Permission } from "@scd/shared";
import type { AuthPayload } from "../../context";
import { ToolDenied, type PermissionRule, type ToolDef } from "./types";


export function rulePerms(rule: PermissionRule): Permission[] {
  if ("authenticated" in rule) return [];
  return [...("anyOf" in rule ? rule.anyOf : rule.allOf)];
}

export function passes(auth: AuthPayload, rule: PermissionRule): boolean {
  if (auth.role === "GUARDIAN") return false;
  if ("authenticated" in rule) return true;
  return "anyOf" in rule ? rule.anyOf.some((p) => callerHasPermission(auth, p)) : rule.allOf.every((p) => callerHasPermission(auth, p));
}

/** Throws the §5.4 denial when the rule fails. */
export function assertRule(auth: AuthPayload, rule: PermissionRule): void {
  if (!passes(auth, rule)) {
    const perms = rulePerms(rule);
    throw new ToolDenied("allOf" in rule ? perms.filter((p) => !callerHasPermission(auth, p)) : perms);
  }
}

/** The gate of one mode (tools with modes name them; single-mode tools use "default"). */
export function gateOf(tool: ToolDef, mode = "default"): PermissionRule {
  const g = tool.gates.find((x) => x.mode === mode) ?? tool.gates[0];
  return g.rule;
}

export function toolVisible(tool: ToolDef, auth: AuthPayload): boolean {
  if (auth.role === "GUARDIAN") return false;
  return !!tool.alwaysVisible || tool.gates.some((g) => passes(auth, g.rule));
}

/** "উপস্থিতি: সব শাখা দেখা" for a catalogued permission; the raw key otherwise. */
export function permLabel(p: string, lang: "bn" | "en"): string {
  try {
    const a = catalogueAction(p as CataloguePermission);
    const f = (FEATURE_CATALOGUE as Record<string, { bn: string; en: string }>)[p.split(":")[0]];
    if (a && f) return lang === "bn" ? `${f.bn}: ${a.bn}` : `${f.en}: ${a.en}`;
  } catch {
    /* not catalogued */
  }
  return p;
}


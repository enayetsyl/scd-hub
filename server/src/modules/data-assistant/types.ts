/**
 * The data assistant's tool contract (docs/prd-data-assistant-mcp.md §4.3; D-#1531/#1534).
 * Every tool is read-only, takes typed arguments only (zod, validated at runtime), declares the
 * exact permission rule of the GraphQL query that shows the same data (`needs`, pinned by the
 * gate-parity test) and runs that query's row checks inside `run`.
 */
import type { Permission } from "@scd/shared";
import type { z } from "zod";
import type { AuthPayload, AppContext } from "../../context";

/** `authenticated` = any staff login (the screen's `{ authenticated: true }` + its GUARDIAN refusal). */
export type PermissionRule = { anyOf: readonly Permission[] } | { allOf: readonly Permission[] } | { authenticated: true };

export type DataSurface = "in_app" | "claude" | "chatgpt";

export interface ToolCtx {
  auth: AuthPayload;
  /** The existing gates take an AppContext; req/res are never touched by them. */
  app: AppContext;
  /** Today in Dhaka, `YYYY-MM-DD` — resolved on the server, never by the model. */
  today: string;
  surface: DataSurface;
}

export interface ToolResult {
  data: unknown;
  rowCount: number;
  truncated?: boolean;
  total?: number;
}

/** One gate of the tool, mirrored from a GraphQL query (the gate-parity test reads `mirrors`). */
export interface GateMirror {
  /** Mode name ("default" for single-mode tools). */
  mode: string;
  rule: PermissionRule;
  /** Resolver file (from server/src) + query field whose authScopes this rule copies. Null = no
   *  single query (the rule is the union the tool documents in `note`). */
  resolver: { file: string; field: string } | null;
  /** Permissions the mirrored path checks beyond its authScopes (inside the resolver body or the
   *  service, e.g. mastery's `mastery:approve`). Parity: authScopes ∪ alsoChecked = rule. */
  alsoChecked?: readonly Permission[];
  note?: string;
}

export interface ToolDef {
  name: string;
  /** English + Bangla keywords; says what it CANNOT answer. */
  description: string;
  /** Short Bangla label for chips and `my_access`. */
  label_bn: string;
  label_en: string;
  input: Record<string, z.ZodTypeAny>;
  /** Every mode's gate. `visible(auth)` = at least one mode passes (or `alwaysVisible`). */
  gates: readonly GateMirror[];
  /** True for `my_access` (the door switch is its only gate). */
  alwaysVisible?: boolean;
  maxRows: number;
  run(ctx: ToolCtx, args: Record<string, unknown>): Promise<ToolResult>;
}

/** Thrown by a tool when a gate fails; runTool maps it to the §5.4 shape. */
export class ToolDenied extends Error {
  constructor(
    public readonly needs: readonly Permission[],
    message?: string,
  ) {
    super(message ?? "permission_denied");
    this.name = "ToolDenied";
  }
}

/** Thrown by a tool for a bad argument combination (range too long, missing id…). */
export class ToolInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInvalid";
  }
}

export type ToolOutcome = "ok" | "denied" | "invalid" | "limited" | "error" | "off";

export interface ToolReplyOk {
  ok: true;
  as_of: string;
  data: unknown;
  row_count: number;
  truncated?: boolean;
  total?: number;
}

export interface ToolReplyErr {
  ok: false;
  error: "permission_denied" | "invalid_arguments" | "rate_limited" | "busy" | "timeout" | "off" | "not_found" | "failed";
  needs?: string[];
  message_bn: string;
  message_en: string;
  retry_after_s?: number;
}

export type ToolReply = ToolReplyOk | ToolReplyErr;

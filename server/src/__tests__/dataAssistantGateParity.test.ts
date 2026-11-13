/**
 * Data assistant DA-1 — gate parity (docs/prd-data-assistant-mcp.md §5.2; D-#1534, risk R7).
 * For every tool mode that mirrors a GraphQL query, read that resolver's SOURCE and assert its
 * `authScopes` permissions (∪ the extra checks the mirrored path makes, `alsoChecked`) equal the
 * tool's rule. A later change to a screen's gate fails here until the tool follows.
 */
import fs from "fs";
import path from "path";
import { ANY_PART } from "../modules/daily-report/partSwitches";
import { TOOL_REGISTRY } from "../modules/data-assistant/tools/registry";
import { rulePerms } from "../modules/data-assistant/gates";

const SRC = path.join(__dirname, "..");
/** Named constants a resolver may pass to authScopes. */
const CONSTANTS: Record<string, readonly string[]> = { ANY_PART };

function authScopesOf(file: string, field: string): { perms: string[] } | { authenticated: true } {
  const src = fs.readFileSync(path.join(SRC, file), "utf8");
  let at = src.indexOf(`queryField("${field}"`);
  if (at < 0) at = src.search(new RegExp(`\\b${field}\\s*:\\s*t\\.(field|boolean|string|int|float)`));
  if (at < 0) throw new Error(`${file}: query field ${field} not found`);
  const m = /authScopes:\s*(\{[^}]*\})/.exec(src.slice(at, at + 4000));
  if (!m) throw new Error(`${file}: ${field} has no authScopes`);
  const body = m[1];
  if (/authenticated:\s*true/.test(body)) return { authenticated: true };
  const one = /hasPermission:\s*"([^"]+)"/.exec(body);
  if (one) return { perms: [one[1]] };
  const many = /hasAnyPermission:\s*\[([^\]]*)\]/.exec(body);
  if (many) return { perms: [...many[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) };
  const ident = /hasAnyPermission:\s*([A-Z_]+)/.exec(body);
  if (ident && CONSTANTS[ident[1]]) return { perms: [...CONSTANTS[ident[1]]] };
  throw new Error(`${file}: ${field} authScopes not understood: ${body}`);
}

const mirrors = TOOL_REGISTRY.flatMap((t) => t.gates.map((g) => ({ tool: t.name, ...g })));

it.each(mirrors.filter((m) => m.resolver).map((m) => [`${m.tool}/${m.mode}`, m] as const))("%s mirrors its screen's gate", (_name, m) => {
  const s = authScopesOf(m.resolver!.file, m.resolver!.field);
  if ("authenticated" in s) {
    expect(m.rule).toEqual({ authenticated: true });
    return;
  }
  const want = [...new Set([...s.perms, ...(m.alsoChecked ?? [])])].sort();
  expect(rulePerms(m.rule).sort()).toEqual(want);
  // `allOf` only when the mirrored path really checks more than one switch.
  if ("allOf" in m.rule) expect((m.alsoChecked ?? []).length).toBeGreaterThan(0);
});

it("a mode with no single mirrored query says why", () => {
  for (const m of mirrors.filter((x) => !x.resolver)) expect([m.tool, m.mode, (m.note ?? "").length > 10]).toEqual([m.tool, m.mode, true]);
});

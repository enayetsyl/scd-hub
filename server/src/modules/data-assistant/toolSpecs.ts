/**
 * The tool list a model sees (docs/prd-data-assistant-mcp.md §4.5): one JSON schema per tool,
 * generated once from the tool's zod input, in registry order, filtered by what the person may
 * use — so two people with the same permissions get a byte-identical list (prompt cache).
 *
 * Only the JSON-schema keywords both providers accept are emitted (type, enum, description,
 * properties, required, additionalProperties: false). Pattern / range limits stay in the zod
 * validation `runTool` applies to every call, and are said in the description instead.
 */
import type { z } from "zod";
import type { AuthPayload } from "../../context";
import type { AiToolSpec } from "../platform/ai/provider";
import { toolVisible } from "./gates";
import { TOOL_REGISTRY } from "./tools/registry";
import type { ToolDef } from "./types";

type Def = { typeName?: string; description?: string; innerType?: z.ZodTypeAny; values?: readonly string[]; checks?: Array<{ kind: string; value?: unknown; regex?: RegExp }> };

function schemaOf(t: z.ZodTypeAny): { schema: Record<string, unknown>; optional: boolean } {
  const def = (t as unknown as { _def: Def })._def;
  if (def.typeName === "ZodOptional" || def.typeName === "ZodDefault") {
    const inner = schemaOf(def.innerType!);
    if (def.description && !inner.schema.description) inner.schema.description = def.description;
    return { schema: inner.schema, optional: true };
  }
  const out: Record<string, unknown> = {};
  switch (def.typeName) {
    case "ZodString": {
      out.type = "string";
      const rx = def.checks?.find((c) => c.kind === "regex");
      const hint = rx ? (rx as { message?: string }).message : undefined;
      const desc = [def.description, hint].filter(Boolean).join("; ");
      if (desc) out.description = desc;
      break;
    }
    case "ZodNumber": {
      out.type = def.checks?.some((c) => c.kind === "int") ? "integer" : "number";
      const min = def.checks?.find((c) => c.kind === "min")?.value;
      const max = def.checks?.find((c) => c.kind === "max")?.value;
      const range = min !== undefined || max !== undefined ? `${min ?? ""}..${max ?? ""}` : "";
      const desc = [def.description, range && `range ${range}`].filter(Boolean).join("; ");
      if (desc) out.description = desc;
      break;
    }
    case "ZodBoolean":
      out.type = "boolean";
      if (def.description) out.description = def.description;
      break;
    case "ZodEnum":
      out.type = "string";
      out.enum = [...(def.values ?? [])];
      if (def.description) out.description = def.description;
      break;
    default:
      throw new Error(`toolSpecs: unsupported zod type ${def.typeName}`);
  }
  return { schema: out, optional: false };
}

/** The JSON schema of one tool's input (an object, no extra keys). */
export function inputSchemaOf(tool: ToolDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [k, v] of Object.entries(tool.input)) {
    const s = schemaOf(v);
    properties[k] = s.schema;
    if (!s.optional) required.push(k);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

const cache = new Map<string, AiToolSpec>();

export function toolSpec(tool: ToolDef, auth?: AuthPayload): AiToolSpec {
  const trim = !!auth && !!tool.trimmed && tool.trimmed.when(auth);
  const key = trim ? `${tool.name}#trimmed` : tool.name;
  let s = cache.get(key);
  if (!s) {
    s = trim
      ? { name: tool.name, description: tool.trimmed!.description, inputSchema: inputSchemaOf({ ...tool, input: tool.trimmed!.input }) }
      : { name: tool.name, description: tool.description, inputSchema: inputSchemaOf(tool) };
    cache.set(key, s);
  }
  return s;
}

/** The tools this person may use, in registry order. */
export function toolSpecsFor(auth: AuthPayload): AiToolSpec[] {
  return TOOL_REGISTRY.filter((t) => toolVisible(t, auth)).map((t) => toolSpec(t, auth));
}

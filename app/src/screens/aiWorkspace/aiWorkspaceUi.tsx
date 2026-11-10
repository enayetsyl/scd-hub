/**
 * Shared bits of the AI Workspace screens (W-1): label helpers and the model / thinking
 * pickers. The chat's three pickers (W-2) reuse these.
 */
import { STR } from "../../lib/labels";
import type { AiProjectFileT, AiProjectRoleT } from "../../graphql/aiWorkspace";

export const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));

export const roleLabel = (r: AiProjectRoleT): string => (r === "owner" ? STR.awRoleOwner : r === "editor" ? STR.awRoleEditor : STR.awRoleViewer);

export const modelLabel = (m: string): string => (m === "deepseek-v4-pro" ? STR.awModelPro : m === "deepseek-flash" ? STR.awModelFlash : m);

export const thinkingLabel = (t: string): string => (t === "off" ? STR.awThinkingOff : t === "low" ? STR.awThinkingLow : STR.awThinkingHigh);

export const MODEL_OPTIONS = (): Array<{ label: string; value: string }> => [
  { label: STR.awModelFlash, value: "deepseek-flash" },
  { label: STR.awModelPro, value: "deepseek-v4-pro" },
];

export const THINKING_OPTIONS = (): Array<{ label: string; value: string }> => [
  { label: STR.awThinkingOff, value: "off" },
  { label: STR.awThinkingLow, value: "low" },
  { label: STR.awThinkingHigh, value: "high" },
];

export const tokenMethodLabel = (m: AiProjectFileT["tokenMethod"]): string =>
  m === "tokenizer" ? STR.awTokenTokenizer : m === "measured" ? STR.awTokenMeasured : STR.awTokenEstimate;

export const textSourceLabel = (s: AiProjectFileT["textSource"]): string =>
  s === "tesseract" ? STR.awSourceTesseract : s === "gemini" ? STR.awSourceGemini : STR.awSourceText;

/** 12345 → "12.3k"; small numbers as they are. */
export const kTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));

export const usd = (n: number): string => (n < 0.01 ? n.toFixed(4) : n.toFixed(2));

/** PDF or picture — the files Gemini can read. */
export const isScanLike = (f: Pick<AiProjectFileT, "mime" | "name">): boolean =>
  f.mime === "application/pdf" || f.mime.startsWith("image/") || /\.(pdf|png|jpe?g|webp|tiff?|bmp|gif)$/i.test(f.name);

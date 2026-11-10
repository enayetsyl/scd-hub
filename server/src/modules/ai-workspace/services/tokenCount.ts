/**
 * Token counts for the AI Workspace context budget (W-1, D-#1230).
 *
 *   1. `server/ai/count_tokens.py` — DeepSeek's offline tokenizer through Python, run like the
 *      import harness (execFile, PYTHON_BIN) → method "tokenizer";
 *   2. if Python, the library or the tokenizer files are missing → a character estimate
 *      (Bangla ÷ 2.6, everything else ÷ 4) → method "estimate";
 *   3. W-2 replaces a pinned file's count with DeepSeek's real figure once it has been sent
 *      → method "measured" (the API count is the authority).
 */
import { execFile } from "child_process";
import path from "path";

export type TokenMethod = "tokenizer" | "estimate";

const SCRIPT = path.resolve(__dirname, "../../../../ai/count_tokens.py");
const PYTHON_BIN = process.env.PYTHON_BIN ?? (process.platform === "win32" ? "python" : "python3");
const TIMEOUT_MS = 60_000;
/** Bangla script block. */
const BANGLA = /[ঀ-৿]/g;

/** Characters ÷ 2.6 for Bangla, ÷ 4 for the rest, rounded up (PRD §3; calibrate in the pilot). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const bangla = (text.match(BANGLA) ?? []).length;
  const other = text.length - bangla;
  return Math.ceil(bangla / 2.6 + other / 4);
}

export type PythonRunner = (input: string) => Promise<string>;

const runPython: PythonRunner = (input) =>
  new Promise((resolve, reject) => {
    const child = execFile(PYTHON_BIN, [SCRIPT], { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
    child.stdin?.end(input, "utf8");
  });

/** One count per text, and how they were made. Never throws. */
export async function countTokens(texts: string[], run: PythonRunner = runPython): Promise<{ counts: number[]; method: TokenMethod }> {
  if (texts.length === 0) return { counts: [], method: "estimate" };
  try {
    const out = JSON.parse(await run(JSON.stringify({ texts }))) as { counts?: unknown };
    if (Array.isArray(out.counts) && out.counts.length === texts.length && out.counts.every((n) => Number.isInteger(n) && (n as number) >= 0)) {
      return { counts: out.counts as number[], method: "tokenizer" };
    }
  } catch {
    // Python / the tokenizer is not installed here — estimate instead.
  }
  return { counts: texts.map(estimateTokens), method: "estimate" };
}

/**
 * The editing method (docs/prd-book-lifecycle.md §13 — NORMATIVE, D-#1602): one versioned asset,
 * `server/assets/book-lifecycle/edit_method_vN.md`, embedded BYTE FOR BYTE by the API prompt (BL-5),
 * the MCP `get_book_version(part: "method")` reply and the bundle. Its SHA-256 is computed once at
 * load; drafts, jobs and versions record `methodVersion` + `methodHash`. Sections are marked
 * `<!-- section: M-n · used-by: api,mcp,bundle -->` (EM-6). No in-app editor (EM-3).
 */
import { readFileSync } from "fs";
import * as path from "path";
import { sha256 } from "./markdown";

export const METHOD_VERSION = "v1";
const FILE = path.resolve(__dirname, `../../../../assets/book-lifecycle/edit_method_${METHOD_VERSION}.md`);

let cached: { text: string; hash: string } | null = null;

/** The method file exactly as stored (bytes decoded as UTF-8, never normalised or trimmed). */
export function methodText(): { version: string; text: string; hash: string } {
  if (!cached) {
    const text = readFileSync(FILE, "utf8");
    cached = { text, hash: sha256(text) };
  }
  return { version: METHOD_VERSION, ...cached };
}

export interface MethodSection {
  id: string;
  usedBy: string[];
  /** The exact bytes of the section, from its marker line to the next marker (or end). */
  text: string;
  start: number;
  end: number;
}

const MARK_RE = /^<!-- section: (M-\d+) · used-by: ([a-z,]+) -->$/gm;

export function methodSections(): MethodSection[] {
  const { text } = methodText();
  const marks = [...text.matchAll(MARK_RE)];
  return marks.map((m, i) => {
    const start = m.index!;
    const end = i + 1 < marks.length ? marks[i + 1].index! : text.length;
    return { id: m[1], usedBy: m[2].split(","), text: text.slice(start, end), start, end };
  });
}

/** Path A prompt parts (§14.2): the common sections (prefix), and the output-contract section that
 *  goes with each chapter (variable part). Byte slices of the file (bookMethodParity). */
export function apiMethodParts(): { common: string; outputContract: string } {
  const api = methodSections().filter((s) => s.usedBy.includes("api"));
  const contract = api.find((s) => s.id === "M-6");
  return { common: api.filter((s) => s.id !== "M-6").map((s) => s.text).join(""), outputContract: contract?.text ?? "" };
}

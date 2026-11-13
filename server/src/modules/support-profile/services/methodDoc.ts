/**
 * The method document (docs/prd-child-support-profile.md §6.2, NORMATIVE; D-#1584).
 * `server/assets/support-profile/method_vN.md` is the ONE source for every model and both modes.
 * The loader reads the file, computes its SHA-256 and splits it by the section markers
 * `<!-- section: M-n · stages: … -->` (MD-7). The pack embeds the whole file byte for byte; Mode A
 * (CSP-7) builds each stage's prompt from the marked sections, byte for byte. No in-app editor.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const METHOD_DIR = path.resolve(__dirname, "../../../../assets/support-profile");
const MARKER = /<!-- section: (M-\d+) · stages: ([A-Z, ]+) -->\r?\n/g;

export interface MethodSection {
  id: string;
  stages: string[];
  /** From the marker line (inclusive) to the next marker (exclusive), byte for byte. */
  text: string;
}
export interface MethodDoc {
  version: string;
  fileName: string;
  text: string;
  sha256: string;
  sections: MethodSection[];
}

/** Line ends → LF (and no BOM), so the hash never depends on the checkout's line-ending setting. */
export const lf = (s: string): string => s.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

const cache = new Map<string, MethodDoc>();

/** Every method version present in the repo, oldest first (v1, v2 …). */
export function methodVersions(dir = METHOD_DIR): string[] {
  return fs
    .readdirSync(dir)
    .map((f) => /^method_(v\d+)\.md$/.exec(f)?.[1])
    .filter((v): v is string => !!v)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

/** The method version in use: the highest one in the repo. */
export function currentMethodVersion(dir = METHOD_DIR): string {
  const all = methodVersions(dir);
  if (!all.length) throw new Error("support method: no method_vN.md found");
  return all[all.length - 1];
}

export function splitSections(rawText: string): MethodSection[] {
  const text = lf(rawText);
  const marks = [...text.matchAll(MARKER)];
  return marks.map((m, i) => ({
    id: m[1],
    stages: m[2].split(",").map((s) => s.trim()),
    text: text.slice(m.index!, i + 1 < marks.length ? marks[i + 1].index! : text.length),
  }));
}

export function loadMethod(version?: string, dir = METHOD_DIR): MethodDoc {
  const v = version ?? currentMethodVersion(dir);
  const key = `${dir}|${v}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const fileName = `method_${v}.md`;
  // LF-normalised: a checkout with CRLF line ends must hash and embed the same text (MD-7).
  const text = lf(fs.readFileSync(path.join(dir, fileName), "utf8"));
  const doc: MethodDoc = { version: v, fileName, text, sha256: createHash("sha256").update(text, "utf8").digest("hex"), sections: splitSections(text) };
  cache.set(key, doc);
  return doc;
}

/** Mode A (CSP-7): the common sections + the stage's sections, joined byte for byte, in file order. */
export function stagePrompt(stage: "CHECK" | "COMPARE" | "SYNTHESIS", version?: string, dir = METHOD_DIR): string {
  return loadMethod(version, dir)
    .sections.filter((s) => s.stages.includes("ALL") || s.stages.includes(stage))
    .map((s) => s.text)
    .join("");
}

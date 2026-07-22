/**
 * English Drive helpers (D-#344) — the module-local kind enum (mirrors the
 * server model, no shared-vocab twin) and the LENIENT filename parser that
 * prefills the upload form (PRD §4). Whatever fails to parse stays null; the
 * form always shows the parsed values editable (owner override rule #4).
 *
 * Recommended generator convention: C{class}_ENG_B{block}_{KIND}_v{version}.md
 * e.g. C3_ENG_B01_TN_v2.md — but any filename carrying the tokens works.
 */
import { STR, bnNum } from "./labels";

export const ENGLISH_DRIVE_KINDS = ["BLOCK", "TN", "CW", "HW", "PT", "AS", "CLUE"] as const;
export type EnglishDriveKind = (typeof ENGLISH_DRIVE_KINDS)[number];

export function englishDriveKindLabel(kind: string): string {
  switch (kind) {
    case "BLOCK":
      return STR.edKindBlock;
    case "TN":
      return STR.edKindTn;
    case "CW":
      return STR.edKindCw;
    case "HW":
      return STR.edKindHw;
    case "PT":
      return STR.edKindPt;
    case "AS":
      return STR.edKindAs;
    case "CLUE":
      return STR.edKindClue;
    default:
      return kind;
  }
}

export interface ParsedEnglishDriveName {
  classLevel: number | null;
  blockNumber: number | null;
  /** The blocks a PT covers (D-#347): `B03-05` → [3,4,5], `B3,4,5` → [3,4,5].
   *  Empty for every other kind (they use blockNumber). */
  blockNumbers: number[];
  kind: EnglishDriveKind | null;
  /** Sequence within (block × kind): C1B03_HW4 → 4, C1B03CW1 → 1. */
  seq: number | null;
  version: number | null;
}

/** Bangla block coverage for a PT: [3,4,5] → "৩–৫", [3,5] → "৩, ৫" (D-#347). */
export function formatBlocksBn(nums: number[]): string {
  const b = [...nums].sort((a, z) => a - z);
  const contiguous = b.length > 1 && b.length === b[b.length - 1] - b[0] + 1;
  return contiguous
    ? `${bnNum(b[0])}–${bnNum(b[b.length - 1])}`
    : b.map((n) => bnNum(n)).join(", ");
}

/** Expand a bare "covers blocks" form value — "3-5" / "3,4,5" / "3 5" → number[] (D-#347). */
export function parseBlockList(text: string): number[] {
  const set = new Set<number>();
  if (text.trim() === "") return [];
  for (const r of text.matchAll(/0*(\d+)\s*-\s*0*(\d+)/g)) {
    const a = Number(r[1]);
    const b = Number(r[2]);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) set.add(i);
  }
  for (const n of text.matchAll(/0*(\d+)/g)) set.add(Number(n[1]));
  return [...set].filter((n) => n >= 1).sort((a, b) => a - b);
}

/** Every block referenced by a name — ranges (B3-5) and lists (B3,4,5) expanded (D-#347). */
export function parseBlockSet(stem: string): number[] {
  const set = new Set<number>();
  // Each B-anchored group: a number, a range, or a comma list — e.g. B03-05, B3,4,5.
  const groupRe = /B(?:LOCK)?[\s_-]?0*(\d+(?:\s*[-,]\s*0*\d+)*)/gi;
  let m: RegExpExecArray | null;
  while ((m = groupRe.exec(stem)) !== null) {
    const body = m[1];
    for (const r of body.matchAll(/0*(\d+)\s*-\s*0*(\d+)/g)) {
      const a = Number(r[1]);
      const b = Number(r[2]);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) set.add(i);
    }
    for (const n of body.matchAll(/0*(\d+)/g)) set.add(Number(n[1]));
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Lenient by design (PRD §4): the real corpus mixes separator styles —
 * `C1B03CW1.md`, `C1B03_HW4.md`, `C3_ENG_B01_TN_v2.md`, `GrammarBlock3…` —
 * so tokens are matched WITHOUT requiring separators. Whatever fails stays
 * null; the form always shows every field editable (owner rule #4).
 */
export function parseEnglishDriveFilename(filename: string): ParsedEnglishDriveName {
  const stem = filename.replace(/\.md$/i, "").toUpperCase();

  // Class: C1..C5 not followed by another digit (so C12 is not class 1).
  const classMatch = /C([1-5])(?!\d)/.exec(stem);
  // Block: B03 / Block3 / B 3 — the first B-number run.
  const blockMatch = /B(?:LOCK)?[\s_-]?0*(\d+)/.exec(stem);
  // Version: a separated v-number (v2, _V10) — never digits glued to the kind.
  const versionMatch = /(?:^|[_\-\s.])V0*(\d+)(?=[_\-\s.]|$)/.exec(stem);

  // Kind (+ optional glued sequence, HW4 / CW1). Matched with the block-number
  // token blanked out so "Block3" never reads as the BLOCK kind.
  const kindSource = blockMatch
    ? stem.slice(0, blockMatch.index) +
      "_".repeat(blockMatch[0].length) +
      stem.slice(blockMatch.index + blockMatch[0].length)
    : stem;
  const kindMatch =
    /(?:^|[^A-Z])(BLOCK|TN|CW|HW|PT|AS|CLUE)[\s_-]?0*(\d+)?(?=[^A-Z0-9]|$)/.exec(kindSource);

  let kind: EnglishDriveKind | null = kindMatch
    ? (kindMatch[1] as EnglishDriveKind)
    : null;
  let seq = kindMatch?.[2] ? Number(kindMatch[2]) : null;
  // Generator variants the token pass misses (PRD §4) — full-word kinds
  // (C4_Eng_Assignment_W3…) and the grammar-block file.
  if (!kind && /GRAMMAR[\s_-]?BLOCK/.test(stem)) kind = "BLOCK";
  if (!kind && /ASSIGNMENT/.test(stem)) kind = "AS";
  if (!kind && /HOMEWORK/.test(stem)) kind = "HW";
  if (!kind && /CLASSWORK/.test(stem)) kind = "CW";
  if (!kind && /PRACTICE[\s_-]?TEST/.test(stem)) kind = "PT";
  if (!kind && /TEACHER[\s_-]?NOTE/.test(stem)) kind = "TN";
  if (!kind && /CLUE/.test(stem)) kind = "CLUE";
  // Week-numbered names (Assignment_W3) — the W-number is the sequence when no
  // digits were glued to the kind token itself.
  if (seq === null) {
    const weekMatch = /(?:^|[^A-Z])W0*(\d+)(?=[^0-9]|$)/.exec(stem);
    if (weekMatch) seq = Number(weekMatch[1]);
  }
  if (kind && seq === null) seq = 1;

  // PT covers 1+ blocks (D-#347) — collect the whole set, and its scalar block is null.
  const blockNumbers = kind === "PT" ? parseBlockSet(stem) : [];

  return {
    classLevel: classMatch ? Number(classMatch[1]) : null,
    blockNumber: kind === "PT" ? null : blockMatch ? Number(blockMatch[1]) : null,
    blockNumbers,
    kind,
    seq,
    version: versionMatch ? Number(versionMatch[1]) : null,
  };
}

/** Title default: the first `# heading` of the markdown (PRD §4), else null. */
export function titleFromMarkdown(content: string): string | null {
  const m = /^#\s+(.+)$/m.exec(content);
  return m ? m[1].trim().replace(/\s*#+\s*$/, "") : null;
}

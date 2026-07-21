/**
 * English Drive helpers (D-#344) — the module-local kind enum (mirrors the
 * server model, no shared-vocab twin) and the LENIENT filename parser that
 * prefills the upload form (PRD §4). Whatever fails to parse stays null; the
 * form always shows the parsed values editable (owner override rule #4).
 *
 * Recommended generator convention: C{class}_ENG_B{block}_{KIND}_v{version}.md
 * e.g. C3_ENG_B01_TN_v2.md — but any filename carrying the tokens works.
 */
import { STR } from "./labels";

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
  kind: EnglishDriveKind | null;
  version: number | null;
}

/** Token boundary: start/end of name or _ - . or whitespace. */
const tok = (body: string): RegExp => new RegExp(`(?:^|[_\\-\\s.])${body}(?=[_\\-\\s.]|$)`, "i");

export function parseEnglishDriveFilename(filename: string): ParsedEnglishDriveName {
  const stem = filename.replace(/\.md$/i, "");

  const classMatch = tok("C([1-5])").exec(stem);
  const blockMatch = tok("B(?:lock)?[\\s_-]?0*(\\d+)").exec(stem);
  const versionMatch = tok("v0*(\\d+)").exec(stem);

  let kind: EnglishDriveKind | null = null;
  for (const k of ENGLISH_DRIVE_KINDS) {
    if (tok(k).test(stem)) {
      kind = k;
      break;
    }
  }
  // Generator variants the strict tokens miss (PRD §4).
  if (!kind && /grammar[\s_-]?block/i.test(stem)) kind = "BLOCK";
  if (!kind && /clue/i.test(stem)) kind = "CLUE";

  return {
    classLevel: classMatch ? Number(classMatch[1]) : null,
    blockNumber: blockMatch ? Number(blockMatch[1]) : null,
    kind,
    version: versionMatch ? Number(versionMatch[1]) : null,
  };
}

/** Title default: the first `# heading` of the markdown (PRD §4), else null. */
export function titleFromMarkdown(content: string): string | null {
  const m = /^#\s+(.+)$/m.exec(content);
  return m ? m[1].trim().replace(/\s*#+\s*$/, "") : null;
}

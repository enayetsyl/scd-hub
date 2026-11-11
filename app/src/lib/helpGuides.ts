/**
 * Pure helpers for the help centre (prd-help-centre §2, D-#968): search, the step-text
 * markup, and which guides belong to a screen's header ?. Reading guides (D-#1280) are
 * searched by their section text too.
 */
import type { HelpGuideT } from "../graphql/help";
import { getActiveLang } from "./labels";

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
/** Step numbers in the reader's digits: ১, ২, ৩ in Bangla; 1, 2, 3 in English. */
export const bnDigits = (n: number): string =>
  getActiveLang() === "en" ? String(n) : String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);

export interface StepSegment {
  text: string;
  bold: boolean;
}

/**
 * Split step text on `<b>…</b>` (the only markup a guide may use, checkHelpGuide) and
 * append the step number to the first bold run: "<b>মঞ্জুর</b> চাপুন" → "মঞ্জুর (২)" bold.
 */
export function stepSegments(text: string, stepNo: string): StepSegment[] {
  const out: StepSegment[] = [];
  let numbered = false;
  for (const part of text.split(/(<b>[\s\S]*?<\/b>)/)) {
    if (!part) continue;
    const m = /^<b>([\s\S]*)<\/b>$/.exec(part);
    if (m) {
      out.push({ text: numbered ? m[1] : `${m[1]} (${stepNo})`, bold: true });
      numbered = true;
    } else out.push({ text: part, bold: false });
  }
  return out;
}

/** Reading-guide text (D-#1280): `<b>…</b>` → bold runs, with no step number. */
export function boldSegments(text: string): StepSegment[] {
  const out: StepSegment[] = [];
  for (const part of text.split(/(<b>[\s\S]*?<\/b>)/)) {
    if (!part) continue;
    const m = /^<b>([\s\S]*)<\/b>$/.exec(part);
    out.push(m ? { text: m[1], bold: true } : { text: part, bold: false });
  }
  return out;
}

/** Every string of a reading guide's sections, for search. */
function sectionText(g: HelpGuideT): string[] {
  return (g.sections ?? []).flatMap((s) => [
    s.heading,
    ...s.blocks.flatMap((b) => [
      b.p ?? "",
      ...(b.list ?? []),
      ...(b.check ?? []),
      ...(b.tableHead ?? []),
      ...(b.tableRows ?? []).flatMap((r) => r.cells),
    ]),
  ]);
}

const plain = (s: string): string => s.replace(/<\/?b>/g, "").toLowerCase();

/** Guides whose title, keywords, step text or reading-guide text contain every word of the query. */
export function searchGuides(guides: HelpGuideT[], query: string): HelpGuideT[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return guides;
  return guides.filter((g) => {
    const hay = [
      g.title,
      g.intro,
      ...g.keywords,
      ...g.rows.flatMap((r) => [r.heading, ...r.steps.map((s) => s.text)]),
      ...sectionText(g),
    ]
      .map(plain)
      .join(" ");
    return words.every((w) => hay.includes(w));
  });
}

/** `<Tab>/<Screen>`: the address a guide's `screens` list uses. */
export const screenKey = (tab: string | undefined, screen: string): string => `${tab ?? ""}/${screen}`;

export const guidesForScreen = (guides: HelpGuideT[], key: string): HelpGuideT[] =>
  guides.filter((g) => g.screens.includes(key));

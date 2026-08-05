/**
 * BlockSplitService (D-#455) — turn ONE authored block file into the family of
 * sheets the Drive actually delivers: the Teacher Delivery sheet (TN), the
 * classwork and homework sheets (CW1..n / HW1..n), the Performance Test (PT) and
 * the consolidated Answer Key (AK).
 *
 * The owner used to do this by hand in Claude Desktop and upload eleven files.
 * This does it in the app — but the split itself is DETERMINISTIC, not modelled:
 *
 *   1. The master already carries the seams. Every sheet sits under a heading
 *      bearing its own document code (`## CW-1 · \`C5B05-CW1\``, `# Performance
 *      Test · \`C5B05-PT\``, `# Consolidated Answer Key · \`C5B05-AK\``), so the
 *      sheets are SLICED, never regenerated. No exam item can be reworded, lost
 *      or invented by a model, because no model ever writes one.
 *   2. The mechanical reformatting (school header, `*(8 items, 2 marks each)*` →
 *      `[16]`, dropping the teacher-only trailer) is code.
 *   3. The LLM is used for the one thing that is genuinely new writing — the
 *      Teacher Delivery sheet's front matter and learning outcomes — and, when
 *      enabled, as a tidy pass over each sheet. Every polished sheet must pass
 *      `sameNumberedItems()` before it is accepted: same numbered items, same
 *      numbers, same order. Fail it and the deterministic slice ships instead.
 *
 * So the AI is an improvement, never a dependency: with no `OPENROUTER_API_KEY`,
 * a 429, or a truncated reply, the split still produces every sheet — it just
 * says so in `warnings`.
 *
 * Nothing here touches identity data (ADR-005) — the input is curriculum markdown.
 */
import { ENGLISH_DRIVE_MD_MAX_BYTES, type EnglishDriveKind } from "../models/EnglishDriveDoc";
import { openRouterFromEnv, type ChatProvider } from "./OpenRouterProvider";

/** One derived sheet, ready to be staged in the upload review list. */
export interface DerivedSheet {
  kind: EnglishDriveKind;
  seq: number;
  title: string;
  contentMd: string;
  /** PT only — the blocks it covers (D-#347); [] for every other kind. */
  blockNumbers: number[];
  /** The suggested upload filename, e.g. `C5_ENG_B05_CW1_v1.md`. */
  filename: string;
  /** True when an accepted LLM pass shaped this sheet; false = deterministic only. */
  polished: boolean;
}

export interface BlockSplitResult {
  sheets: DerivedSheet[];
  /** The model that polished, or null when the whole run was deterministic. */
  model: string | null;
  /** Anything the operator should read before confirming — skips, AI failures. */
  warnings: string[];
}

export interface BlockSplitInput {
  classLevel: number;
  blockNumber: number;
  version: number;
  contentMd: string;
  /** The topic shown on every sheet header; derived from the master when absent. */
  blockTitle?: string | null;
  /** Off = pure deterministic split (no API call at all). Default on. */
  polish?: boolean;
  /** Test seam — production passes nothing and the env decides. */
  provider?: ChatProvider | null;
}

// ---------------------------------------------------------------------------
// Seam detection
// ---------------------------------------------------------------------------

/** The kinds a block file can yield. BLOCK is the input, never an output. */
type SheetKind = Extract<EnglishDriveKind, "TN" | "CW" | "HW" | "PT" | "AK" | "AS" | "CLUE">;

/** A document code inside a heading: `C5B05-CW1`, `C5B05-PT`, `C5B05_AK`. */
const CODE_RE = /C\d+\s*B\d+[\s_-]*(CW|HW|PT|AK|AS|TN|CLUE)\s*(\d*)/i;
/** The label form a heading uses when it carries no code: `CW-1`, `HW 2`. */
const LABEL_RE = /^(CW|HW|PT|AK|AS|TN|CLUE)\s*[-–—]?\s*(\d*)\b/i;

/** Word forms, in match order — longest/most specific first. */
const WORD_FORMS: Array<[RegExp, SheetKind]> = [
  [/consolidated\s+answer\s+key|^answer\s+key\b/i, "AK"],
  [/performance\s+test|practice\s+test/i, "PT"],
  [/teacher\s+delivery|teacher\s+note/i, "TN"],
  [/^assignment\b/i, "AS"],
  [/clue\s+card/i, "CLUE"],
  [/^classwork\b/i, "CW"],
  [/^homework\b/i, "HW"],
];

/**
 * Headings that LOOK like a sheet but are structural dividers, not sheets. The
 * block file opens its worksheet run with a bare `# Worksheets`; treating that as
 * a sheet would swallow every sheet under it.
 */
const DIVIDER_RE = /^worksheets?$/i;

/** Sub-headings inside a sheet whose content belongs to the teacher, not the student. */
const TEACHER_ONLY_RE = /(teacher\s+(instructions?|notes?|guide)|marking|answer\s+key|rubric)/i;

/** Level-1 sections that are build metadata — they belong in neither sheet. */
const BUILD_META_RE =
  /(provenance|build\s+verification|dependency\s+flags|design\s+log|version\s+log|grammar\s+exemplars|bloom\s+ladder)/i;

interface HeadingHit {
  line: number;
  level: number;
  text: string;
  /** Set when this heading opens a sheet. */
  kind: SheetKind | null;
  seq: number | null;
}

/** Strip markdown decoration so heading text can be matched and reused as a title. */
export function plainText(s: string): string {
  return s
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/_{2}([^_]*)_{2}/g, "$1")
    .trim();
}

/** Classify one heading — which sheet it opens, if any. */
export function classifyHeading(text: string): { kind: SheetKind; seq: number | null } | null {
  const plain = plainText(text);
  if (DIVIDER_RE.test(plain)) return null;

  // 1. The document code is the strongest signal and carries the sequence.
  const code = CODE_RE.exec(plain);
  if (code) {
    return { kind: code[1].toUpperCase() as SheetKind, seq: code[2] ? Number(code[2]) : null };
  }
  // 2. `CW-1 · …` / `HW-2 …` at the head of the line.
  const label = LABEL_RE.exec(plain);
  if (label) {
    return { kind: label[1].toUpperCase() as SheetKind, seq: label[2] ? Number(label[2]) : null };
  }
  // 3. Written-out forms.
  for (const [re, kind] of WORD_FORMS) {
    if (re.test(plain)) return { kind, seq: null };
  }
  return null;
}

function scanHeadings(lines: string[]): HeadingHit[] {
  const hits: HeadingHit[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    // Board-work blocks are fenced and can contain `#` — never read inside one.
    if (/^\s*```/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!m) continue;
    const hit = classifyHeading(m[2]);
    hits.push({
      line: i,
      level: m[1].length,
      text: m[2].trim(),
      kind: hit ? hit.kind : null,
      seq: hit ? hit.seq : null,
    });
  }
  return hits;
}

interface RawSection {
  kind: SheetKind;
  seq: number | null;
  heading: string;
  /** The body, heading line excluded. */
  body: string[];
  /** Lines after a teacher-only sub-heading — never part of a student sheet. */
  teacherTail: string[];
  startLine: number;
  endLine: number;
}

/**
 * Cut the master at its sheet headings.
 *
 * A section ends at the next heading of the SAME OR SHALLOWER level — that one
 * rule is what keeps the answer key whole: its per-sheet sub-headings
 * (`### CW-1 — Plurals`) are deeper than the `# Consolidated Answer Key` that
 * opens it, so they do not start new sheets, while the level-1 section that
 * follows the key does end it.
 */
export function sliceSections(contentMd: string): { sections: RawSection[]; headings: HeadingHit[]; lines: string[] } {
  const lines = contentMd.split(/\r?\n/);
  const headings = scanHeadings(lines);
  const sections: RawSection[] = [];

  // A sheet heading INSIDE an already-cut sheet is not a new sheet — the answer
  // key's per-sheet sub-headings (`### CW-1 — Plurals`) are the whole reason this
  // guard exists; without it the key would shatter into fake classwork sheets.
  let cutTo = -1;

  for (let h = 0; h < headings.length; h++) {
    const start = headings[h];
    if (!start.kind) continue;
    if (start.line < cutTo) continue;
    let end = lines.length;
    for (let j = h + 1; j < headings.length; j++) {
      if (headings[j].level <= start.level) {
        end = headings[j].line;
        break;
      }
    }
    // Inside the section, a teacher-only sub-heading ends the student part.
    let cut = end;
    for (let j = h + 1; j < headings.length && headings[j].line < end; j++) {
      if (TEACHER_ONLY_RE.test(plainText(headings[j].text))) {
        cut = headings[j].line;
        break;
      }
    }
    sections.push({
      kind: start.kind,
      seq: start.seq,
      heading: start.text,
      body: lines.slice(start.line + 1, cut),
      teacherTail: lines.slice(cut, end),
      startLine: start.line,
      endLine: end,
    });
    cutTo = end;
  }
  return { sections, headings, lines };
}

// ---------------------------------------------------------------------------
// Sheet formatting (deterministic)
// ---------------------------------------------------------------------------

const KIND_SHEET_LABEL: Record<SheetKind, string> = {
  TN: "Teacher Delivery Sheet",
  CW: "Classwork",
  HW: "Homework",
  PT: "Performance Test",
  AK: "Answer Key",
  AS: "Assignment",
  CLUE: "Clue Card",
};

/** Kinds that number their sheets day by day — the code and header carry the seq. */
const NUMBERED_KINDS = new Set<SheetKind>(["CW", "HW", "AS"]);

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** The document code a sheet signs itself with: `C5B05-CW1`, `C5B05-PT`. */
export function sheetCode(classLevel: number, blockNumber: number, kind: SheetKind, seq: number): string {
  const suffix = NUMBERED_KINDS.has(kind) || seq > 1 ? String(seq) : "";
  return `C${classLevel}B${pad2(blockNumber)}-${kind}${suffix}`;
}

/**
 * The topic printed on every sheet header. Taken from the master's first heading:
 * "Class 5 English Drive — Grammar Block 5: **Noun — Countability** (teacher-…)"
 * → "Countability". Whatever this gets wrong the operator edits in the review list.
 */
export function deriveBlockTitle(contentMd: string): string {
  const m = /^#\s+(.+)$/m.exec(contentMd);
  if (!m) return "";
  let t = plainText(m[1]);
  t = t.replace(/\([^)]*\)\s*$/, "").trim(); // drop a trailing parenthetical
  const afterColon = t.split(":").pop();
  if (afterColon) t = afterColon.trim();
  const parts = t.split(/\s+[–—-]\s+/); // "Noun — Countability" → "Countability"
  return (parts[parts.length - 1] ?? t).trim();
}

/** The header every student-facing sheet opens with (the owner's existing style). */
function sheetHeader(classLevel: number, blockNumber: number, topic: string, kind: SheetKind, seq: number): string {
  const dayTag = NUMBERED_KINDS.has(kind) ? ` — Day ${seq}` : "";
  const label = `${KIND_SHEET_LABEL[kind]}${dayTag}`;
  return [
    "SCHOOL FOR COMMUNITY DEVELOPMENT",
    "",
    `Class ${classLevel} - English Grammar Campaign`,
    "",
    `Block ${pad2(blockNumber)}: ${topic} (${label})`,
    "",
    "Name- _______________________  Date- _______________________",
    "",
  ].join("\n");
}

/**
 * Part-mark annotations → the bracket tag the printed sheets use:
 *   `*(10 items, 1 mark each)*` → `[10]`   ·   `*(8 items, 2 marks each)*` → `[16]`
 *   `*(10 marks)*`              → `[10]`
 */
export function normaliseMarkTags(line: string): string {
  return line
    .replace(/\*?\((\d+)\s*items?,\s*(\d+)\s*marks?\s*each\)\*?/gi, (_m, items: string, marks: string) =>
      `[${Number(items) * Number(marks)}]`,
    )
    .replace(/\*?\((\d+)\s*marks?\)\*?/gi, (_m, marks: string) => `[${marks}]`);
}

/** A whole line wrapped in italics is an instruction line — print it plain. */
function unwrapItalicLine(line: string): string {
  const m = /^\*([^*].*[^*])\*$/.exec(line.trim());
  return m ? m[1].trim() : line;
}

/** The teacher-only trailer a worksheet carries in the master. */
const TOTAL_LINE_RE = /^\*{0,2}Total:\s*\d+/i;
/** The master's own name/date line — the header above already prints one. */
const NAME_LINE_RE = /^\*{0,2}Name:?\*{0,2}\s*_/i;

/** Body → student-facing sheet: header on, decoration off, code signed at the end. */
export function formatStudentSheet(
  section: RawSection,
  ctx: { classLevel: number; blockNumber: number; topic: string; seq: number },
): string {
  const out: string[] = [];
  for (const raw of section.body) {
    const line = raw.trimEnd();
    if (NAME_LINE_RE.test(line.trim())) continue;
    if (TOTAL_LINE_RE.test(line.trim())) continue;
    out.push(unwrapItalicLine(normaliseMarkTags(line)));
  }
  const body = out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/(\n\s*-{3,}\s*)+$/g, "").trim();
  const code = sheetCode(ctx.classLevel, ctx.blockNumber, section.kind, ctx.seq);
  return `${sheetHeader(ctx.classLevel, ctx.blockNumber, ctx.topic, section.kind, ctx.seq)}${body}\n\n*${code}*\n`;
}

/** The answer key keeps its master shape — it is a teacher document, not a form. */
export function formatTeacherSheet(
  section: RawSection,
  ctx: { classLevel: number; blockNumber: number; topic: string; seq: number },
): string {
  const code = sheetCode(ctx.classLevel, ctx.blockNumber, section.kind, ctx.seq);
  const body = [...section.body, ...section.teacherTail]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const head =
    `# Class ${ctx.classLevel} English — Block ${pad2(ctx.blockNumber)}: ${ctx.topic} — ` +
    `${KIND_SHEET_LABEL[section.kind]}\n\n**Teacher copy — never printed with a student sheet.**\n`;
  return `${head}\n${body}\n\n*${code}*\n`;
}

// ---------------------------------------------------------------------------
// The Teacher Delivery sheet
// ---------------------------------------------------------------------------

/**
 * Everything that is NOT a sheet and NOT build metadata, plus the teacher tails
 * the sheets shed (the PT's administration notes). This is the delivery sheet's
 * body — the day-by-day scripts, verbatim.
 */
export function teacherSheetSource(contentMd: string): string {
  const { sections, headings, lines } = sliceSections(contentMd);
  const drop: Array<[number, number]> = sections.map((s) => [s.startLine, s.endLine]);

  // Build-metadata sections go too — provenance, verification, the version log.
  for (let h = 0; h < headings.length; h++) {
    if (!BUILD_META_RE.test(plainText(headings[h].text))) continue;
    let end = lines.length;
    for (let j = h + 1; j < headings.length; j++) {
      if (headings[j].level <= headings[h].level) {
        end = headings[j].line;
        break;
      }
    }
    drop.push([headings[h].line, end]);
  }

  // The bare `# Worksheets` divider announced sections that are no longer here.
  for (const h of headings) {
    if (DIVIDER_RE.test(plainText(h.text))) drop.push([h.line, h.line + 1]);
  }

  const dropped = new Set<number>();
  for (const [a, b] of drop) for (let i = a; i < b; i++) dropped.add(i);

  const kept = lines.filter((_l, i) => !dropped.has(i));
  // The PT's teacher instructions live on this sheet, not on the student's paper.
  const tails = sections
    .filter((s) => s.teacherTail.length > 0)
    .map((s) => `## ${plainText(s.heading)} — teacher instructions\n\n${s.teacherTail.join("\n").trim()}`);

  const body = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    // Cutting whole sections out leaves their `---` rules stacked against each other.
    .replace(/(?:^|\n)(?:\s*-{3,}\s*\n\s*){2,}/g, "\n\n---\n\n")
    .trim();
  return [body, ...tails].join("\n\n---\n\n").trim();
}

const TN_SYSTEM =
  "You format existing school documents. You NEVER invent teaching content, never change or reword " +
  "an exam item, never translate, and never add commentary. You reply with markdown only — no code " +
  "fence, no preamble.";

/** The one genuinely-new piece of writing: the delivery sheet's front matter. */
function tnFrontMatterPrompt(ctx: {
  classLevel: number;
  blockNumber: number;
  topic: string;
  sheetList: string;
  source: string;
}): string {
  return [
    `Write ONLY the opening section of a Teacher Delivery Sheet for Class ${ctx.classLevel}, ` +
      `Block ${pad2(ctx.blockNumber)}: ${ctx.topic}. Output exactly, in this order:`,
    "",
    `1. An H1 title line: "# Class ${ctx.classLevel} English — Block ${pad2(ctx.blockNumber)}: ${ctx.topic} — Teacher Delivery Sheet"`,
    '2. A bold "**Runs:**" line stating the week, the number of teaching days and the minutes per session, taken from the source.',
    `3. A bold "**Sibling extracts (item content lives on its own sheet):**" line listing: ${ctx.sheetList}.`,
    '4. A "## Learning outcomes" section: "By the end of the week students can:" followed by 3–5 bullets, each one a capability the source actually teaches.',
    "",
    "Then stop. Do not write the checklist, the chart, the day plans or anything else — those are",
    "appended verbatim from the source. Do not invent a day, an outcome or a figure that is not in",
    "the source below. English only.",
    "",
    "--- SOURCE ---",
    ctx.source.slice(0, 24000),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The polish guard
// ---------------------------------------------------------------------------

/** Every "12." / "12)" numbered item a sheet carries, in order. */
export function numberedItems(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split(/\r?\n/)) {
    const m = /^\s*(\d+)[.)]\s/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * The gate every LLM-touched sheet must pass: the numbered items must be
 * identical, in the same order. An item silently dropped, renumbered or invented
 * is exactly the failure that would reach a child's desk unnoticed, so a polished
 * sheet that fails this is discarded and the deterministic slice ships.
 */
export function sameNumberedItems(before: string, after: string): boolean {
  const a = numberedItems(before);
  const b = numberedItems(after);
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

const POLISH_SYSTEM =
  "You tidy the FORMATTING of an existing student worksheet. You must keep every numbered item, its " +
  "number and its exact wording. Never add, remove, reorder, answer or reword an item. Never add a " +
  "heading or a note of your own. You reply with the whole sheet as markdown — no code fence, no preamble.";

const POLISH_TASK = [
  "Tidy this worksheet for printing:",
  "- keep the school header block, the part headings and every numbered item exactly as they are;",
  '- express each part\'s marks as a bracket tag at the end of its heading, e.g. "**Part A — …** [10]";',
  "- remove any leftover mark totals, answer keys, teacher notes or build annotations;",
  "- remove stray italics from instruction lines, keeping the bold part headings;",
  "- keep the blank answer rules (______) and the trailing document code line unchanged.",
  "",
  "--- SHEET ---",
].join("\n");

// ---------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------

/** Sheets in the order the library lists them. */
const KIND_ORDER: SheetKind[] = ["TN", "CW", "HW", "PT", "AK", "AS", "CLUE"];

/**
 * A section that is a placeholder rather than a sheet. The block file declares
 * the assignment slot up front and fills it a week later ("**Not built.** Per
 * Charter §M.3 …"), so both tests matter: too short to be a worksheet, or saying
 * outright that it does not exist yet.
 */
const PLACEHOLDER_MIN_CHARS = 400;
const NOT_BUILT_RE = /\*{0,2}not\s+built\.?\*{0,2}/i;

export async function splitEnglishDriveBlock(input: BlockSplitInput): Promise<BlockSplitResult> {
  if (!Number.isInteger(input.classLevel) || input.classLevel < 1 || input.classLevel > 5) {
    throw new Error("শ্রেণি ১ থেকে ৫ এর মধ্যে দিন");
  }
  if (!Number.isInteger(input.blockNumber) || input.blockNumber < 1) {
    throw new Error("ব্লক নম্বর দিন (১ বা তার বেশি)");
  }
  if (!input.contentMd || input.contentMd.trim() === "") {
    throw new Error("ফাইলটি খালি — কনটেন্ট পাওয়া যায়নি");
  }
  // The same cap the upload path enforces — a split of something bigger could
  // never be saved anyway.
  if (Buffer.byteLength(input.contentMd, "utf8") > ENGLISH_DRIVE_MD_MAX_BYTES) {
    throw new Error("ফাইলটি খুব বড় (সর্বোচ্চ ১ MB)");
  }

  const warnings: string[] = [];
  const topic = (input.blockTitle ?? "").trim() || deriveBlockTitle(input.contentMd) || "";
  const { sections } = sliceSections(input.contentMd);

  // Number the sheets per kind in document order when the heading carried no seq.
  const seqByKind = new Map<SheetKind, number>();
  const sheets: DerivedSheet[] = [];

  for (const section of sections) {
    const bodyText = section.body.join("\n").trim();
    // A real sheet either asks numbered questions or is a long teacher document.
    // A slot the master has only DECLARED is neither — and says so in prose.
    const looksReal = numberedItems(bodyText).length >= 3 || bodyText.length >= PLACEHOLDER_MIN_CHARS;
    if (NOT_BUILT_RE.test(bodyText.slice(0, 200)) || (!looksReal && section.teacherTail.length === 0)) {
      warnings.push(`"${plainText(section.heading)}" দেখে মনে হচ্ছে এখনো তৈরি হয়নি — বাদ দেওয়া হয়েছে`);
      continue;
    }
    const next = (seqByKind.get(section.kind) ?? 0) + 1;
    const seq = section.seq ?? next;
    seqByKind.set(section.kind, Math.max(next, seq));

    // AK is a teacher document; every other sliced sheet is a student form.
    const isTeacherDoc = section.kind === "AK";
    const contentMd = isTeacherDoc
      ? formatTeacherSheet(section, { classLevel: input.classLevel, blockNumber: input.blockNumber, topic, seq })
      : formatStudentSheet(section, { classLevel: input.classLevel, blockNumber: input.blockNumber, topic, seq });

    sheets.push({
      kind: section.kind as EnglishDriveKind,
      seq,
      title: sheetTitle(input.classLevel, input.blockNumber, topic, section.kind, seq),
      contentMd,
      // A PT sliced out of ONE block file covers that block (D-#347); editable.
      blockNumbers: section.kind === "PT" ? [input.blockNumber] : [],
      filename: `C${input.classLevel}_ENG_B${pad2(input.blockNumber)}_${section.kind}${
        NUMBERED_KINDS.has(section.kind) || seq > 1 ? seq : ""
      }_v${input.version}.md`,
      polished: false,
    });
  }

  if (sheets.length === 0) {
    throw new Error("এই ফাইলে আলাদা করার মতো কোনো শীট পাওয়া যায়নি — ফাইলটি ব্লক ফাইল কি না দেখুন");
  }

  // --- the teacher delivery sheet -----------------------------------------
  const tnSource = teacherSheetSource(input.contentMd);
  const provider = input.polish === false ? null : input.provider !== undefined ? input.provider : openRouterFromEnv();
  if (input.polish !== false && !provider) {
    warnings.push("AI কনফিগার করা নেই — শীটগুলো শুধু কেটে আলাদা করা হয়েছে (OPENROUTER_API_KEY দিন)");
  }

  let tnFront =
    `# Class ${input.classLevel} English — Block ${pad2(input.blockNumber)}: ${topic} — ` +
    `${KIND_SHEET_LABEL.TN}\n`;
  let tnPolished = false;
  if (provider) {
    const sheetList = sheets
      .map((s) => sheetCode(input.classLevel, input.blockNumber, s.kind as SheetKind, s.seq))
      .join(" · ");
    try {
      const front = await provider.complete({
        system: TN_SYSTEM,
        user: tnFrontMatterPrompt({
          classLevel: input.classLevel,
          blockNumber: input.blockNumber,
          topic,
          sheetList,
          source: tnSource,
        }),
        maxOutputTokens: 1200,
      });
      // Front matter that lost its title, or that ran long enough to be a rewrite
      // of the whole document, is not front matter — keep the plain title instead.
      if (/^#\s+\S/.test(front.trim()) && front.length < 4000) {
        tnFront = `${front.trim()}\n`;
        tnPolished = true;
      } else {
        warnings.push("শিক্ষক শীটের শুরুর অংশ AI থেকে সঠিক আকারে আসেনি — সাধারণ শিরোনাম বসানো হয়েছে");
      }
    } catch (e) {
      warnings.push(`শিক্ষক শীটের শুরুর অংশ AI দিয়ে তৈরি করা যায়নি: ${errText(e)}`);
    }
  }

  sheets.unshift({
    kind: "TN",
    seq: 1,
    title: sheetTitle(input.classLevel, input.blockNumber, topic, "TN", 1),
    contentMd: `${tnFront}\n${tnSource}\n\n*${sheetCode(input.classLevel, input.blockNumber, "TN", 1)}*\n`,
    blockNumbers: [],
    filename: `C${input.classLevel}_ENG_B${pad2(input.blockNumber)}_TN_v${input.version}.md`,
    polished: tnPolished,
  });

  // --- per-sheet tidy, item-preserving ------------------------------------
  if (provider) {
    for (const sheet of sheets) {
      // The delivery sheet and the key are prose, not forms — the tidy pass is
      // about worksheet furniture, so it only runs on the student forms.
      if (sheet.kind === "TN" || sheet.kind === "AK") continue;
      try {
        const tidied = await provider.complete({
          system: POLISH_SYSTEM,
          user: `${POLISH_TASK}\n${sheet.contentMd}`,
          maxOutputTokens: 4096,
        });
        if (sameNumberedItems(sheet.contentMd, tidied)) {
          sheet.contentMd = `${tidied.trim()}\n`;
          sheet.polished = true;
        } else {
          warnings.push(`${sheet.filename}: AI সাজানো সংস্করণে প্রশ্নের সংখ্যা মেলেনি — মূল কাটা সংস্করণ রাখা হয়েছে`);
        }
      } catch (e) {
        warnings.push(`${sheet.filename}: AI সাজানো যায়নি (${errText(e)}) — মূল কাটা সংস্করণ রাখা হয়েছে`);
      }
    }
  }

  sheets.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind as SheetKind) - KIND_ORDER.indexOf(b.kind as SheetKind) || a.seq - b.seq,
  );

  return {
    sheets,
    model: provider && sheets.some((s) => s.polished) ? provider.model : null,
    warnings,
  };
}

function sheetTitle(
  classLevel: number,
  blockNumber: number,
  topic: string,
  kind: SheetKind,
  seq: number,
): string {
  const dayTag = NUMBERED_KINDS.has(kind) ? ` — Day ${seq}` : "";
  const head = `Block ${pad2(blockNumber)}${topic ? `: ${topic}` : ""}`;
  return `Class ${classLevel} · ${head} (${KIND_SHEET_LABEL[kind]}${dayTag})`;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : "unknown error");

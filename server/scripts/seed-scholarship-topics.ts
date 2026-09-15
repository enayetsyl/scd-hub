/**
 * Seed the ScholarshipTopic catalogue for Class 5 (SC-0, D-#657/#665/#666).
 *
 * Every topic is a SKILL — what the student has to be able to DO — taken from the NAPE
 * 2026 প্রশ্নপত্র কাঠামো (memo 38.04.0000.801.06.314.24, 08 July 2026). Typed here from
 * the signed tables, because there is no machine-readable copy of them in the repo.
 *
 *  - বাংলা (15) · English (24) · গণিত (11) — the circular's item tables name the skills
 *    outright (article, tense, WH-question, লসাগু ও গসাগু, শতকরা…). English is 24 rather
 *    than its 14 printed items because SEVEN of them offer alternatives, and it is the
 *    only subject labelled in English — see the ENG block and
 *    `docs/scholarship-eng-paper-structure.md` (D-#667/#669).
 *  - প্রাথমিক বিজ্ঞান · বাংলাদেশ ও বিশ্বপরিচয় (6 each) — their tables name ANSWER FORMS,
 *    and the owner ruled that the form IS the skill for these two (D-#666). The paper
 *    backs it: in a 50-mark half, বিস্তৃত উত্তর alone is 24 marks and সংক্ষিপ্ত another
 *    12, so "she loses most of her marks on বিস্তৃত" is a teachable finding about
 *    long-form writing. An earlier cut seeded CHAPTERS here instead; that made the topic
 *    view and the chapter view identical, which is what the owner objected to.
 *
 * Chapters are not lost either way: every declared ITEM carries its own `chapters`, so
 * the chapter axis works independently of what the topics are.
 *
 * `key` is an explicit ASCII handle, NOT the array position. The code it builds is what
 * every item ever tagged with this topic points at, so it must survive reordering and
 * renaming — a position-derived code would silently re-point existing items the first
 * time somebody inserted a row, and a label-derived one would move when a topic is
 * renamed (which is exactly the edit `labelBn` exists to allow).
 *
 * DRY-RUN by default (prints what it would write); pass --commit to write. Guarded to
 * the managed scdhub_* databases; any other db is refused.
 *
 * Usage (repo root):
 *   npx tsx server/scripts/seed-scholarship-topics.ts                    # dry-run
 *   npx tsx server/scripts/seed-scholarship-topics.ts --commit           # write
 *   npx tsx server/scripts/seed-scholarship-topics.ts --commit --prune   # + retire what it no longer seeds
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { connectDb, disconnectDb, mongoose } from "../src/db";
import { ScholarshipTopic } from "../src/modules/scholarship/models/ScholarshipTopic";
import type { HwSubject, ScholarshipTopicAxis } from "@scd/shared";

const COMMIT = process.argv.includes("--commit");
const PRUNE = process.argv.includes("--prune");
const ALLOWED_DBS = ["scdhub_local", "scdhub_dev", "scdhub_prod"];
const CLASS_LEVEL = 5;

interface Seed {
  subject: HwSubject;
  /** Stable ASCII handle — the code is built from this and never from the position. */
  key: string;
  labelBn: string;
  axis: ScholarshipTopicAxis;
  /** What the blueprint says the item is worth, where it fixes one (D-#669). Reference
   *  only; a declared paper's authority is the marks typed per item. */
  marks?: number;
}

const skill = (subject: HwSubject, key: string, labelBn: string, marks?: number): Seed => ({
  subject,
  key,
  labelBn,
  axis: "skill",
  marks,
});

/**
 * English — the 2026 structure's 14 printed items, expanded to 24 topics (D-#667/#669).
 *
 * **This list is the owner-approved structure. Do not re-derive it from the circular's
 * prose — read `docs/scholarship-eng-paper-structure.md`, which is the narrative twin of
 * this array and the thing a question generator is pointed at.**
 *
 * 1. **The labels are ENGLISH.** The house rule is Bangla for teacher-facing content, and
 *    every other subject here keeps it. The English paper is the exception the rule
 *    already implies: its items are PRINTED in English, so `ব্যাকরণ — article` made the
 *    teacher translate backwards to find the row matching the question in front of her.
 *    The field is still named `labelBn` — it is the one display label, and renaming a
 *    stored field to carry one subject's language would be a migration for nothing.
 *
 * 2. **A printed item that offers alternatives is one topic PER ALTERNATIVE.** Seven do:
 *    1 (matching · true/false) · 6 (parts of speech · tense) · 7 (affixes · articles) ·
 *    9 (jumbled words · jumbled sentences) · 11 (form · cardinal · ordinal · time) ·
 *    13 (letter · application · email) · 14 (free · guided composition). The setter picks
 *    ONE per paper, so a student's marks only ever land on one side — merging them would
 *    average a skill she was tested on with one she never saw, and that average is
 *    precisely the finding this module exists to produce.
 *
 * 3. **The other seven items are NOT split** (2, 3, 4, 5, 8, 10, 12). The model papers
 *    give these an `.a`/`.b` too, but both halves are the SAME question with different
 *    material — a device for printing two papers from one unit, not a choice of skill.
 *    Splitting them would invent a distinction the blueprint does not make.
 *
 * `marks` is what the blueprint says the item carries. They do NOT sum to 100: an item
 * contributes its marks once per alternative, so English is **168 across 24 rows** while
 * any one printed paper is 100. Reference only — a declared paper is still checked
 * against the marks the teacher types per item.
 *
 * The trailing `Qn ·x` comment is the circular's own item number and part letter — the
 * mapping back to the printed paper, which the sequential list position cannot carry.
 */
const ENG: Seed[] = [
  skill("ENG", "MATCH-MEANING", "Match the given words with their meanings", 5), //     Q1 ·a
  skill("ENG", "TRUE-FALSE", "Indicate True/False", 5), //                              Q1 ·b
  skill("ENG", "SENTENCE-MAKING", "Make meaningful sentences with the given words", 5), // Q2
  skill("ENG", "COMPREHENSION-SEEN", "Answer the questions — textbook passage", 18), // Q3
  skill("ENG", "UNSEEN-CLOZE", "Fill in the blanks from the box — unseen text", 5), //  Q4
  skill("ENG", "COMPREHENSION-UNSEEN", "Answer the questions — unseen text", 9), //     Q5
  skill("ENG", "PARTS-OF-SPEECH", "Identify the parts of speech of the underlined words", 5), // Q6 ·a
  skill("ENG", "TENSE", "Change the tenses as directed", 5), //                         Q6 ·b
  skill("ENG", "AFFIX", "Complete the text adding suffixes and prefixes", 6), //        Q7 ·a
  skill("ENG", "ARTICLE", "Fill in the gaps with a, an or the", 6), //                  Q7 ·b
  skill("ENG", "WH-QUESTION", "Make WH questions from the given statements", 5), //     Q8
  skill("ENG", "REARRANGE-WORDS", "Rearrange the words to make meaningful sentences", 7), // Q9 ·a
  skill("ENG", "REARRANGE-SENTENCES", "Rearrange the sentences to form a story", 7), // Q9 ·b
  skill("ENG", "PUNCTUATION", "Rewrite using correct capitalization and punctuation", 5), // Q10
  skill("ENG", "FORM-FILL", "Read the information and fill out the form", 5), //        Q11 ·a
  skill("ENG", "CARDINAL-NUMBERS", "Fill in the blanks with cardinal numbers", 5), //   Q11 ·b
  skill("ENG", "ORDINAL-NUMBERS", "Fill in the blanks with ordinal numbers", 5), //     Q11 ·c
  skill("ENG", "TIME-INFO", "Fill in the blanks using information related to time", 5), // Q11 ·d
  skill("ENG", "VERB-FORM", "Complete the sentences using the correct forms of verbs", 5), // Q12
  skill("ENG", "LETTER", "Write a letter", 10), //                                      Q13 ·a
  skill("ENG", "APPLICATION", "Write an application", 10), //                           Q13 ·b
  skill("ENG", "EMAIL", "Write an email", 10), //                                       Q13 ·c
  skill("ENG", "COMPOSITION", "Write a short composition (free)", 10), //               Q14 ·a
  skill("ENG", "COMPOSITION-GUIDED", "Write a guided composition by answering given questions", 10), // Q14 ·b
];

/** বাংলা — the 15 items of the 2026 structure. */
const BAN: Seed[] = [
  skill("BAN", "POEM-RECALL", "কবিতা মুখস্থ লিখন"),
  skill("BAN", "WORD-MEANING", "শব্দার্থ লিখন"),
  skill("BAN", "SENTENCE", "বাক্য গঠন"),
  skill("BAN", "FILL-BLANK", "শূন্যস্থান পূরণ"),
  skill("BAN", "MCQ", "বহুনির্বাচনি"),
  skill("BAN", "ANTONYM-SYNONYM", "বিপরীত ও সমার্থক শব্দ"),
  skill("BAN", "SHORT-ANSWER", "সংক্ষিপ্ত-উত্তর প্রশ্ন"),
  skill("BAN", "LONG-ANSWER", "বিস্তৃত-উত্তর প্রশ্ন"),
  skill("BAN", "MAIN-IDEA", "মূলভাব লিখন"),
  skill("BAN", "GRAMMAR-FORMS", "ভাষারীতি · পদ নির্ণয় · ক্রিয়ার কাল"),
  skill("BAN", "QUESTION-MAKING", "প্রশ্ন তৈরিকরণ ও বিরামচিহ্ন"),
  skill("BAN", "CONJUNCT", "যুক্তবর্ণ বিভাজন ও শব্দ গঠন"),
  skill("BAN", "ONE-WORD", "এককথায় প্রকাশ"),
  skill("BAN", "FORM-APPLICATION", "ফরম পূরণ ও আবেদনপত্র"),
  skill("BAN", "COMPOSITION", "রচনা লিখন"),
];

/** গণিত — items 4–11 name the topic outright; items 1–3 are format rows spanning the
 *  whole syllabus, kept as one skill each. */
const MATH: Seed[] = [
  skill("MATH", "MCQ", "বহুনির্বাচনি"),
  skill("MATH", "FILL-BLANK", "শূন্যস্থান পূরণ"),
  skill("MATH", "SHORT-ANSWER", "সংক্ষিপ্ত উত্তর"),
  skill("MATH", "FOUR-OPERATIONS", "চার প্রক্রিয়া"),
  skill("MATH", "LCM-HCF", "লসাগু ও গসাগু"),
  skill("MATH", "FRACTION", "সাধারণ ও দশমিক ভগ্নাংশ"),
  skill("MATH", "PERCENTAGE", "শতকরা"),
  skill("MATH", "AVERAGE", "গড়"),
  skill("MATH", "MEASUREMENT", "পরিমাপ"),
  skill("MATH", "GEOMETRY", "জ্যামিতি"),
  skill("MATH", "DATA", "উপাত্ত বিন্যস্তকরণ"),
];

/** প্রাথমিক বিজ্ঞান · বাংলাদেশ ও বিশ্বপরিচয় — the answer FORM is the skill (D-#666).
 *  Both halves of the combined paper carry the identical five-row table, so both get the
 *  same six; শূন্যস্থান and সত্য-মিথ্যা are split apart (the circular prints them as one
 *  item, but they are different abilities and the app's item types already separate them). */
const FORM_SKILLS: { key: string; labelBn: string }[] = [
  { key: "MCQ", labelBn: "বহুনির্বাচনি" },
  { key: "FILL-BLANK", labelBn: "শূন্যস্থান পূরণ" },
  { key: "TRUE-FALSE", labelBn: "সত্য-মিথ্যা নির্ণয়" },
  { key: "MATCHING", labelBn: "মিলকরণ" },
  { key: "SHORT-ANSWER", labelBn: "সংক্ষিপ্ত উত্তর" },
  { key: "LONG-ANSWER", labelBn: "বিস্তৃত উত্তর" },
];

function codeOf(subject: HwSubject, key: string): string {
  return `TOP-SCH-${subject}-C${CLASS_LEVEL}-${key}`;
}

/**
 * Deactivate topics of a seeded subject that this run did NOT write (`--prune`).
 *
 * Opt-in and never automatic, because the catalogue is also editable in the app: a
 * silent "make the database match this file" would quietly retire whatever a teacher had
 * added by hand. Soft only — `active: false` — so any item already tagged with a pruned
 * code keeps resolving and its marks stay in the analysis (the D-#548 posture).
 *
 * What it is for: the first prod seed wrote 29 CHAPTER topics for SCI/BGS, which D-#666
 * replaced. Without a prune those sit in the picker for ever, offering an axis the owner
 * ruled against. D-#667/#669 add five more — the English rows `VOCAB`, `COMPREHENSION`,
 * `UNSEEN`, `REARRANGE` and `FORM-NUMBERS`, whose Bangla labels or merged wording were
 * replaced by the English items they stood for. The nine ENG keys whose skill is
 * unchanged (`PARTS-OF-SPEECH`, `TENSE`, `ARTICLE`, `AFFIX`, `WH-QUESTION`,
 * `PUNCTUATION`, `VERB-FORM`, `LETTER`, `COMPOSITION`) are deliberately REUSED, so a
 * paper already tagged with one keeps its marks and simply reads in English from now on.
 */
async function pruneUnseeded(
  subjects: readonly HwSubject[],
  keepCodes: ReadonlySet<string>,
  commit: boolean,
): Promise<number> {
  const rows = (await ScholarshipTopic.find({
    subject: { $in: subjects },
    classLevel: CLASS_LEVEL,
    active: true,
  })
    .select("code subject labelBn")
    .lean()) as { code: string; subject: string; labelBn: string }[];

  const stale = rows.filter((r) => !keepCodes.has(r.code));
  for (const r of stale) console.log(`    prune ${r.subject} · ${r.labelBn}`);
  if (commit && stale.length > 0) {
    await ScholarshipTopic.updateMany(
      { classLevel: CLASS_LEVEL, code: { $in: stale.map((r) => r.code) } },
      { $set: { active: false } },
    );
  }
  return stale.length;
}

async function main(): Promise<void> {
  await connectDb();
  const dbName = mongoose.connection.db?.databaseName ?? "";
  if (!ALLOWED_DBS.includes(dbName)) {
    throw new Error(
      `Refusing to touch database "${dbName}" — expected one of ${ALLOWED_DBS.join(", ")}`,
    );
  }
  console.log(`db: ${dbName} · ${COMMIT ? "COMMIT" : "DRY-RUN"}${PRUNE ? " · PRUNE" : ""}`);

  const seeds: Seed[] = [...ENG, ...BAN, ...MATH];
  for (const subject of ["SCI", "BGS"] as HwSubject[]) {
    for (const f of FORM_SKILLS) seeds.push(skill(subject, f.key, f.labelBn));
  }

  // A duplicate key inside one subject would make two topics share a code, so the second
  // would silently overwrite the first. Cheap to check, impossible to spot by eye.
  const seen = new Set<string>();
  for (const s of seeds) {
    const code = codeOf(s.subject, s.key);
    if (seen.has(code)) throw new Error(`duplicate topic code in the seed list: ${code}`);
    seen.add(code);
  }

  let written = 0;
  const perSubject = new Map<string, number>();
  for (const s of seeds) {
    const code = codeOf(s.subject, s.key);
    const order = (perSubject.get(s.subject) ?? 0) + 1;
    perSubject.set(s.subject, order);
    if (!COMMIT) continue;
    await ScholarshipTopic.findOneAndUpdate(
      { subject: s.subject, classLevel: CLASS_LEVEL, code },
      {
      $set: {
        labelBn: s.labelBn,
        axis: s.axis,
        chapters: [],
        // undefined is stripped from $set, so a subject with no fixed marks keeps
        // whatever it had rather than being reset to null on every re-seed.
        marks: s.marks,
        order,
        active: true,
      },
    },
      { upsert: true },
    );
    written++;
  }

  for (const [subject, n] of perSubject) console.log(`  ${subject}: ${n} topics`);
  console.log(
    COMMIT ? `wrote/updated ${written} topics` : `would write ${seeds.length} topics (dry-run)`,
  );

  if (PRUNE) {
    const subjects = [...new Set(seeds.map((s) => s.subject))];
    const n = await pruneUnseeded(subjects, seen, COMMIT);
    console.log(
      COMMIT ? `retired ${n} topics no longer seeded` : `would retire ${n} topics (dry-run)`,
    );
  }
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});

/**
 * ANSWER-LEAK CHECK for a generated scholarship paper.
 *
 * The defect it exists for, found by the owner on three papers at once: an item whose
 * answer is a FACT from the passage (true/false, "answer the questions", the Bangla
 * fill-in and MCQ) is answered outright by some OTHER item that merely needed a sentence
 * to work on — a WH-question item, a parts-of-speech item, a tense item. The student
 * never reads the passage; they read the other question.
 *
 *   tested : "Why has Rupa not borrowed any book today?"        (question 3c)
 *   carrier: "Rupa could not borrow a book because she had no library card."   (item 8d)
 *
 * The rule the papers must satisfy: **a skill item may borrow the unit's names and
 * setting, but never a fact that a passage item tests.**
 *
 * Heuristic and deliberately noisy — it reports the distinctive words two lines share and
 * leaves the judgement to a reader. A shared NAME is normal and expected; a shared name
 * plus a shared predicate is the leak. Read every pair; do not treat a clean run as
 * proof, or a flag as a verdict.
 *
 * Usage:  node skills/_tools/check_answer_leak.mjs <paper.md> [more.md ...]
 */
import { readFileSync } from "fs";

const STOP = new Set(
  `a an the of to in on at for with and or but is are was were be been being do does did done
have has had not no this that these those there here it its his her their your my you he she they
we i him them us me from by as so if then than when what which who whom whose how why where all
any each some one two three four five very much many more most other into out up down about over
under again further once own same too can will just should now write answer following sentences
sentence questions question words word marks mark`.split(/\s+/),
);
const BN_STOP = new Set(
  `এই ও এবং কিন্তু বা যে যা যার যাদের তার তাদের তিনি তারা আমি আমরা তুমি তোমরা করে করা হয় হয়েছে ছিল
আছে নেই কি কী কোন কোথায় কেন কীভাবে কারা একটি একটা নিয়ে থেকে দিয়ে জন্য সঙ্গে লেখো করো দাও নাম কে
নিচের প্রশ্নগুলোর উত্তর শব্দ বাক্য`.split(/\s+/),
);

const tok = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/\*+/g, " ")
    .replace(/[^\p{L}\p{N}ঀ-৿]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !BN_STOP.has(w));

/** Every lettered line under EVERY heading matching `re` (a question may appear twice). */
function itemLines(src, re) {
  const out = [];
  for (const m of src.matchAll(re)) {
    const rest = src.slice(m.index + m[0].length);
    const end = rest.search(/\n(###|\*\*\d|## |---)/);
    for (const l of (end === -1 ? rest : rest.slice(0, end)).split("\n")) {
      const t = l.trim();
      if (/^([a-j]|[ক-ঞ])\)/.test(t) || /^([a-j]|[ক-ঞ])\. /.test(t)) out.push(t);
    }
  }
  return out;
}

/** Items whose answer is a fact from a passage. */
const TESTED = [
  /Write True or False[^\n]*\n/g,
  /Answer the following questions in sentence\(s\)[^\n]*\n/g,
  /শূন্যস্থান পূরণ করো[^\n]*\n/g,
  /সঠিক উত্তরটি বেছে[^\n]*\n/g,
  /সংক্ষিপ্ত উত্তর দাও[^\n]*\n/g,
  /বিস্তৃত উত্তর দাও[^\n]*\n/g,
  /এক কথায় প্রকাশ[^\n]*\n/g,
];
/** Items that merely need a sentence to work on. */
const CARRIERS = [
  /Make WH questions[^\n]*\n/g,
  /Identify the Parts of Speech[^\n]*\n/g,
  /Change the tense[^\n]*\n/g,
  /correct form of the verb[^\n]*\n/g,
  /Rearrange the words[^\n]*\n/g,
  /পদ নির্ণয় করো[^\n]*\n/g,
  /ক্রিয়ার কাল পরিবর্তন[^\n]*\n/g,
  /চলিত ভাষায় লেখো[^\n]*\n/g,
];

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node skills/_tools/check_answer_leak.mjs <paper.md> [...]");
  process.exit(2);
}

let flagged = 0;
for (const file of files) {
  const full = readFileSync(file, "utf8");
  const paper = full.split(/\n# (Answer key|উত্তরমালা)/)[0];
  const tested = TESTED.flatMap((re) => itemLines(paper, re));
  const carriers = CARRIERS.flatMap((re) => itemLines(paper, re));

  const hits = [];
  for (const t of tested) {
    const a = new Set(tok(t));
    for (const c of carriers) {
      const shared = [...new Set(tok(c))].filter((w) => a.has(w));
      if (shared.length >= 2) hits.push({ t, c, shared });
    }
  }
  console.log(`\n${file}\n  ${tested.length} fact items × ${carriers.length} carrier sentences`);
  if (!tested.length || !carriers.length) {
    console.log("  !! parsed nothing on one side — the headings did not match, so this proves NOTHING");
  }
  if (!hits.length) console.log("  no overlap found");
  for (const h of hits) {
    flagged++;
    console.log(`  FLAG [${h.shared.join(", ")}]`);
    console.log(`    tested : ${h.t.slice(0, 90)}`);
    console.log(`    carrier: ${h.c.slice(0, 90)}`);
  }
}
console.log(`\n${flagged} pair(s) flagged for review across ${files.length} paper(s).`);
console.log("A shared NAME is expected. A shared name PLUS a shared predicate is the leak.");

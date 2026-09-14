/**
 * Seed the ScholarshipTopic catalogue for Class 5 (SC-0, D-#657/#665).
 *
 * TWO SOURCES, because the axis differs by subject (D-#665):
 *
 *  - **skill** (বাংলা · English · গণিত) — taken from the NAPE 2026 প্রশ্নপত্র কাঠামো
 *    (memo 38.04.0000.801.06.314.24, 08 July 2026), whose item tables for these three
 *    subjects name SKILLS. Typed here from the signed tables, because there is no other
 *    machine-readable copy of them in the repo.
 *  - **content** (প্রাথমিক বিজ্ঞান · বাংলাদেশ ও বিশ্বপরিচয়) — read from the EXISTING
 *    QUESTION BANK (`ContentArtifact`, current, class 5) so the chapter names match what
 *    the school already uses on its own questions. Their five items are formats repeated
 *    over content, so the format is not the axis — the chapter is.
 *
 * Chapter names are NEVER typed from memory for SCI/BGS. If the bank has no chapters for
 * a subject the script says so and seeds nothing for it rather than inventing a list.
 *
 * DRY-RUN by default (prints what it would write); pass --commit to write. Guarded to the
 * managed scdhub_* databases; any other db is refused.
 *
 * Usage (repo root):
 *   npx tsx server/scripts/seed-scholarship-topics.ts            # dry-run
 *   npx tsx server/scripts/seed-scholarship-topics.ts --commit   # write
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { connectDb, disconnectDb, mongoose } from "../src/db";
import { ScholarshipTopic } from "../src/modules/scholarship/models/ScholarshipTopic";
import { ContentArtifact } from "../src/modules/content/models/ContentArtifact";
import type { HwSubject, ScholarshipTopicAxis } from "@scd/shared";

const COMMIT = process.argv.includes("--commit");
const ALLOWED_DBS = ["scdhub_local", "scdhub_dev", "scdhub_prod"];
const CLASS_LEVEL = 5;

interface Seed {
  subject: HwSubject;
  labelBn: string;
  axis: ScholarshipTopicAxis;
  chapters?: number[];
}

/** English — the 14 items of the 2026 structure, collapsed to the skills they test.
 *  Items 1–2 and 3 share শব্দভাণ্ডার / পাঠ-অনুধাবন because they examine the same skill
 *  on the same passage; items 4–5 are the unseen passage, which is its own skill. */
const ENG: Seed[] = [
  { subject: "ENG", labelBn: "শব্দভাণ্ডার ও শব্দার্থ", axis: "skill" },
  { subject: "ENG", labelBn: "পাঠ্যবই — পাঠ-অনুধাবন", axis: "skill" },
  { subject: "ENG", labelBn: "অদেখা অনুচ্ছেদ", axis: "skill" },
  { subject: "ENG", labelBn: "ব্যাকরণ — parts of speech", axis: "skill" },
  { subject: "ENG", labelBn: "ব্যাকরণ — tense", axis: "skill" },
  { subject: "ENG", labelBn: "ব্যাকরণ — article", axis: "skill" },
  { subject: "ENG", labelBn: "suffix ও prefix", axis: "skill" },
  { subject: "ENG", labelBn: "WH-question তৈরি", axis: "skill" },
  { subject: "ENG", labelBn: "বাক্য ও গল্প সাজানো", axis: "skill" },
  { subject: "ENG", labelBn: "যতিচিহ্ন ও বড় হাতের অক্ষর", axis: "skill" },
  { subject: "ENG", labelBn: "ফরম পূরণ ও সংখ্যা", axis: "skill" },
  { subject: "ENG", labelBn: "ক্রিয়ার সঠিক রূপ", axis: "skill" },
  { subject: "ENG", labelBn: "চিঠি · দরখাস্ত · ইমেইল", axis: "skill" },
  { subject: "ENG", labelBn: "রচনা লিখন", axis: "skill" },
];

/** বাংলা — the 15 items of the 2026 structure. */
const BAN: Seed[] = [
  { subject: "BAN", labelBn: "কবিতা মুখস্থ লিখন", axis: "skill" },
  { subject: "BAN", labelBn: "শব্দার্থ লিখন", axis: "skill" },
  { subject: "BAN", labelBn: "বাক্য গঠন", axis: "skill" },
  { subject: "BAN", labelBn: "শূন্যস্থান পূরণ", axis: "skill" },
  { subject: "BAN", labelBn: "বহুনির্বাচনি", axis: "skill" },
  { subject: "BAN", labelBn: "বিপরীত ও সমার্থক শব্দ", axis: "skill" },
  { subject: "BAN", labelBn: "সংক্ষিপ্ত-উত্তর প্রশ্ন", axis: "skill" },
  { subject: "BAN", labelBn: "বিস্তৃত-উত্তর প্রশ্ন", axis: "skill" },
  { subject: "BAN", labelBn: "মূলভাব লিখন", axis: "skill" },
  { subject: "BAN", labelBn: "ভাষারীতি · পদ নির্ণয় · ক্রিয়ার কাল", axis: "skill" },
  { subject: "BAN", labelBn: "প্রশ্ন তৈরিকরণ ও বিরামচিহ্ন", axis: "skill" },
  { subject: "BAN", labelBn: "যুক্তবর্ণ বিভাজন ও শব্দ গঠন", axis: "skill" },
  { subject: "BAN", labelBn: "এককথায় প্রকাশ", axis: "skill" },
  { subject: "BAN", labelBn: "ফরম পূরণ ও আবেদনপত্র", axis: "skill" },
  { subject: "BAN", labelBn: "রচনা লিখন", axis: "skill" },
];

/** গণিত — items 4–11 of the 2026 structure name the topic outright; items 1–3 are
 *  format rows spanning the syllabus, kept as one general skill each. */
const MATH: Seed[] = [
  { subject: "MATH", labelBn: "বহুনির্বাচনি", axis: "skill" },
  { subject: "MATH", labelBn: "শূন্যস্থান পূরণ", axis: "skill" },
  { subject: "MATH", labelBn: "সংক্ষিপ্ত উত্তর", axis: "skill" },
  { subject: "MATH", labelBn: "চার প্রক্রিয়া", axis: "skill" },
  { subject: "MATH", labelBn: "লসাগু ও গসাগু", axis: "skill" },
  { subject: "MATH", labelBn: "সাধারণ ও দশমিক ভগ্নাংশ", axis: "skill" },
  { subject: "MATH", labelBn: "শতকরা", axis: "skill" },
  { subject: "MATH", labelBn: "গড়", axis: "skill" },
  { subject: "MATH", labelBn: "পরিমাপ", axis: "skill" },
  { subject: "MATH", labelBn: "জ্যামিতি", axis: "skill" },
  { subject: "MATH", labelBn: "উপাত্ত বিন্যস্তকরণ", axis: "skill" },
];

function slug(labelBn: string): string {
  return (
    labelBn
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "T"
  );
}

function codeOf(subject: HwSubject, labelBn: string, seq: number): string {
  const s = slug(labelBn);
  // A Bangla-only label slugs to the empty string, so fall back to the position — the
  // code must be stable and unique, and it is never shown to a user.
  return `TOP-SCH-${subject}-C${CLASS_LEVEL}-${s === "T" ? String(seq).padStart(2, "0") : s}`;
}

/** The chapters the question bank actually holds for this subject at class 5. Returns
 *  [] when the bank has none — the caller then seeds nothing rather than inventing. */
async function chaptersFromBank(subject: HwSubject): Promise<{ num: number; title: string }[]> {
  const rows = (await ContentArtifact.find({
    subject,
    classLevel: CLASS_LEVEL,
    current: true,
    retiredAt: null,
  })
    .select("address")
    .lean()) as { address?: { number?: number | string; title?: string } }[];

  const byNum = new Map<number, string>();
  for (const r of rows) {
    const raw = r.address?.number;
    const num = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(num) || num < 1) continue;
    const title = (r.address?.title ?? "").trim();
    // Keep the first non-empty title we see for a chapter; the bank repeats it per item.
    if (title && !byNum.get(num)) byNum.set(num, title);
    else if (!byNum.has(num)) byNum.set(num, "");
  }
  return [...byNum.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([num, title]) => ({ num, title }));
}

async function main(): Promise<void> {
  await connectDb();
  const dbName = mongoose.connection.db?.databaseName ?? "";
  if (!ALLOWED_DBS.includes(dbName)) {
    throw new Error(`Refusing to touch database "${dbName}" — expected one of ${ALLOWED_DBS.join(", ")}`);
  }
  console.log(`db: ${dbName} · ${COMMIT ? "COMMIT" : "DRY-RUN"}`);

  const seeds: Seed[] = [...ENG, ...BAN, ...MATH];

  for (const subject of ["SCI", "BGS"] as HwSubject[]) {
    const chapters = await chaptersFromBank(subject);
    if (chapters.length === 0) {
      console.log(
        `  ${subject}: the question bank holds no class-${CLASS_LEVEL} chapters — seeding NOTHING ` +
          `for it rather than typing a chapter list from memory (D-#665). Import its questions first, ` +
          `or add its topics by hand in the app.`,
      );
      continue;
    }
    for (const c of chapters) {
      seeds.push({
        subject,
        labelBn: c.title ? `অধ্যায় ${c.num} — ${c.title}` : `অধ্যায় ${c.num}`,
        axis: "content",
        chapters: [c.num],
      });
    }
    console.log(`  ${subject}: ${chapters.length} chapters from the question bank`);
  }

  let written = 0;
  const perSubject = new Map<string, number>();
  for (const [i, s] of seeds.entries()) {
    const code = codeOf(s.subject, s.labelBn, i + 1);
    perSubject.set(s.subject, (perSubject.get(s.subject) ?? 0) + 1);
    if (!COMMIT) continue;
    await ScholarshipTopic.findOneAndUpdate(
      { subject: s.subject, classLevel: CLASS_LEVEL, code },
      {
        $set: {
          labelBn: s.labelBn,
          axis: s.axis,
          chapters: s.chapters ?? [],
          order: perSubject.get(s.subject) ?? 0,
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
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});

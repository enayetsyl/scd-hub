/**
 * Seed the HomeworkTopic catalog (the per-(subject, class) topic picker teachers
 * choose from when declaring homework) from the locked lesson-plan chapter plans.
 *
 * Each chapter plan carries `subject`, `class_level`, `division.{number,title}` and
 * `chapter_plan.spine.homework.topic_tag`. A topic tag groups several chapters, so we
 * collapse to one catalog row per (subject, class, topic_tag) with the chapters it
 * spans. We also add a generic "সাধারণ" fallback per (subject, class) in HW_SUBJECTS
 * × C1–C5 so every combination always has at least one selectable topic.
 *
 * DRY-RUN by default (prints what it would write); pass --commit to write. Guarded to
 * the managed scdhub_* DBs (chosen by MONGODB_URI); any other db is refused.
 *
 * Usage (repo root):
 *   npx tsx server/scripts/seed-homework-topics.ts                 # dry-run, local
 *   npx tsx server/scripts/seed-homework-topics.ts --commit        # write, local
 *   PLANS_DIR="C:/path/to/Lesson Plan V2" npx tsx ... --commit     # custom source
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { connectDb, disconnectDb, mongoose } from "../src/db";
import { HomeworkTopic } from "../src/modules/trackers/models/HomeworkTopic";
import { HW_SUBJECTS } from "@scd/shared";

const COMMIT = process.argv.includes("--commit");
const ALLOWED_DBS = ["scdhub_local", "scdhub_dev", "scdhub_prod"];
const PLANS_DIR = process.env.PLANS_DIR ?? "c:/Users/HP/Downloads/Lesson Plan V2";
const CLASS_LEVELS = [1, 2, 3, 4, 5];

const bn = (n: number): string => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const orderOf = (code: string): number => {
  const m = code.match(/-(\d+)$/);
  return m ? Number(m[1]) : 9000;
};

interface Topic {
  classLevel: number;
  subject: string;
  code: string;
  chapters: { num: number; titleBn: string }[];
}

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".json")) out.push(p);
  }
}

function labelFor(chapters: { num: number; titleBn: string }[]): string {
  // De-dup chapter titles, list up to 4, append "…+N" when longer.
  const titles = [...new Set(chapters.map((c) => c.titleBn))];
  const head = titles.slice(0, 4).join(" · ");
  return titles.length > 4 ? `${head} …+${bn(titles.length - 4)}` : head;
}

async function main(): Promise<void> {
  console.log(COMMIT ? "Mode: COMMIT\n" : "Mode: DRY-RUN (pass --commit to write)\n");
  await connectDb();
  const dbName = mongoose.connection.name;
  console.log("DB:", dbName);
  if (!ALLOWED_DBS.includes(dbName)) {
    console.error(`ABORT: only runs against ${ALLOWED_DBS.join(", ")}`);
    await disconnectDb();
    process.exit(1);
  }

  if (!fs.existsSync(PLANS_DIR)) {
    console.error(`ABORT: lesson-plan folder not found: ${PLANS_DIR} (set PLANS_DIR)`);
    await disconnectDb();
    process.exit(1);
  }

  // --- parse plans -> distinct topics ---
  const files: string[] = [];
  walk(PLANS_DIR, files);
  const byKey = new Map<string, Topic>(); // `${subject}|${cl}|${code}`
  let withTag = 0;
  let noTag = 0;
  for (const f of files) {
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      continue;
    }
    const subject = String((j as { subject?: string }).subject ?? "");
    const cl = Number((j as { class_level?: number }).class_level ?? 0);
    if (!(HW_SUBJECTS as readonly string[]).includes(subject) || !CLASS_LEVELS.includes(cl)) continue;
    const cp = (j as { chapter_plan?: { spine?: { homework?: { topic_tag?: string } } } }).chapter_plan;
    const tag = cp?.spine?.homework?.topic_tag ?? null;
    const div = (j as { division?: { number?: number; title?: string } }).division ?? {};
    const chapter = { num: Number(div.number ?? 0), titleBn: String(div.title ?? "").trim() };
    if (!tag) { noTag++; continue; }
    withTag++;
    const key = `${subject}|${cl}|${tag}`;
    if (!byKey.has(key)) byKey.set(key, { classLevel: cl, subject, code: tag, chapters: [] });
    const t = byKey.get(key)!;
    if (chapter.titleBn && !t.chapters.some((c) => c.num === chapter.num && c.titleBn === chapter.titleBn)) {
      t.chapters.push(chapter);
    }
  }

  const topics = [...byKey.values()].map((t) => ({
    ...t,
    chapters: t.chapters.sort((a, b) => a.num - b.num),
    labelBn: labelFor(t.chapters),
    order: orderOf(t.code),
    source: "lesson_plan" as const,
  }));

  // --- generic fallback per (subject, class) ---
  const generic = [];
  for (const subject of HW_SUBJECTS) {
    for (const cl of CLASS_LEVELS) {
      generic.push({
        classLevel: cl,
        subject,
        code: `TOP-${subject}-C${cl}-GEN`,
        labelBn: "সাধারণ (নির্দিষ্ট অধ্যায় নয়)",
        chapters: [] as { num: number; titleBn: string }[],
        order: 9999,
        source: "generic" as const,
      });
    }
  }

  const all = [...topics, ...generic];

  // --- report ---
  console.log(`\nScanned ${files.length} plan files: ${withTag} with a topic_tag, ${noTag} without.`);
  console.log(`Curriculum topics: ${topics.length}; generic fallbacks: ${generic.length}; total upserts: ${all.length}.\n`);
  const bySC = new Map<string, number>();
  for (const t of topics) bySC.set(`C${t.classLevel} ${t.subject}`, (bySC.get(`C${t.classLevel} ${t.subject}`) ?? 0) + 1);
  for (const [k, n] of [...bySC.entries()].sort()) console.log(`   ${k.padEnd(10)} ${n} topics`);
  console.log("\nSample labels:");
  for (const t of topics.slice(0, 6)) console.log(`   ${t.code.padEnd(16)} ${t.labelBn}`);

  if (!COMMIT) {
    console.log("\nDRY-RUN — nothing written. Re-run with --commit to apply.");
    await disconnectDb();
    process.exit(0);
  }

  let up = 0;
  for (const t of all) {
    await HomeworkTopic.updateOne(
      { subject: t.subject, classLevel: t.classLevel, code: t.code },
      { $set: { labelBn: t.labelBn, chapters: t.chapters, order: t.order, active: true, source: t.source } },
      { upsert: true },
    );
    up++;
  }
  console.log(`\nUpserted ${up} topic rows into ${dbName}.`);
  await disconnectDb();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

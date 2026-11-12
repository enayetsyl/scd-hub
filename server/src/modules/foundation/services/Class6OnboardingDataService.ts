/**
 * YC-3 (docs/prd-year-change.md §4, D-#1483): the data prod needs before a Class 6 section can be
 * given a routine, grants and homework. Additive and idempotent — it only ADDS what is missing and
 * never changes or removes an existing row, so a second run writes 0.
 *
 *   1. `Subject` rows for every FOUNDATION_SUBJECTS code that has none (ICT, BAN2, ENG2 on prod).
 *      A routine teaching grant binds a Subject row; without one the grant is silently skipped.
 *   2. Class 6 in the `class_1_5` period grid's `classLevels` (every season). Class 6 keeps the
 *      Class 1–5 day (owner ruling Q3/Q18); the guardian / observation period times look the
 *      level up in `classLevels`.
 *   3. The generic "সাধারণ" homework topic `TOP-{SUBJECT}-C6-GEN` per homework subject, as
 *      `seed-homework-topics.ts` writes for Classes 1–5.
 *
 * Runs through `server/scripts/class6-onboarding-data.ts` (dry run by default, `--apply` writes).
 */
import { HW_SUBJECTS, HW_SUBJECT_LABELS_BN, classToken, subjectsForClassLevel } from "@scd/shared";
import { Subject, FOUNDATION_SUBJECTS } from "../models/Subject";
import { PeriodGrid } from "../../routine/models/PeriodGrid";
import { HomeworkTopic } from "../../trackers/models/HomeworkTopic";

export const CLASS6_LEVEL = 6;
/** The period grid Class 6 shares with Classes 1–5 (`slotView.audienceForLevel`). */
export const CLASS6_GRID_AUDIENCE = "class_1_5";
export const GENERIC_TOPIC_LABEL_BN = "সাধারণ (নির্দিষ্ট অধ্যায় নয়)";

export interface Class6DataPlanRow {
  kind: "SUBJECT" | "PERIOD_GRID" | "HOMEWORK_TOPIC";
  /** What the row is, in one line (printed by the script). */
  line: string;
}

export interface Class6DataResult {
  apply: boolean;
  planned: Class6DataPlanRow[];
  written: number;
  /** Things the script could not do and will not guess (printed, never fixed silently). */
  notes: string[];
}

export async function class6OnboardingData(opts: { apply: boolean }): Promise<Class6DataResult> {
  const planned: Class6DataPlanRow[] = [];
  const notes: string[] = [];
  let written = 0;

  // --- 1. Subject rows ----------------------------------------------------------------------
  const haveSubjects = new Set(
    ((await Subject.find({}).select("code active").lean()) as unknown as Array<{ code: string; active?: boolean }>).map(
      (s) => {
        if (s.active === false) notes.push(`Subject ${s.code} exists but is inactive — left as it is.`);
        return s.code;
      },
    ),
  );
  for (const code of FOUNDATION_SUBJECTS) {
    if (haveSubjects.has(code)) continue;
    const nameBn = (HW_SUBJECT_LABELS_BN as Record<string, string>)[code] ?? code;
    planned.push({ kind: "SUBJECT", line: `Subject ${code} "${nameBn}"` });
    if (opts.apply) {
      // updateOne + $setOnInsert: a concurrent or repeated run cannot create a duplicate.
      const r = await Subject.updateOne({ code }, { $setOnInsert: { code, nameBn, active: true } }, { upsert: true });
      written += r.upsertedCount;
    }
  }

  // --- 2. Period grid -----------------------------------------------------------------------
  const grids = (await PeriodGrid.find({ audienceKey: CLASS6_GRID_AUDIENCE })
    .select("season classLevels")
    .lean()) as unknown as Array<{ _id: unknown; season: string; classLevels?: number[] }>;
  if (grids.length === 0) notes.push(`No "${CLASS6_GRID_AUDIENCE}" period grid exists — nothing to widen (not created).`);
  for (const g of grids) {
    if ((g.classLevels ?? []).includes(CLASS6_LEVEL)) continue;
    planned.push({
      kind: "PERIOD_GRID",
      line: `PeriodGrid ${CLASS6_GRID_AUDIENCE}/${g.season}: classLevels [${(g.classLevels ?? []).join(",")}] + ${CLASS6_LEVEL}`,
    });
    if (opts.apply) {
      const r = await PeriodGrid.updateOne({ _id: g._id }, { $addToSet: { classLevels: CLASS6_LEVEL } });
      written += r.modifiedCount;
    }
  }

  // --- 3. Generic Class 6 homework topics ---------------------------------------------------
  const token = classToken(CLASS6_LEVEL);
  for (const subject of subjectsForClassLevel(HW_SUBJECTS, CLASS6_LEVEL)) {
    const code = `TOP-${subject}-${token}-GEN`;
    const exists = await HomeworkTopic.exists({ subject, classLevel: CLASS6_LEVEL, code });
    if (exists) continue;
    planned.push({ kind: "HOMEWORK_TOPIC", line: `HomeworkTopic ${code} "${GENERIC_TOPIC_LABEL_BN}"` });
    if (opts.apply) {
      const r = await HomeworkTopic.updateOne(
        { subject, classLevel: CLASS6_LEVEL, code },
        {
          $setOnInsert: {
            subject,
            classLevel: CLASS6_LEVEL,
            code,
            labelBn: GENERIC_TOPIC_LABEL_BN,
            chapters: [],
            order: 9999,
            active: true,
            source: "generic",
          },
        },
        { upsert: true },
      );
      written += r.upsertedCount;
    }
  }

  return { apply: opts.apply, planned, written, notes };
}

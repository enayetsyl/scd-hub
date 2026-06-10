/**
 * Load the real student roster into MongoDB from the normalized JSON produced by
 * extract-students.py. Identity-plane operational data (D-#31).
 *
 * Run from repo root (after extract-students.py has written students.json):
 *   npx tsx server/scripts/import-students.ts            # dry-run: counts only, no writes
 *   npx tsx server/scripts/import-students.ts --commit   # actually upsert into Atlas
 *
 * Loads the repo-root .env (MONGODB_URI / JWT_SECRET).
 *
 * IDEMPOTENT and NON-DESTRUCTIVE: upserts by stable keys (Student.schoolId,
 * Class.level+year, Section.classId+code, Guardian.identifier, GuardianLink pair).
 * Unlike seed.ts it NEVER clears a collection — safe to re-run against live data.
 */
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { connectDb, disconnectDb } from "../src/db";
import { AcademicYear } from "../src/modules/foundation/models/AcademicYear";
import { Class } from "../src/modules/foundation/models/Class";
import { Section } from "../src/modules/foundation/models/Section";
import { Student } from "../src/modules/foundation/models/Student";
import { Guardian } from "../src/modules/foundation/models/Guardian";
import { GuardianLink } from "../src/modules/foundation/models/GuardianLink";
import {
  ROSTER_CLASS_LABELS_BN,
  DEFAULT_SECTION_CODE,
  DEFAULT_SECTION_LABEL_BN,
  type RosterClassLevel,
} from "@scd/shared";
import type { Types } from "mongoose";

const COMMIT = process.argv.includes("--commit");

type GuardianRec = { relation: string; name: string | null; phone: string | null };
type StudentRec = {
  schoolId: string;
  name: string;
  nameBn: string | null;
  classLevel: number;
  section: string | null;
  gender: "male" | "female" | "other" | null;
  dob: string | null;
  phone: string | null;
  address: string | null;
  bloodGroup: string | null;
  guardians: GuardianRec[];
};

// Section "Boys"/"Girls" from source -> {code, Bangla label}; blank -> default Main.
const SECTION_LABELS_BN: Record<string, string> = { Boys: "বালক", Girls: "বালিকা" };
function sectionFor(raw: string | null): { code: string; nameBn: string } {
  if (raw && SECTION_LABELS_BN[raw]) return { code: raw, nameBn: SECTION_LABELS_BN[raw] };
  return { code: DEFAULT_SECTION_CODE, nameBn: DEFAULT_SECTION_LABEL_BN };
}

async function main(): Promise<void> {
  const jsonPath = path.resolve(__dirname, "students.json");
  if (!fs.existsSync(jsonPath)) {
    console.error(`Missing ${jsonPath} — run extract-students.py first.`);
    process.exit(1);
  }
  const { students } = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as { students: StudentRec[] };
  console.log(`Loaded ${students.length} students from JSON.`);
  console.log(COMMIT ? "Mode: COMMIT (writing to DB)" : "Mode: DRY-RUN (no writes; pass --commit to write)\n");

  await connectDb();

  // --- Academic year: use the current one, or create 2026 ------------------
  let year = await AcademicYear.findOne({ current: true });
  if (!year) {
    console.log("No current AcademicYear found; will use/create '2026'.");
    if (COMMIT) {
      year = await AcademicYear.findOneAndUpdate(
        { label: "2026" },
        { $setOnInsert: { startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), current: true } },
        { upsert: true, new: true },
      );
    }
  }
  const yearId = year?._id as Types.ObjectId | undefined;
  console.log(`Academic year: ${year ? `${year.label} (${yearId})` : "(would create 2026)"}\n`);

  // --- Classes (distinct roster levels) ------------------------------------
  const levels = [...new Set(students.map((s) => s.classLevel))].sort((a, b) => a - b);
  const classByLevel = new Map<number, Types.ObjectId>();
  for (const level of levels) {
    const nameBn = ROSTER_CLASS_LABELS_BN[level as RosterClassLevel] ?? `level ${level}`;
    const count = students.filter((s) => s.classLevel === level).length;
    if (COMMIT && yearId) {
      const cls = await Class.findOneAndUpdate(
        { level, academicYearId: yearId },
        { $setOnInsert: { level, academicYearId: yearId, nameBn, active: true } },
        { upsert: true, new: true },
      );
      classByLevel.set(level, cls._id);
    }
    console.log(`Class level ${String(level).padStart(2)} "${nameBn}" — ${count} students`);
  }

  // --- Sections (distinct class+section pairs) -----------------------------
  const sectionKey = (level: number, code: string) => `${level}|${code}`;
  const sectionByKey = new Map<string, Types.ObjectId>();
  for (const s of students) {
    const { code, nameBn } = sectionFor(s.section);
    const key = sectionKey(s.classLevel, code);
    if (sectionByKey.has(key)) continue;
    const classId = classByLevel.get(s.classLevel);
    if (COMMIT && classId) {
      const sec = await Section.findOneAndUpdate(
        { classId, code },
        { $setOnInsert: { classId, code, nameBn, active: true } },
        { upsert: true, new: true },
      );
      sectionByKey.set(key, sec._id);
    } else {
      sectionByKey.set(key, undefined as unknown as Types.ObjectId);
    }
  }
  console.log(`\nSections: ${sectionByKey.size} distinct class/section pairs`);

  // --- Guardians (dedup by identifier) + GuardianLinks ---------------------
  // Phone-bearing contacts dedup across siblings; phoneless contacts key on schoolId+relation.
  const guardianByIdentifier = new Map<string, Types.ObjectId>();
  let guardianContacts = 0;
  let links = 0;

  // --- Students -------------------------------------------------------------
  let upserted = 0;
  for (const s of students) {
    const { code } = sectionFor(s.section);
    const classId = classByLevel.get(s.classLevel);
    const sectionId = sectionByKey.get(sectionKey(s.classLevel, code));

    if (COMMIT && classId && sectionId) {
      const doc = await Student.findOneAndUpdate(
        { schoolId: s.schoolId },
        {
          $set: {
            name: s.name,
            nameBn: s.nameBn ?? undefined,
            classId,
            sectionId,
            gender: s.gender ?? undefined,
            dob: s.dob ? new Date(s.dob) : undefined,
            phone: s.phone ?? undefined,
            address: s.address ?? undefined,
            bloodGroup: s.bloodGroup ?? undefined,
            active: true,
          },
        },
        { upsert: true, new: true },
      );
      upserted++;

      for (const g of s.guardians) {
        const identifierKind = g.phone ? "phone" : "school_id";
        const identifier = g.phone ?? `${s.schoolId}:${g.relation}`;
        const ikey = `${identifierKind}:${identifier}`;
        let guardianId = guardianByIdentifier.get(ikey);
        if (!guardianId) {
          const gd = await Guardian.findOneAndUpdate(
            { identifierKind, identifier },
            {
              $set: { name: g.name ?? g.relation, phone: g.phone ?? undefined },
              $setOnInsert: { loginEnabled: false, active: true },
            },
            { upsert: true, new: true },
          );
          guardianId = gd._id;
          guardianByIdentifier.set(ikey, guardianId);
          guardianContacts++;
        }
        // Link (idempotent on the unique guardian+student pair).
        await GuardianLink.updateOne(
          { guardianId, studentId: doc._id },
          { $setOnInsert: { guardianId, studentId: doc._id, relation: g.relation } },
          { upsert: true },
        );
        links++;
      }
    } else {
      // dry-run accounting
      for (const g of s.guardians) {
        const ikey = g.phone ? `phone:${g.phone}` : `school_id:${s.schoolId}:${g.relation}`;
        if (!guardianByIdentifier.has(ikey)) {
          guardianByIdentifier.set(ikey, undefined as unknown as Types.ObjectId);
          guardianContacts++;
        }
        links++;
      }
      upserted++;
    }
  }

  console.log(`\n${COMMIT ? "Upserted" : "Would upsert"}:`);
  console.log(`  Students:        ${upserted}`);
  console.log(`  Classes:         ${levels.length}`);
  console.log(`  Sections:        ${sectionByKey.size}`);
  console.log(`  Guardians:       ${guardianContacts} (deduped from ${students.reduce((n, s) => n + s.guardians.length, 0)} contacts)`);
  console.log(`  GuardianLinks:   ${links}`);
  if (!COMMIT) console.log("\nDRY-RUN complete — no data written. Re-run with --commit to apply.");

  await disconnectDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});

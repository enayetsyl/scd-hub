/**
 * Seed the weekly class routine from the root Excel (Class_Routine_Combined_V9.xlsx).
 *
 * Idempotent. DRY-RUN by default (prints the full mapping + groups + any conflicts,
 * writes nothing); pass --commit to write. Hard guard: only runs against `scdhub_local`.
 *
 * Model (PRD §4.3, D-#48/#56): GENERAL subjects run against the foundation `Section`;
 * QURAN/ARABIC run against a cross-grade `SubjectGroup` named by LEVEL. So for Class 1–5,
 * the P1–P3 cells become subjectgroup slots:
 *   - P1/P2 (Quran)  → Quran group  (Qaida/Ammapara/Najera/Hifz 1/Hifz 3) — subject QURAN
 *   - P3   (Arabic)  → Arabic group (Book 1/Book 2/Book 3/Quranic Arabic) — subject ARABIC
 * Everything else (Class 1–5 P5–P8 general; ALL Nursery/KG periods) stays on the `Section`.
 *
 * Owner decisions (2026-06-16):
 *   - Gender split ONLY where the sheet splits: Book 2 → two groups (Girls/Boys); all
 *     other levels = one `mixed` group.
 *   - Nursery/KG Quran-Arabic stay on the Section (not a level group).
 *   - No memberships seeded (empty groups).
 *   - Sections: Nursery/KG/Class1/Class2 → "Main"; Class3/4/5 → "ALL".
 *   - Tiffin (P4) = break, lives in the grid, not a slot. "Performance (Ban/Eng/Arabic)" → BAN.
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import ExcelJS from "exceljs";
import { connectDb, disconnectDb, mongoose } from "../src/db";
import { Class } from "../src/modules/foundation/models/Class";
import { Section } from "../src/modules/foundation/models/Section";
import { User } from "../src/modules/foundation/models/User";
import { AcademicYear } from "../src/modules/foundation/models/AcademicYear";
import { RoutineSlot } from "../src/modules/routine/models/RoutineSlot";
import { PeriodGrid } from "../src/modules/routine/models/PeriodGrid";
import { ScheduleWindow } from "../src/modules/routine/models/ScheduleWindow";
import { SubjectGroup } from "../src/modules/routine/models/SubjectGroup";
import { Subject } from "../src/modules/foundation/models/Subject";
import { ScopeGrant } from "../src/modules/foundation/models/ScopeGrant";
import { SUBJECTS } from "@scd/shared";
import type { RoutineSubject, PeriodTrack, DayOfWeek, GroupGender } from "@scd/shared";

const COMMIT = process.argv.includes("--commit");
const XLSX = path.resolve(__dirname, "../../Class_Routine_Combined_V9.xlsx");
const ALLOWED_DB = "scdhub_local";

const DAY_MAP: Record<string, DayOfWeek> = { sunday: "SUN", monday: "MON", tuesday: "TUE", wednesday: "WED", thursday: "THU" };
const TEACHER_SHORT = ["Hamida", "Sajeda", "Jerin", "Fida", "Tamany", "Akbor", "Afia", "Mariam", "Momin", "Maruf", "Mahzabin", "A. Kuddus", "Kawsar", "Mahfuj", "Tazkir", "Sarah"];
const lastTok = (s: string): string => s.replace(/\./g, "").trim().split(/\s+/).pop()!.toLowerCase();

/** raw subject text → enum. Book 1/2/3 are the ARABIC track (D-#56), NOT Quran. */
function mapSubject(raw: string): { subject: RoutineSubject | null; note?: string } {
  const s = raw.trim();
  if (/^performance/i.test(s)) {
    const named = s.match(/performance\s*:\s*([a-z]+)/i);
    if (named) return mapSubject(named[1]);
    return { subject: "BAN", note: `ambiguous performance "${s}" → BAN` };
  }
  const l = s.toLowerCase();
  if (l.includes("bangla")) return { subject: "BAN" };
  if (l.includes("math")) return { subject: "MATH" };
  if (l.includes("english")) return { subject: "ENG" };
  if (l.includes("science")) return { subject: "SCI" };
  if (l.includes("bgs")) return { subject: "BGS" };
  if (l.includes("quranic arabic") || l.includes("arabic") || l.includes("book")) return { subject: "ARABIC" };
  if (l.includes("deen") || l.includes("islam")) return { subject: "ISLAM" };
  if (/quran|qaida|ammapara|najera|hifz/.test(l)) return { subject: "QURAN" };
  return { subject: null, note: `UNMAPPED subject "${s}"` };
}
const trackOf = (s: RoutineSubject): PeriodTrack => (s === "QURAN" ? "quran" : s === "ARABIC" ? "arabic" : "general");

/** A Quran/Arabic cell's LEVEL + gender (the group identity), e.g. "Book 2 (Girls)" → {Book 2, girls}. */
function parseLevelGender(rawSubject: string): { level: string; gender: GroupGender } {
  let s = rawSubject.trim();
  let gender: GroupGender = "mixed";
  const g = s.match(/\((girls?|boys?)\)/i);
  if (g) { gender = g[1].toLowerCase().startsWith("girl") ? "girls" : "boys"; s = s.replace(/\s*\([^)]*\)/g, "").trim(); }
  return { level: s, gender };
}
const BN_LEVEL: Record<string, string> = {
  Qaida: "কায়দা", Ammapara: "আম্মাপারা", Najera: "নাজেরা", "Hifz 1": "হিফজ ১", "Hifz 2": "হিফজ ২", "Hifz 3": "হিফজ ৩",
  "Book 1": "বুক ১", "Book 2": "বুক ২", "Book 3": "বুক ৩", "Quranic Arabic": "কুরআনিক আরবি",
};
const GENDER_BN: Record<GroupGender, string> = { girls: " (বালিকা)", boys: " (বালক)", mixed: "" };
const groupCode = (track: PeriodTrack, level: string, gender: GroupGender): string =>
  `${track}_${level}_${gender}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/_+$/g, "");

interface Slot {
  block: string; classLevel: number; day: DayOfWeek; periodNumber: number;
  rawSubject: string; rawTeacher: string; subject: RoutineSubject; track: PeriodTrack; teacherShort: string;
  kind: "section" | "subjectgroup"; sectionCode?: string; groupKey?: string; level?: string; gender?: GroupGender;
}

async function main(): Promise<void> {
  console.log(COMMIT ? "Mode: COMMIT\n" : "Mode: DRY-RUN (pass --commit to write)\n");
  await connectDb();
  const dbName = mongoose.connection.name;
  console.log("DB:", dbName);
  if (dbName !== ALLOWED_DB) { console.error(`ABORT: only runs against ${ALLOWED_DB}`); await disconnectDb(); process.exit(1); }

  const principal = await User.findOne({ role: "PRINCIPAL", active: true }).lean();
  const year = (await AcademicYear.findOne({ current: true }).lean()) ?? (await AcademicYear.findOne({}).lean());
  if (!principal || !year) { console.error("missing principal/year"); await disconnectDb(); process.exit(1); }
  const effectiveFrom = year.startDate ? new Date(year.startDate) : new Date("2026-01-01");

  const classes = await Class.find({}).lean();
  const sections = await Section.find({}).lean();
  const users = await User.find({ active: true }).select("name role").lean();
  const classByLevel = new Map(classes.map((c) => [c.level, c]));
  const sectionOf = (level: number, code: string) => {
    const cls = classByLevel.get(level); if (!cls) return null;
    return sections.find((s) => String(s.classId) === String(cls._id) && s.code === code) ?? null;
  };
  const teacherIdOf = new Map<string, string>();
  for (const short of TEACHER_SHORT) {
    const hit = users.filter((u) => u.name.toLowerCase().includes(lastTok(short)));
    if (hit.length === 1) teacherIdOf.set(short, hit[0]._id.toString());
  }
  const sectionCodeFor = (level: number) => (level >= 3 ? "ALL" : "Main");
  // Class 1–5 P1–P3 are the Quran/Arabic level periods (→ SubjectGroup). Everything else → Section.
  const isGroupPeriod = (level: number, period: number) => level >= 1 && level <= 5 && period <= 3;

  // --- parse ---
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);
  const ws = wb.worksheets[0];
  const cellStr = (r: number, c: number): string => {
    const v = ws.getRow(r).getCell(c).value;
    if (v == null) return "";
    if (typeof v === "object" && "richText" in (v as object)) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
    return String(v).trim();
  };
  const blockLevel = (name: string): number | null => {
    const n = name.trim().toLowerCase();
    if (n === "nursery") return -1; if (n === "kg") return 0;
    const m = n.match(/^class\s*(\d+)$/); return m ? Number(m[1]) : null;
  };

  const slots: Slot[] = [];
  const groups = new Map<string, { track: PeriodTrack; level: string; gender: GroupGender; code: string; nameBn: string }>();
  const flags: string[] = [];
  let curLevel: number | null = null, curBlock = "";

  for (let r = 1; r <= ws.rowCount; r++) {
    const c1 = cellStr(r, 1);
    if (!c1) continue;
    const lvl = blockLevel(c1);
    if (lvl !== null) { curLevel = lvl; curBlock = c1.trim(); continue; }
    if (c1.toLowerCase() === "day") continue;
    const day = DAY_MAP[c1.toLowerCase()];
    if (!day || curLevel === null) continue;

    const seenGroupKeyPeriod = new Set<string>();
    for (let col = 2; col <= ws.columnCount; col++) {
      const periodNumber = col - 1;
      const raw = cellStr(r, col);
      if (!raw || /^tiffin$/i.test(raw)) continue;
      for (const line of raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
        const parts = line.split(/\s+-\s+/);
        const rawSubject = (parts[0] ?? "").trim();
        const rawTeacher = parts.slice(1).join(" - ").trim();
        const { subject, note } = mapSubject(rawSubject);
        if (note) flags.push(`${curBlock} ${day} P${periodNumber}: ${note}`);
        if (!subject) continue;
        const tShort = TEACHER_SHORT.find((s) => rawTeacher.toLowerCase() === s.toLowerCase()) ?? rawTeacher;
        if (!teacherIdOf.has(tShort)) flags.push(`${curBlock} ${day} P${periodNumber}: teacher "${rawTeacher}" UNRESOLVED`);
        const track = trackOf(subject);

        if (isGroupPeriod(curLevel, periodNumber)) {
          const { level, gender } = parseLevelGender(rawSubject);
          const code = groupCode(track, level, gender);
          if (!groups.has(code)) groups.set(code, { track, level, gender, code, nameBn: (BN_LEVEL[level] ?? level) + GENDER_BN[gender] });
          const gk = `${code}|${day}|P${periodNumber}`;
          if (seenGroupKeyPeriod.has(gk)) { flags.push(`${curBlock} ${day} P${periodNumber}: duplicate group slot "${line}" dropped`); continue; }
          seenGroupKeyPeriod.add(gk);
          slots.push({ block: curBlock, classLevel: curLevel, day, periodNumber, rawSubject, rawTeacher, subject, track, teacherShort: tShort, kind: "subjectgroup", groupKey: code, level, gender });
        } else {
          const sk = `section|${day}|P${periodNumber}`;
          if (seenGroupKeyPeriod.has(sk)) { flags.push(`${curBlock} ${day} P${periodNumber}: extra section slot "${line}" dropped`); continue; }
          seenGroupKeyPeriod.add(sk);
          slots.push({ block: curBlock, classLevel: curLevel, day, periodNumber, rawSubject, rawTeacher, subject, track, teacherShort: tShort, kind: "section", sectionCode: sectionCodeFor(curLevel) });
        }
      }
    }
  }

  // teacher double-book detection (same teacher, day+period, anywhere)
  const tdp = new Map<string, Slot[]>();
  for (const s of slots) { if (!teacherIdOf.has(s.teacherShort)) continue; const k = `${s.teacherShort}|${s.day}|P${s.periodNumber}`; (tdp.get(k) ?? tdp.set(k, []).get(k)!).push(s); }
  const conflicts = [...tdp.values()].filter((v) => v.length > 1);

  // --- report ---
  const secSlots = slots.filter((s) => s.kind === "section"), grpSlots = slots.filter((s) => s.kind === "subjectgroup");
  console.log(`\nParsed ${slots.length} slots: ${secSlots.length} section + ${grpSlots.length} subjectgroup.`);
  console.log(`\nSubjectGroups to create (${groups.size}):`);
  for (const g of groups.values()) console.log(`  [${g.track}] ${g.level}${g.gender !== "mixed" ? ` (${g.gender})` : ""}  code=${g.code}  ${g.nameBn}`);
  console.log("\nSubjectgroup slots by group:");
  const byGroup = new Map<string, number>();
  for (const s of grpSlots) byGroup.set(s.groupKey!, (byGroup.get(s.groupKey!) ?? 0) + 1);
  for (const [code, n] of byGroup) console.log(`  ${code.padEnd(28)} ${n}`);
  const subjCount = new Map<string, number>();
  for (const s of slots) subjCount.set(s.subject, (subjCount.get(s.subject) ?? 0) + 1);
  console.log(`\nSubjects: ${[...subjCount].map(([k, v]) => `${k}=${v}`).join("  ")}`);
  if (flags.length) { console.log(`\nFLAGS (${flags.length}):`); for (const f of flags) console.log(`  - ${f}`); }
  console.log(conflicts.length ? `\nTEACHER DOUBLE-BOOKS (${conflicts.length}):` : "\nNo teacher double-books. ✓");
  for (const grp of conflicts) console.log(`  - ${grp[0].teacherShort} @ ${grp[0].day} P${grp[0].periodNumber}: ${grp.map((g) => `${g.block}/${g.kind}`).join(" + ")}`);

  if (!COMMIT) { console.log("\nDRY-RUN — nothing written. Re-run with --commit to apply."); await disconnectDb(); process.exit(0); }

  // --- COMMIT ---
  // schedule window + grids
  await ScheduleWindow.updateOne({ academicYearId: year._id, label: "Regular 2026" }, { $set: { academicYearId: year._id, fromDate: new Date("2026-01-01"), toDate: new Date("2026-12-31"), season: "regular", dayStartMinutes: 420, label: "Regular 2026", active: true } }, { upsert: true });
  const grid15 = [
    { number: 1, durationMin: 45, isBreak: false, track: "quran" as PeriodTrack, nameBn: "১ম" },
    { number: 2, durationMin: 45, isBreak: false, track: "quran" as PeriodTrack, nameBn: "২য়" },
    { number: 3, durationMin: 40, isBreak: false, track: "arabic" as PeriodTrack, nameBn: "৩য়" },
    { number: 4, durationMin: 30, isBreak: true, track: "general" as PeriodTrack, nameBn: "টিফিন" },
    { number: 5, durationMin: 35, isBreak: false, track: "general" as PeriodTrack, nameBn: "৪র্থ" },
    { number: 6, durationMin: 35, isBreak: false, track: "general" as PeriodTrack, nameBn: "৫ম" },
    { number: 7, durationMin: 35, isBreak: false, track: "general" as PeriodTrack, nameBn: "৬ষ্ঠ" },
    { number: 8, durationMin: 35, isBreak: false, track: "general" as PeriodTrack, nameBn: "৭ম" },
  ];
  const gridNK = grid15.slice(0, 6).map((p) => ({ ...p, track: "general" as PeriodTrack }));
  await PeriodGrid.updateOne({ audienceKey: "class_1_5", season: "regular" }, { $set: { audienceKey: "class_1_5", classLevels: [1, 2, 3, 4, 5], season: "regular", periods: grid15, active: true } }, { upsert: true });
  await PeriodGrid.updateOne({ audienceKey: "nursery_kg", season: "regular" }, { $set: { audienceKey: "nursery_kg", classLevels: [-1, 0], season: "regular", periods: gridNK, active: true } }, { upsert: true });

  // subject groups (upsert by code → stable _id across re-runs)
  const groupIdByCode = new Map<string, mongoose.Types.ObjectId>();
  for (const g of groups.values()) {
    await SubjectGroup.updateOne({ code: g.code }, { $set: { track: g.track, level: g.level, gender: g.gender, code: g.code, nameBn: g.nameBn, active: true } }, { upsert: true });
    const doc = await SubjectGroup.findOne({ code: g.code }).select("_id").lean();
    groupIdByCode.set(g.code, doc!._id);
  }

  // clear the slots this seed owns (the seeded sections + all our subject groups), then insert
  const sectionIds = [...new Set(slots.filter((s) => s.kind === "section").map((s) => { const x = sectionOf(s.classLevel, s.sectionCode!); return x ? String(x._id) : null; }).filter(Boolean) as string[])];
  const del = await RoutineSlot.deleteMany({
    $or: [
      { groupType: "section", groupId: { $in: sectionIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      { groupType: "subjectgroup", groupId: { $in: [...groupIdByCode.values()] } },
    ],
  });
  console.log(`\nUpserted ${groups.size} subject groups, 2 grids, 1 window. Cleared ${del.deletedCount} old slots. Inserting…`);

  const docs = slots.map((s) => {
    if (s.kind === "subjectgroup") {
      return { groupType: "subjectgroup" as const, groupId: groupIdByCode.get(s.groupKey!)!, dayOfWeek: s.day, periodNumber: s.periodNumber, subject: s.subject, track: s.track, isBreak: false, teacherId: teacherIdOf.has(s.teacherShort) ? new mongoose.Types.ObjectId(teacherIdOf.get(s.teacherShort)!) : undefined, effectiveFrom, active: true, createdBy: principal._id };
    }
    const sec = sectionOf(s.classLevel, s.sectionCode!)!;
    return { groupType: "section" as const, groupId: sec._id, classId: sec.classId, dayOfWeek: s.day, periodNumber: s.periodNumber, subject: s.subject, track: s.track, isBreak: false, teacherId: teacherIdOf.has(s.teacherShort) ? new mongoose.Types.ObjectId(teacherIdOf.get(s.teacherShort)!) : undefined, effectiveFrom, active: true, createdBy: principal._id };
  });
  const res = await RoutineSlot.insertMany(docs, { ordered: false });
  console.log(`Inserted ${res.length} routine slots (${secSlots.length} section + ${grpSlots.length} subjectgroup).`);

  // Backfill routine teaching grants (D-#49/#257) — a content-subject (BAN/ENG/MATH/SCI/BGS)
  // section slot grants the teacher read/write on that (section, subject), exactly like the
  // in-app createRoutineSlot binding. This is what makes the routine drive content visibility;
  // the bulk insert above bypasses the service, so we replicate the bind here (idempotent upsert).
  const subjectIdByCode = new Map((await Subject.find({}).select("code").lean()).map((s) => [s.code, s._id]));
  const contentSubjects = new Set<string>(SUBJECTS as readonly string[]);
  const seen = new Set<string>();
  let grantCount = 0;
  for (const s of slots) {
    if (s.kind !== "section" || !contentSubjects.has(s.subject)) continue;
    const tid = teacherIdOf.get(s.teacherShort);
    const subjId = subjectIdByCode.get(s.subject);
    const sec = sectionOf(s.classLevel, s.sectionCode!);
    if (!tid || !subjId || !sec) continue;
    const k = `${tid}|${sec._id}|${subjId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    await ScopeGrant.updateOne(
      { teacherId: new mongoose.Types.ObjectId(tid), kind: "teaching", sectionId: sec._id, subjectId: subjId, source: "routine" },
      { $set: { teacherId: new mongoose.Types.ObjectId(tid), kind: "teaching", classId: sec.classId, sectionId: sec._id, subjectId: subjId, source: "routine", active: true, createdBy: principal._id } },
      { upsert: true },
    );
    grantCount++;
  }
  console.log(`Backfilled ${grantCount} routine teaching grants (content subjects only — BAN/ENG/MATH/SCI/BGS).`);

  await disconnectDb(); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

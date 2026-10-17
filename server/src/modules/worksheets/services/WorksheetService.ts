/**
 * WorksheetService — Nursery/KG papers in final-exam style (D-#744–#747).
 *
 *   plan     = the LIVE published মানবন্টন of the class's latest exam + the Office's
 *              per-row choices and presets (engine/plan.ts)
 *   preview  = plan rows (or a custom pick) + "taught up to" + seed → WorksheetDoc,
 *              with the pictures as small data URIs for the native preview
 *   send     = regenerate the SAME doc from the seed, render the PDF, store it as a
 *              print_upload owned by the caller and file it through the EXISTING
 *              createPrintRequest path (the English Drive precedent, ED-2) — the
 *              Office queue, delivery, notifications and /files gate all apply as-is
 *
 * Gates (no new permission, D-#747): generating/sending = tracker:write (teachers)
 * OR roster:manage (Office/Principal, who may name the teacher it is for); the plan
 * and the picture bank are edited under roster:manage only.
 */
import { Types } from "mongoose";
import {
  ROSTER_CLASS_LABELS_BN,
  ROSTER_CLASS_LABELS_EN,
  ROUTINE_SUBJECT_LABELS_BN,
  WORKSHEET_KINDS,
  WORKSHEET_KIND_LABELS_BN,
  WORKSHEET_ITEM_KINDS,
  WORKSHEET_AXES,
  WORKSHEET_PICTURE_USES,
  callerHasPermission,
} from "@scd/shared";
import type { PrintPurpose, RosterClassLevel, RoutineSubject, WorksheetKind, WorksheetPictureUse } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";
import { Exam } from "../../exams/models/Exam";
import { ExamSyllabus } from "../../exams/models/ExamSyllabus";
import { routineHoldersFor } from "../../exams/services/ExamSyllabusService";
import { StoredFile } from "../../platform/models/StoredFile";
import { uploadToDrive, DriveUnavailableError } from "../../platform/services/DriveStore";
import { writeAudit } from "../../platform/services/AuditService";
import { createPrintRequest } from "../../printing/services/PrintRequestService";
import { printTargetFields } from "../../printing/printTarget";
import { WorksheetPicture, PICTURE_META_FIELDS, type IWorksheetPicture } from "../models/WorksheetPicture";
import { WorksheetPlan, type IWorksheetPlan } from "../models/WorksheetPlan";
import { Worksheet, type IWorksheet } from "../models/Worksheet";
import { generateWorksheet } from "../engine/generate";
import { mergePlanRows, rowsForKind, defaultPreset, type PlanRow, type PresetRow } from "../engine/plan";
import { bnNumber, BAN_CONSONANTS } from "../engine/sequences";
import type { PictureRef, WorksheetDoc } from "../engine/types";
import { renderWorksheetPdf, type WorksheetHeader } from "../render/worksheetPdf";

export class WorksheetError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "WorksheetError";
  }
}

/** The levels the item kinds were designed for: Nursery and KG. */
export const WORKSHEET_CLASS_LEVELS = [-1, 0] as const;
/** Arabic waits for the scanned রওযাতুল আতফাল ১ (owner 2026-10-16). */
export const WORKSHEET_SUBJECTS = ["BAN", "ENG", "MATH"] as const;
/** A picture printed within this window is drawn only when the pool runs short. */
export const RECENT_USE_DAYS = 28;

const GENERATE_PERMS = ["tracker:write", "roster:manage"] as const;

export function assertCanGenerate(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!GENERATE_PERMS.some((p) => callerHasPermission(ctx.auth!, p))) {
    throw new ForbiddenError("এই কাজের অনুমতি নেই");
  }
}

const isManager = (ctx: AppContext): boolean => !!ctx.auth && callerHasPermission(ctx.auth, "roster:manage");

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface PlanView {
  classId: string;
  classLevel: number;
  classLabel: string;
  subject: string;
  examId: string | null;
  examName: string | null;
  /** Σ of the printable rows' marks = the final paper's full marks. */
  finalTotal: number;
  rows: PlanRow[];
  assignmentPreset: PresetRow[];
  classTestPreset: PresetRow[];
  /** True when the Office has saved its own presets (vs the built-in defaults). */
  assignmentPresetSaved: boolean;
  classTestPresetSaved: boolean;
}

interface ClassInfo {
  _id: Types.ObjectId;
  level: number;
  nameBn: string;
}

async function loadClass(classId: string): Promise<ClassInfo> {
  if (!Types.ObjectId.isValid(classId)) throw new WorksheetError("শ্রেণি পাওয়া যায়নি");
  const cls = (await Class.findById(classId).select("level nameBn").lean()) as ClassInfo | null;
  if (!cls) throw new WorksheetError("শ্রেণি পাওয়া যায়নি");
  if (!(WORKSHEET_CLASS_LEVELS as readonly number[]).includes(cls.level)) {
    throw new WorksheetError("এই সুবিধা এখন শুধু নার্সারি ও কেজির জন্য");
  }
  return cls;
}

function assertSubject(subject: string): void {
  if (!(WORKSHEET_SUBJECTS as readonly string[]).includes(subject)) {
    throw new WorksheetError("এই বিষয়ের জন্য এখনো তৈরি করা যায় না");
  }
}

interface SyllabusSource {
  examId: string;
  examName: string;
  examStartKey: string | null;
  marks: Array<{
    seq: number;
    label: string;
    itemType?: string | null;
    component?: string | null;
    count?: number | null;
    marksEach?: number | null;
    total: number;
  }>;
}

/** The newest PUBLISHED syllabus for the pair — the rows the plan follows. */
export async function latestPublishedSyllabus(classId: string, subject: string): Promise<SyllabusSource | null> {
  const rows = (await ExamSyllabus.find({ classId: new Types.ObjectId(classId), subject, status: "PUBLISHED" })
    .select("examId marks publishedAt updatedAt")
    .sort({ publishedAt: -1, updatedAt: -1 })
    .limit(1)
    .lean()) as unknown as Array<{ examId: Types.ObjectId; marks: SyllabusSource["marks"] }>;
  const row = rows[0];
  if (!row) return null;
  const exam = (await Exam.findById(row.examId).select("name startDateKey").lean()) as
    | { name?: string; startDateKey?: string | null }
    | null;
  return {
    examId: row.examId.toString(),
    examName: exam?.name ?? "",
    examStartKey: exam?.startDateKey ?? null,
    marks: row.marks ?? [],
  };
}

export async function getPlan(ctx: AppContext, classId: string, subject: string): Promise<PlanView> {
  assertCanGenerate(ctx);
  assertSubject(subject);
  const cls = await loadClass(classId);
  const syl = await latestPublishedSyllabus(classId, subject);
  const saved = (await WorksheetPlan.findOne({ classLevel: cls.level, subject }).lean()) as IWorksheetPlan | null;
  const rows = mergePlanRows(syl?.marks ?? [], subject, saved?.rows ?? []);
  const known = new Set(rows.map((r) => r.seq));
  const keep = (p: PresetRow[] | null | undefined): PresetRow[] | null =>
    p && p.length ? p.filter((x) => known.has(x.seq)).map((x) => ({ seq: x.seq, count: x.count })) : null;
  const asg = keep(saved?.assignmentPreset);
  const ct = keep(saved?.classTestPreset);
  return {
    classId,
    classLevel: cls.level,
    classLabel: cls.nameBn,
    subject,
    examId: syl?.examId ?? null,
    examName: syl?.examName ?? null,
    finalTotal: rows.reduce((s, r) => s + r.count * r.marksEach, 0),
    rows,
    assignmentPreset: asg ?? defaultPreset("ASSIGNMENT", rows),
    classTestPreset: ct ?? defaultPreset("CLASS_TEST", rows),
    assignmentPresetSaved: !!asg,
    classTestPresetSaved: !!ct,
  };
}

export interface SavePlanInput {
  classId: string;
  subject: string;
  rows: Array<{ seq: number; kind: string; axis?: string | null; setSize?: number | null }>;
  assignmentPreset?: PresetRow[] | null;
  classTestPreset?: PresetRow[] | null;
}

function cleanPreset(p: PresetRow[] | null | undefined, known: Set<number>): PresetRow[] | null {
  if (p == null) return null;
  const seen = new Set<number>();
  const out: PresetRow[] = [];
  for (const r of p) {
    if (!known.has(r.seq) || seen.has(r.seq)) continue;
    if (!Number.isInteger(r.count) || r.count < 1 || r.count > 50) {
      throw new WorksheetError("প্রতি সারিতে সংখ্যা ১ থেকে ৫০ হতে হবে");
    }
    seen.add(r.seq);
    out.push({ seq: r.seq, count: r.count });
  }
  return out.length ? out : null;
}

export async function savePlan(ctx: AppContext, input: SavePlanInput): Promise<PlanView> {
  if (!isManager(ctx)) throw new ForbiddenError("শুধু অফিস/অধ্যক্ষ পরিকল্পনা বদলাতে পারেন");
  assertSubject(input.subject);
  const cls = await loadClass(input.classId);
  const syl = await latestPublishedSyllabus(input.classId, input.subject);
  if (!syl) throw new WorksheetError("এই বিষয়ের প্রকাশিত সিলেবাস নেই");
  const labelBySeq = new Map(syl.marks.map((m) => [m.seq, m.label]));

  const rows = input.rows.map((r) => {
    const label = labelBySeq.get(r.seq);
    if (!label) throw new WorksheetError(`সিলেবাসে ${bnNumber(r.seq)} নং সারি নেই`);
    if (!(WORKSHEET_ITEM_KINDS as readonly string[]).includes(r.kind)) throw new WorksheetError("অজানা প্রশ্নের ধরন");
    if (r.axis && !(WORKSHEET_AXES as readonly string[]).includes(r.axis)) throw new WorksheetError("অজানা ক্রম");
    if (r.setSize != null && (!Number.isInteger(r.setSize) || r.setSize < 3 || r.setSize > 20)) {
      throw new WorksheetError("সাজানোর দল ৩ থেকে ২০টির হতে হবে");
    }
    return { seq: r.seq, label, kind: r.kind, axis: r.axis ?? null, setSize: r.setSize ?? null };
  });
  const known = new Set(labelBySeq.keys());

  await WorksheetPlan.findOneAndUpdate(
    { classLevel: cls.level, subject: input.subject },
    {
      $set: {
        rows,
        assignmentPreset: cleanPreset(input.assignmentPreset, known),
        classTestPreset: cleanPreset(input.classTestPreset, known),
        updatedBy: new Types.ObjectId(ctx.auth!.userId as string),
      },
    },
    { upsert: true },
  );
  await writeAudit({
    eventKind: "WORKSHEET_PLAN_SAVED",
    actorId: ctx.auth!.userId as string,
    targetKind: "WorksheetPlan",
    meta: { classLevel: cls.level, subject: input.subject, rows: rows.length },
  });
  return getPlan(ctx, input.classId, input.subject);
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

export interface GenerateArgs {
  classId: string;
  subject: string;
  kind: string;
  seed: number;
  /** Custom row picks; null = the kind's preset (FINAL = every row as the syllabus says). */
  rows?: PresetRow[] | null;
  letterUpTo?: number | null;
  numberUpTo?: number | null;
  /** The letters actually taught, one checkbox each (owner 2026-10-16); replaces letterUpTo. */
  letters?: string[] | null;
  /** Header overrides typed by the teacher ("ক্লাস টেস্ট — ৩", "অক্টোবর, ৩য় সপ্তাহ"). */
  title?: string | null;
  subtitle?: string | null;
  meta?: string | null;
}

export async function loadPictureRefs(now = new Date()): Promise<PictureRef[]> {
  const cutoff = new Date(now.getTime() - RECENT_USE_DAYS * 86_400_000);
  const rows = (await WorksheetPicture.find({ active: true })
    .select("book word letter pageLetter uses reserveForFinal lastUsedAt")
    .lean()) as unknown as Array<
    Pick<IWorksheetPicture, "_id" | "book" | "word" | "letter" | "pageLetter" | "uses" | "reserveForFinal" | "lastUsedAt">
  >;
  return rows.map((p) => ({
    id: p._id.toString(),
    book: p.book,
    word: p.word ?? null,
    letter: p.letter ?? null,
    pageLetter: p.pageLetter ?? null,
    uses: (p.uses ?? []) as WorksheetPictureUse[],
    recent: !!p.lastUsedAt && p.lastUsedAt > cutoff,
    reserved: !!p.reserveForFinal,
  }));
}

function assertKind(kind: string): asserts kind is WorksheetKind {
  if (!(WORKSHEET_KINDS as readonly string[]).includes(kind)) throw new WorksheetError("অজানা ধরন");
}

interface Generated {
  plan: PlanView;
  kind: WorksheetKind;
  doc: WorksheetDoc;
  header: WorksheetHeader;
  rows: ReturnType<typeof rowsForKind>;
}

function englishClassLabel(level: number): string {
  return ROSTER_CLASS_LABELS_EN[level as RosterClassLevel] ?? `Class ${level}`;
}

function buildHeader(args: GenerateArgs, plan: PlanView, kind: WorksheetKind, total: number, examYear: string): WorksheetHeader {
  const english = plan.subject === "ENG";
  const defaults: Record<WorksheetKind, { title: string; meta: string | null }> = english
    ? {
        ASSIGNMENT: { title: "Weekly Assignment", meta: null },
        CLASS_TEST: { title: "Class Test", meta: "Time: 30 minutes" },
        FINAL: { title: `Annual Examination ${examYear}`, meta: "Time: 1 hour 30 minutes" },
      }
    : {
        ASSIGNMENT: { title: "সাপ্তাহিক অ্যাসাইনমেন্ট", meta: null },
        CLASS_TEST: { title: "ক্লাস টেস্ট", meta: "সময়: ৩০ মিনিট" },
        FINAL: { title: `বার্ষিক পরীক্ষা — ${bnNumber(examYear)}`, meta: "সময়: ১ ঘণ্টা ৩০ মিনিট" },
      };
  const d = defaults[kind];
  const subjectBn = ROUTINE_SUBJECT_LABELS_BN[plan.subject as RoutineSubject] ?? plan.subject;
  const classBn = ROSTER_CLASS_LABELS_BN[plan.classLevel as RosterClassLevel] ?? plan.classLabel;
  return {
    english,
    school: english ? "School for Community Development" : "স্কুল ফর কমিউনিটি ডেভেলপমেন্ট",
    title: args.title?.trim() || d.title,
    subtitle: args.subtitle?.trim() || null,
    classLine: english
      ? `Class: ${englishClassLabel(plan.classLevel)} · Subject: English`
      : `শ্রেণি: ${classBn}      বিষয়: ${subjectBn}`,
    meta: args.meta?.trim() || d.meta,
    fullMarks: english ? `Full marks: ${total}` : `পূর্ণমান: ${bnNumber(total)}`,
    nameLabel: english ? "Name" : "নাম",
    idLabel: english ? "ID" : "আইডি",
  };
}

/** At most the whole alphabet, each a short string — the set is just a filter. */
function cleanLetters(letters: string[] | null | undefined): string[] | null {
  if (!letters || letters.length === 0) return null;
  const out = [...new Set(letters.map((l) => l.trim()).filter((l) => l.length > 0 && l.length <= 4))].slice(0, 60);
  return out.length ? out : null;
}

export async function generate(ctx: AppContext, args: GenerateArgs, pictures?: PictureRef[]): Promise<Generated> {
  assertKind(args.kind);
  const kind = args.kind;
  const plan = await getPlan(ctx, args.classId, args.subject);
  if (!plan.rows.length) throw new WorksheetError("এই বিষয়ের প্রকাশিত মানবন্টন নেই — আগে সিলেবাস প্রকাশ করুন");
  if (!Number.isInteger(args.seed) || args.seed < 0) throw new WorksheetError("Invalid seed");

  const picks =
    args.rows && args.rows.length
      ? args.rows
      : kind === "ASSIGNMENT"
        ? plan.assignmentPreset
        : kind === "CLASS_TEST"
          ? plan.classTestPreset
          : null;
  const rows = rowsForKind(kind, plan.rows, picks);
  if (!rows.length) throw new WorksheetError("অন্তত একটি প্রশ্নের সারি বাছাই করুন");

  const letterMax = plan.subject === "ENG" ? 25 : BAN_CONSONANTS.length - 1;
  const doc = generateWorksheet({
    kind,
    subject: plan.subject,
    rows,
    scope: {
      // A final covers the whole book (the syllabus says সম্পূর্ণ পাঠ্যবই).
      letterUpTo: kind === "FINAL" ? letterMax : args.letterUpTo ?? letterMax,
      numberUpTo: kind === "FINAL" ? null : args.numberUpTo ?? null,
      letters: kind === "FINAL" ? null : cleanLetters(args.letters),
    },
    seed: args.seed,
    pictures: pictures ?? (await loadPictureRefs()),
  });
  const examYear = (await examYearFor(plan)) ?? String(new Date().getFullYear());
  return { plan, kind, doc, rows, header: buildHeader(args, plan, kind, doc.total, examYear) };
}

async function examYearFor(plan: PlanView): Promise<string | null> {
  if (!plan.examId) return null;
  const exam = (await Exam.findById(plan.examId).select("startDateKey name").lean()) as
    | { startDateKey?: string | null; name?: string }
    | null;
  const fromKey = exam?.startDateKey?.slice(0, 4);
  if (fromKey) return fromKey;
  const m = /(20\d\d)/.exec(exam?.name ?? "");
  return m ? m[1] : null;
}

export interface PreviewPicture {
  id: string;
  dataUri: string;
}

export interface WorksheetPreview {
  docJson: string;
  total: number;
  warnings: string[];
  header: WorksheetHeader;
  pictures: PreviewPicture[];
  rows: Array<{ seq: number; count: number; marksEach: number; label: string; kind: string }>;
}

export async function previewWorksheet(ctx: AppContext, args: GenerateArgs): Promise<WorksheetPreview> {
  assertCanGenerate(ctx);
  const g = await generate(ctx, args);
  const thumbs = (await WorksheetPicture.find({ _id: { $in: g.doc.pictureIds.map((id) => new Types.ObjectId(id)) } })
    .select("thumb")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; thumb: Buffer | { buffer: Buffer } }>;
  return {
    docJson: JSON.stringify(g.doc),
    total: g.doc.total,
    warnings: g.doc.warnings,
    header: g.header,
    pictures: thumbs.map((t) => ({ id: t._id.toString(), dataUri: `data:image/jpeg;base64,${bufferOf(t.thumb).toString("base64")}` })),
    rows: g.rows.map((r) => ({ seq: r.seq, count: r.count, marksEach: r.marksEach, label: r.label, kind: r.kind })),
  };
}

/** A lean() Buffer may come back as a BSON Binary — normalise. */
function bufferOf(b: Buffer | { buffer: Buffer } | null | undefined): Buffer {
  if (!b) return Buffer.alloc(0);
  if (Buffer.isBuffer(b)) return b;
  const inner = (b as { buffer?: unknown }).buffer;
  return Buffer.isBuffer(inner) ? inner : Buffer.from(inner as ArrayBuffer);
}

export async function pictureBytes(ids: string[], field: "image" | "thumb" = "image"): Promise<Map<string, Buffer>> {
  const rows = (await WorksheetPicture.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
    .select(field)
    .lean()) as unknown as Array<{ _id: Types.ObjectId; image?: Buffer; thumb?: Buffer }>;
  return new Map(rows.map((r) => [r._id.toString(), bufferOf((r[field] ?? null) as Buffer | null)]));
}

// ---------------------------------------------------------------------------
// Send to print
// ---------------------------------------------------------------------------

const PURPOSE: Record<WorksheetKind, PrintPurpose> = {
  ASSIGNMENT: "ASSIGNMENT",
  CLASS_TEST: "CLASS_TEST",
  FINAL: "OTHER",
};

export interface SendWorksheetInput extends GenerateArgs {
  colour: string;
  sides: string;
  copies: number;
  copiesMode?: string | null;
  copiesClassId?: string | null;
  sectionId?: string | null;
  neededByKey: string;
  /** Office only: the teacher this paper is for. */
  forTeacherId?: string | null;
}

export interface SendWorksheetResult {
  worksheetId: string;
  printRequestId: string;
  title: string;
  totalMarks: number;
}

/** A one-section class needs no section pick; ASSIGNMENT requests require one (D-#459). */
async function resolveSection(classId: string, sectionId?: string | null): Promise<string | null> {
  if (sectionId) return sectionId;
  const secs = (await Section.find({ classId: new Types.ObjectId(classId), active: { $ne: false } })
    .select("_id")
    .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  return secs.length === 1 ? secs[0]._id.toString() : null;
}

export async function sendWorksheetToPrint(ctx: AppContext, input: SendWorksheetInput): Promise<SendWorksheetResult> {
  assertCanGenerate(ctx);
  if (!input.neededByKey) throw new WorksheetError("প্রিন্ট কবে ব্যবহার হবে সেই তারিখ দিন");
  let forTeacherId: string | null = null;
  if (input.forTeacherId) {
    if (!isManager(ctx)) throw new ForbiddenError("শুধু অফিস অন্য শিক্ষকের জন্য তৈরি করতে পারে");
    if (!Types.ObjectId.isValid(input.forTeacherId)) throw new WorksheetError("শিক্ষক পাওয়া যায়নি");
    forTeacherId = input.forTeacherId;
  }

  const g = await generate(ctx, input);
  if (g.doc.sections.length === 0) throw new WorksheetError("ছাপার মতো কোনো প্রশ্ন তৈরি হয়নি");
  const pics = await pictureBytes(g.doc.pictureIds, "image");
  const pdf = await renderWorksheetPdf(g.doc, g.header, { get: (id) => pics.get(id) });

  const subjectBn = ROUTINE_SUBJECT_LABELS_BN[g.plan.subject as RoutineSubject] ?? g.plan.subject;
  let teacherName = "";
  if (forTeacherId) {
    const t = (await User.findById(forTeacherId).select("name").lean()) as { name?: string } | null;
    teacherName = t?.name ?? "";
  }
  const title = `${g.plan.classLabel} · ${subjectBn} · ${WORKSHEET_KIND_LABELS_BN[g.kind]}${
    g.header.subtitle ? ` · ${g.header.subtitle}` : ""
  }`.slice(0, 200);
  const fileName = `worksheet_${g.plan.classLevel}_${g.plan.subject}_${g.kind}_${input.seed}.pdf`;

  let driveFileId: string;
  try {
    driveFileId = await uploadToDrive({
      name: fileName,
      mime: "application/pdf",
      data: pdf,
      year: String(new Date().getFullYear()),
      subfolder: "print",
    });
  } catch (e) {
    if (e instanceof DriveUnavailableError) throw new WorksheetError("ফাইল স্টোরেজ এখন উপলব্ধ নয় — একটু পরে আবার চেষ্টা করুন");
    throw e;
  }
  const stored = await StoredFile.create({
    kind: "print_upload",
    mime: "application/pdf",
    sizeBytes: pdf.byteLength,
    originalName: fileName,
    driveFileId,
    uploadedBy: ctx.auth!.userId,
  });

  const sectionId = await resolveSection(input.classId, input.sectionId);
  const req = await createPrintRequest({
    title,
    purpose: PURPOSE[g.kind],
    sourceType: "UPLOAD",
    fileIds: [stored._id.toString()],
    colour: input.colour,
    sides: input.sides,
    copies: input.copies,
    ...printTargetFields({
      copiesMode: input.copiesMode,
      copiesClassId: input.copiesClassId,
      classId: input.classId,
      sectionId,
    }),
    neededByKey: input.neededByKey,
    subject: g.plan.subject,
    notes: teacherName ? `শিক্ষক: ${teacherName} (অফিস তৈরি করেছে)` : undefined,
    requestedBy: ctx.auth!.userId as string,
  });

  const ws = await Worksheet.create({
    kind: g.kind,
    classId: new Types.ObjectId(input.classId),
    classLevel: g.plan.classLevel,
    sectionId: sectionId ? new Types.ObjectId(sectionId) : null,
    subject: g.plan.subject,
    title,
    subtitle: g.header.subtitle,
    meta: g.header.meta,
    seed: input.seed,
    letterUpTo: input.letterUpTo ?? null,
    numberUpTo: input.numberUpTo ?? null,
    letters: cleanLetters(input.letters),
    rows: g.rows,
    doc: g.doc,
    header: g.header,
    totalMarks: g.doc.total,
    pictureIds: g.doc.pictureIds.map((id) => new Types.ObjectId(id)),
    createdBy: new Types.ObjectId(ctx.auth!.userId as string),
    forTeacherId: forTeacherId ? new Types.ObjectId(forTeacherId) : null,
    printRequestId: req._id,
  });

  if (g.doc.pictureIds.length) {
    await WorksheetPicture.updateMany(
      { _id: { $in: g.doc.pictureIds.map((id) => new Types.ObjectId(id)) } },
      { $set: { lastUsedAt: new Date() }, $inc: { useCount: 1 } },
    );
  }
  await writeAudit({
    eventKind: "WORKSHEET_SENT_TO_PRINT",
    actorId: ctx.auth!.userId as string,
    targetId: ws._id,
    targetKind: "Worksheet",
    meta: {
      kind: g.kind,
      classLevel: g.plan.classLevel,
      subject: g.plan.subject,
      seed: input.seed,
      totalMarks: g.doc.total,
      printRequestId: req._id.toString(),
      ...(forTeacherId ? { forTeacherId } : {}),
    },
  });

  return { worksheetId: ws._id.toString(), printRequestId: req._id.toString(), title, totalMarks: g.doc.total };
}

// ---------------------------------------------------------------------------
// Stored worksheets (answer key / reprint)
// ---------------------------------------------------------------------------

export async function worksheetForRead(ctx: AppContext, id: string): Promise<IWorksheet> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!Types.ObjectId.isValid(id)) throw new WorksheetError("Not found");
  const ws = (await Worksheet.findById(id).lean()) as IWorksheet | null;
  if (!ws) throw new WorksheetError("Not found");
  const me = ctx.auth.userId as string;
  const mine = ws.createdBy?.toString() === me || ws.forTeacherId?.toString() === me;
  if (!mine && !isManager(ctx)) throw new ForbiddenError("এই প্রশ্নপত্র দেখার অনুমতি নেই");
  return ws;
}

export async function renderStoredWorksheet(ctx: AppContext, id: string, answers: boolean): Promise<Buffer> {
  const ws = await worksheetForRead(ctx, id);
  const pics = await pictureBytes(ws.doc.pictureIds ?? [], "image");
  return renderWorksheetPdf(ws.doc, ws.header, { get: (pid) => pics.get(pid) }, { answers });
}

export interface WorksheetListRow {
  id: string;
  title: string;
  kind: string;
  subject: string;
  classLevel: number;
  totalMarks: number;
  createdAt: Date;
  printRequestId: string | null;
}

export async function myWorksheets(ctx: AppContext, limit = 30): Promise<WorksheetListRow[]> {
  assertCanGenerate(ctx);
  const me = new Types.ObjectId(ctx.auth!.userId as string);
  const rows = (await Worksheet.find({ $or: [{ createdBy: me }, { forTeacherId: me }] })
    .select("title kind subject classLevel totalMarks createdAt printRequestId")
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 100))
    .lean()) as unknown as IWorksheet[];
  return rows.map((w) => ({
    id: w._id.toString(),
    title: w.title,
    kind: w.kind,
    subject: w.subject,
    classLevel: w.classLevel,
    totalMarks: w.totalMarks,
    createdAt: w.createdAt,
    printRequestId: w.printRequestId?.toString() ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Teachers the Office can generate for
// ---------------------------------------------------------------------------

export async function worksheetTeachers(
  ctx: AppContext,
  classId: string,
  subject: string,
): Promise<Array<{ userId: string; name: string }>> {
  if (!isManager(ctx)) return [];
  const holders = await routineHoldersFor(classId, subject as RoutineSubject);
  if (!holders.length) return [];
  const users = (await User.find({ _id: { $in: holders.map((h) => new Types.ObjectId(h.userId)) } })
    .select("name")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name?: string }>;
  const names = new Map(users.map((u) => [u._id.toString(), u.name ?? ""]));
  return holders.map((h) => ({ userId: h.userId, name: names.get(h.userId) ?? "" }));
}

// ---------------------------------------------------------------------------
// Picture bank
// ---------------------------------------------------------------------------

export interface PictureFilter {
  book?: string | null;
  untagged?: boolean | null;
  search?: string | null;
  includeHidden?: boolean | null;
  offset?: number | null;
  limit?: number | null;
}

export interface PictureRow {
  id: string;
  book: string;
  page: number;
  word: string | null;
  wordEn: string | null;
  letter: string | null;
  pageLetter: string | null;
  uses: string[];
  reserveForFinal: boolean;
  active: boolean;
  useCount: number;
  lastUsedAt: Date | null;
  thumbUri: string;
}

export interface PicturePage {
  rows: PictureRow[];
  total: number;
  counts: Array<{ book: string; total: number; untagged: number }>;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listPictures(ctx: AppContext, f: PictureFilter): Promise<PicturePage> {
  assertCanGenerate(ctx);
  const q: Record<string, unknown> = {};
  if (f.book) q.book = f.book;
  if (!f.includeHidden) q.active = true;
  if (f.untagged) q.$or = [{ letter: null }, { word: null }, { uses: { $size: 0 } }];
  if (f.search?.trim()) {
    const s = escapeRegex(f.search.trim());
    q.$and = [{ $or: [{ word: { $regex: s, $options: "i" } }, { wordEn: { $regex: s, $options: "i" } }, { letter: s }, { pageLetter: s }] }];
  }
  const limit = Math.min(Math.max(f.limit ?? 60, 1), 120);
  const offset = Math.max(f.offset ?? 0, 0);
  const [rows, total, agg] = await Promise.all([
    WorksheetPicture.find(q).select("-image").sort({ book: 1, page: 1, imageIndex: 1 }).skip(offset).limit(limit).lean(),
    WorksheetPicture.countDocuments(q),
    WorksheetPicture.aggregate([
      { $match: { active: true } },
      {
        $group: {
          _id: "$book",
          total: { $sum: 1 },
          untagged: {
            $sum: { $cond: [{ $or: [{ $eq: ["$letter", null] }, { $eq: ["$word", null] }, { $eq: [{ $size: "$uses" }, 0] }] }, 1, 0] },
          },
        },
      },
    ]),
  ]);
  return {
    total,
    counts: (agg as Array<{ _id: string; total: number; untagged: number }>).map((a) => ({
      book: a._id,
      total: a.total,
      untagged: a.untagged,
    })),
    rows: (rows as unknown as IWorksheetPicture[]).map((p) => ({
      id: p._id.toString(),
      book: p.book,
      page: p.page,
      word: p.word ?? null,
      wordEn: p.wordEn ?? null,
      letter: p.letter ?? null,
      pageLetter: p.pageLetter ?? null,
      uses: p.uses ?? [],
      reserveForFinal: !!p.reserveForFinal,
      active: p.active !== false,
      useCount: p.useCount ?? 0,
      lastUsedAt: p.lastUsedAt ?? null,
      thumbUri: `data:image/jpeg;base64,${bufferOf(p.thumb as unknown as Buffer).toString("base64")}`,
    })),
  };
}

export interface PicturePatch {
  word?: string | null;
  wordEn?: string | null;
  letter?: string | null;
  pageLetter?: string | null;
  uses?: string[] | null;
  reserveForFinal?: boolean | null;
  active?: boolean | null;
}

export async function updatePicture(ctx: AppContext, id: string, patch: PicturePatch): Promise<PictureRow> {
  if (!isManager(ctx)) throw new ForbiddenError("শুধু অফিস/অধ্যক্ষ ছবি বদলাতে পারেন");
  if (!Types.ObjectId.isValid(id)) throw new WorksheetError("ছবি পাওয়া যায়নি");
  const set: Record<string, unknown> = { updatedBy: new Types.ObjectId(ctx.auth!.userId as string) };
  const norm = (s: string | null | undefined): string | null => (s == null ? null : s.trim() || null);
  if (patch.word !== undefined) set.word = norm(patch.word);
  if (patch.wordEn !== undefined) set.wordEn = norm(patch.wordEn);
  if (patch.letter !== undefined) {
    const l = norm(patch.letter);
    if (l && [...l].length > 3) throw new WorksheetError("প্রথম বর্ণে একটি অক্ষরই দিন");
    set.letter = l;
  }
  if (patch.pageLetter !== undefined) {
    const l = norm(patch.pageLetter);
    if (l && [...l].length > 3) throw new WorksheetError("বইয়ের বর্ণে একটি অক্ষরই দিন");
    set.pageLetter = l;
  }
  if (patch.uses != null) {
    if (patch.uses.some((u) => !(WORKSHEET_PICTURE_USES as readonly string[]).includes(u))) {
      throw new WorksheetError("অজানা ব্যবহার");
    }
    set.uses = [...new Set(patch.uses)];
  }
  if (patch.reserveForFinal != null) set.reserveForFinal = patch.reserveForFinal;
  if (patch.active != null) set.active = patch.active;

  const doc = await WorksheetPicture.findByIdAndUpdate(id, { $set: set }, { new: true }).select("-image").lean();
  if (!doc) throw new WorksheetError("ছবি পাওয়া যায়নি");
  await writeAudit({
    eventKind: "WORKSHEET_PICTURE_EDITED",
    actorId: ctx.auth!.userId as string,
    targetId: id,
    targetKind: "WorksheetPicture",
    meta: { fields: Object.keys(set).filter((k) => k !== "updatedBy") },
  });
  const p = doc as unknown as IWorksheetPicture;
  return {
    id: p._id.toString(),
    book: p.book,
    page: p.page,
    word: p.word ?? null,
    wordEn: p.wordEn ?? null,
    letter: p.letter ?? null,
    pageLetter: p.pageLetter ?? null,
    uses: p.uses ?? [],
    reserveForFinal: !!p.reserveForFinal,
    active: p.active !== false,
    useCount: p.useCount ?? 0,
    lastUsedAt: p.lastUsedAt ?? null,
    thumbUri: `data:image/jpeg;base64,${bufferOf(p.thumb as unknown as Buffer).toString("base64")}`,
  };
}

export { PICTURE_META_FIELDS };

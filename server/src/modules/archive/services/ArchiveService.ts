/**
 * ArchiveService (AR-1..AR-3, prd-script-archive §5/§7, D-#443–#447) — the
 * answer-script archive: registered boxes + one bundle per test.
 *
 *   generateBoxCode   — atomic BX-{year}-{seq} (StorageBoxSequence, D-#445).
 *   createBox / updateBox / retireBox — box register ops (roster:manage).
 *   fileBundle        — record "N scripts of test X filed in box Y". Source row
 *                       must be a PRINTED ClassTest; box ACTIVE; no live bundle
 *                       for the source. Denormalized fields RESOLVED from the
 *                       source (D-#143 posture). Auto-acks when the filer holds
 *                       roster:manage (D-#444).
 *   acknowledgeBundle — the ONE office acknowledgement (additive stamp).
 *   checkOutBundle / checkInBundle — the desk log (append-only checkouts[]).
 *   disposeBundle     — FILED + outside retention only (D-#446); never while
 *                       checked out. voidBundle — filed-in-error, terminal.
 *   listDisposable    — DERIVED retention list: everything outside the
 *                       protected (current + previous academic year) window.
 *
 * Permission gates live in the RESOLVER (this service trusts the actor); every
 * transition writes an audit row (ADR-008).
 */
import { Types } from "mongoose";
import { StorageBox, type IStorageBox } from "../models/StorageBox";
import { StorageBoxSequence } from "../models/StorageBoxSequence";
import { ScriptBundle, type IScriptBundle, type IScriptCheckout } from "../models/ScriptBundle";
import { ClassTest } from "../../trackers/models/ClassTest";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import type { ArchiveSourceKind } from "@scd/shared";

// ---------------------------------------------------------------------------
// Shapes (GraphQL-facing; derived fields computed here, never stored — D-#85)
// ---------------------------------------------------------------------------

export interface StorageBoxShape {
  id: string;
  boxCode: string;
  label?: string;
  locationNote: string;
  status: string;
  createdBy: string;
  createdAt: string;
  /** Derived: live (FILED/CHECKED_OUT) bundles inside. */
  bundleCount: number;
  /** Derived: sum of scriptCount over the live bundles. */
  scriptCount: number;
}

export interface ScriptCheckoutShape {
  toUserId: string;
  /** Filled by decorateNames() for detail reads; "—" fallback otherwise. */
  toUserName?: string;
  purpose: string;
  expectedReturnDateKey?: string;
  checkedOutBy: string;
  checkedOutAt: string;
  returnedBy?: string;
  returnedAt?: string;
  returnNote?: string;
}

export interface ScriptBundleShape {
  id: string;
  sourceKind: string;
  sourceRefId: string;
  /** The human id people search — ClassTest.ctId (e.g. CT-C5-BAN-0001). */
  sourceLabel: string;
  academicYearId: string;
  classLevel: number;
  sectionId: string;
  subject: string;
  testNumber: number;
  examDate: string;
  scriptCount: number;
  boxId: string;
  filedBy: string;
  filedByName?: string;
  filedAt: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  status: string;
  checkouts: ScriptCheckoutShape[];
  attachmentFileIds: string[];
  disposedBy?: string;
  disposedAt?: string;
  disposeReason?: string;
  voidedBy?: string;
  voidedAt?: string;
  voidReason?: string;
  notes?: string;
  /** Derived: true while an open checkout's expectedReturnDateKey is past. */
  overdue: boolean;
}

function checkoutShape(c: IScriptCheckout): ScriptCheckoutShape {
  return {
    toUserId: c.toUserId.toString(),
    purpose: c.purpose,
    expectedReturnDateKey: c.expectedReturnDateKey ?? undefined,
    checkedOutBy: c.checkedOutBy.toString(),
    checkedOutAt: c.checkedOutAt.toISOString(),
    returnedBy: c.returnedBy ? c.returnedBy.toString() : undefined,
    returnedAt: c.returnedAt ? c.returnedAt.toISOString() : undefined,
    returnNote: c.returnNote ?? undefined,
  };
}

/** The open checkout is the LAST element with no returnedAt (append-only log). */
function openCheckout(b: Pick<IScriptBundle, "checkouts">): IScriptCheckout | null {
  const last = b.checkouts.length ? b.checkouts[b.checkouts.length - 1] : null;
  return last && !last.returnedAt ? last : null;
}

/** Local YYYY-MM-DD (matches the attendance dateKey convention). */
function todayKey(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function bundleShape(b: IScriptBundle): ScriptBundleShape {
  const open = openCheckout(b);
  const overdue =
    !!open && !!open.expectedReturnDateKey && open.expectedReturnDateKey < todayKey();
  return {
    id: b._id.toString(),
    sourceKind: b.source.kind,
    sourceRefId: b.source.refId.toString(),
    sourceLabel: b.sourceLabel,
    academicYearId: b.academicYearId.toString(),
    classLevel: b.classLevel,
    sectionId: b.sectionId.toString(),
    subject: b.subject,
    testNumber: b.testNumber,
    examDate: b.examDate.toISOString(),
    scriptCount: b.scriptCount,
    boxId: b.boxId.toString(),
    filedBy: b.filedBy.toString(),
    filedAt: b.filedAt.toISOString(),
    acknowledgedBy: b.acknowledgedBy ? b.acknowledgedBy.toString() : undefined,
    acknowledgedAt: b.acknowledgedAt ? b.acknowledgedAt.toISOString() : undefined,
    status: b.status,
    checkouts: b.checkouts.map(checkoutShape),
    attachmentFileIds: (b.attachmentFileIds ?? []).map((f) => f.toString()),
    disposedBy: b.disposedBy ? b.disposedBy.toString() : undefined,
    disposedAt: b.disposedAt ? b.disposedAt.toISOString() : undefined,
    disposeReason: b.disposeReason ?? undefined,
    voidedBy: b.voidedBy ? b.voidedBy.toString() : undefined,
    voidedAt: b.voidedAt ? b.voidedAt.toISOString() : undefined,
    voidReason: b.voidReason ?? undefined,
    notes: b.notes ?? undefined,
    overdue,
  };
}

/** Fill display names (filedByName, checkout toUserName) for detail reads —
 *  one batched User lookup per call, never per row. */
export async function decorateNames(shapes: ScriptBundleShape[]): Promise<ScriptBundleShape[]> {
  const ids = new Set<string>();
  for (const s of shapes) {
    ids.add(s.filedBy);
    for (const c of s.checkouts) ids.add(c.toUserId);
  }
  if (ids.size === 0) return shapes;
  const users = await User.find({ _id: { $in: [...ids] } })
    .select("name")
    .lean();
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name as string]));
  for (const s of shapes) {
    s.filedByName = nameOf.get(s.filedBy);
    for (const c of s.checkouts) c.toUserName = nameOf.get(c.toUserId);
  }
  return shapes;
}

async function boxShape(box: IStorageBox): Promise<StorageBoxShape> {
  const live = await ScriptBundle.aggregate<{ _id: null; bundles: number; scripts: number }>([
    { $match: { boxId: box._id, status: { $in: ["FILED", "CHECKED_OUT"] } } },
    { $group: { _id: null, bundles: { $sum: 1 }, scripts: { $sum: "$scriptCount" } } },
  ]);
  return {
    id: box._id.toString(),
    boxCode: box.boxCode,
    label: box.label ?? undefined,
    locationNote: box.locationNote,
    status: box.status,
    createdBy: box.createdBy.toString(),
    createdAt: box.createdAt.toISOString(),
    bundleCount: live[0]?.bundles ?? 0,
    scriptCount: live[0]?.scripts ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Box register (D-#445)
// ---------------------------------------------------------------------------

export async function generateBoxCode(year: number): Promise<string> {
  const counter = await StorageBoxSequence.findOneAndUpdate(
    { year },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return `BX-${year}-${String(counter.seq).padStart(2, "0")}`;
}

export async function createBox(input: {
  label?: string;
  locationNote: string;
  actorId: string;
}): Promise<StorageBoxShape> {
  const boxCode = await generateBoxCode(new Date().getFullYear());
  const box = await StorageBox.create({
    boxCode,
    label: input.label,
    locationNote: input.locationNote,
    status: "ACTIVE",
    createdBy: input.actorId,
  });
  await writeAudit({
    eventKind: "STORAGE_BOX_CHANGED",
    actorId: input.actorId,
    targetId: box._id.toString(),
    targetKind: "StorageBox",
    meta: { action: "create", boxCode, label: input.label, locationNote: input.locationNote },
  });
  return boxShape(box);
}

export async function updateBox(input: {
  boxId: string;
  label?: string;
  locationNote?: string;
  actorId: string;
}): Promise<StorageBoxShape> {
  const box = await StorageBox.findById(input.boxId);
  if (!box) throw new Error("বাক্স পাওয়া যায়নি");
  const prior = { label: box.label, locationNote: box.locationNote };
  if (input.label !== undefined) box.label = input.label;
  if (input.locationNote !== undefined) box.locationNote = input.locationNote;
  await box.save();
  await writeAudit({
    eventKind: "STORAGE_BOX_CHANGED",
    actorId: input.actorId,
    targetId: box._id.toString(),
    targetKind: "StorageBox",
    meta: { action: "update", prior, next: { label: box.label, locationNote: box.locationNote } },
  });
  return boxShape(box);
}

export async function retireBox(input: { boxId: string; actorId: string }): Promise<StorageBoxShape> {
  const box = await StorageBox.findById(input.boxId);
  if (!box) throw new Error("বাক্স পাওয়া যায়নি");
  if (box.status === "RETIRED") throw new Error("বাক্সটি আগেই বন্ধ করা হয়েছে");
  box.status = "RETIRED";
  await box.save();
  await writeAudit({
    eventKind: "STORAGE_BOX_CHANGED",
    actorId: input.actorId,
    targetId: box._id.toString(),
    targetKind: "StorageBox",
    meta: { action: "retire", boxCode: box.boxCode },
  });
  return boxShape(box);
}

export async function listBoxes(status?: string): Promise<StorageBoxShape[]> {
  const filter = status ? { status } : {};
  const boxes = await StorageBox.find(filter).sort({ boxCode: 1 });
  return Promise.all(boxes.map((b) => boxShape(b)));
}

export async function getBox(boxId: string): Promise<StorageBoxShape | null> {
  const box = await StorageBox.findById(boxId);
  return box ? boxShape(box) : null;
}

// ---------------------------------------------------------------------------
// Filing (AR-1)
// ---------------------------------------------------------------------------

/** Resolve the source row a bundle archives. CLASS_TEST only in v1 — EXAM is
 *  reserved vocabulary (D-#443) and refused until the exams module wires in. */
async function resolveSource(kind: ArchiveSourceKind, refId: string) {
  if (kind !== "CLASS_TEST") {
    throw new Error("EXAM আর্কাইভ এখনো চালু হয়নি (prd-exams.md EX-7)");
  }
  const test = await ClassTest.findById(refId).lean();
  if (!test) throw new Error("ক্লাস টেস্ট পাওয়া যায়নি");
  return test;
}

export async function fileBundle(input: {
  sourceKind: ArchiveSourceKind;
  sourceRefId: string;
  scriptCount: number;
  boxId: string;
  notes?: string;
  attachmentFileIds?: string[];
  actorId: string;
  /** roster:manage caller — the filing is auto-acknowledged (D-#444). */
  actorCanManage: boolean;
}): Promise<ScriptBundleShape> {
  const test = await resolveSource(input.sourceKind, input.sourceRefId);
  if (test.status !== "PRINTED") {
    throw new Error("শুধু অফিসিয়াল (ছাপা হয়েছে) ক্লাস টেস্টের খাতা সংরক্ষণ করা যায়");
  }

  const box = await StorageBox.findById(input.boxId).lean();
  if (!box) throw new Error("বাক্স পাওয়া যায়নি");
  if (box.status !== "ACTIVE") {
    throw new Error(`বাক্স ${box.boxCode} বন্ধ — নতুন বান্ডিল রাখা যাবে না`);
  }

  // Friendly duplicate guard FIRST (names the existing bundle's box); the
  // partial-unique index is the concurrency backstop.
  const existing = await ScriptBundle.findOne({
    "source.kind": input.sourceKind,
    "source.refId": input.sourceRefId,
    status: { $ne: "VOID" },
  }).lean();
  if (existing) {
    const inBox = await StorageBox.findById(existing.boxId).select("boxCode").lean();
    throw new Error(
      `এই টেস্টের খাতা আগেই সংরক্ষিত (বাক্স ${inBox?.boxCode ?? "?"})`,
    );
  }

  const now = new Date();
  const bundle = await ScriptBundle.create({
    source: { kind: input.sourceKind, refId: input.sourceRefId },
    sourceLabel: test.ctId,
    academicYearId: test.academicYearId,
    classLevel: test.classLevel,
    sectionId: test.sectionId,
    subject: test.subject,
    testNumber: test.testNumber,
    examDate: test.examDate,
    scriptCount: input.scriptCount,
    boxId: input.boxId,
    filedBy: input.actorId,
    filedAt: now,
    acknowledgedBy: input.actorCanManage ? input.actorId : null,
    acknowledgedAt: input.actorCanManage ? now : null,
    status: "FILED",
    attachmentFileIds: input.attachmentFileIds ?? [],
    notes: input.notes ?? null,
  });
  await writeAudit({
    eventKind: "SCRIPT_BUNDLE_FILED",
    actorId: input.actorId,
    targetId: bundle._id.toString(),
    targetKind: "ScriptBundle",
    meta: {
      sourceKind: input.sourceKind,
      sourceRefId: input.sourceRefId,
      ctId: test.ctId,
      scriptCount: input.scriptCount,
      boxCode: box.boxCode,
      autoAcknowledged: input.actorCanManage,
    },
  });
  return bundleShape(bundle);
}

export async function acknowledgeBundle(input: {
  bundleId: string;
  actorId: string;
}): Promise<ScriptBundleShape> {
  const bundle = await ScriptBundle.findById(input.bundleId);
  if (!bundle) throw new Error("বান্ডিল পাওয়া যায়নি");
  if (bundle.status === "VOID" || bundle.status === "DISPOSED") {
    throw new Error("বাতিল/নিষ্পত্তি হওয়া বান্ডিল গ্রহণ করা যায় না");
  }
  if (bundle.acknowledgedAt) throw new Error("আগেই গ্রহণ করা হয়েছে");
  bundle.acknowledgedBy = new Types.ObjectId(input.actorId);
  bundle.acknowledgedAt = new Date();
  await bundle.save();
  await writeAudit({
    eventKind: "SCRIPT_BUNDLE_ACKNOWLEDGED",
    actorId: input.actorId,
    targetId: bundle._id.toString(),
    targetKind: "ScriptBundle",
  });
  return bundleShape(bundle);
}

// ---------------------------------------------------------------------------
// Desk checkout / check-in (AR-2, D-#444 — Office desk action only)
// ---------------------------------------------------------------------------

export async function checkOutBundle(input: {
  bundleId: string;
  toUserId: string;
  purpose: string;
  expectedReturnDateKey?: string;
  actorId: string;
}): Promise<ScriptBundleShape> {
  const bundle = await ScriptBundle.findById(input.bundleId);
  if (!bundle) throw new Error("বান্ডিল পাওয়া যায়নি");
  if (bundle.status !== "FILED") {
    throw new Error("শুধু সংরক্ষিত (FILED) বান্ডিল বের করা যায়");
  }
  if (!input.purpose.trim()) throw new Error("কারণ লেখা আবশ্যক");
  bundle.checkouts.push({
    toUserId: new Types.ObjectId(input.toUserId),
    purpose: input.purpose.trim(),
    expectedReturnDateKey: input.expectedReturnDateKey ?? null,
    checkedOutBy: new Types.ObjectId(input.actorId),
    checkedOutAt: new Date(),
    returnedBy: null,
    returnedAt: null,
    returnNote: null,
  });
  bundle.status = "CHECKED_OUT";
  await bundle.save();
  await writeAudit({
    eventKind: "SCRIPT_BUNDLE_CHECKED_OUT",
    actorId: input.actorId,
    targetId: bundle._id.toString(),
    targetKind: "ScriptBundle",
    meta: {
      toUserId: input.toUserId,
      purpose: input.purpose.trim(),
      expectedReturnDateKey: input.expectedReturnDateKey,
    },
  });
  return bundleShape(bundle);
}

export async function checkInBundle(input: {
  bundleId: string;
  note?: string;
  /** Optional re-file into a different (ACTIVE) box. */
  boxId?: string;
  actorId: string;
}): Promise<ScriptBundleShape> {
  const bundle = await ScriptBundle.findById(input.bundleId);
  if (!bundle) throw new Error("বান্ডিল পাওয়া যায়নি");
  if (bundle.status !== "CHECKED_OUT") {
    throw new Error("বান্ডিলটি বের করা অবস্থায় নেই");
  }
  const open = bundle.checkouts[bundle.checkouts.length - 1];
  open.returnedBy = new Types.ObjectId(input.actorId);
  open.returnedAt = new Date();
  open.returnNote = input.note?.trim() || null;
  let reboxedTo: string | undefined;
  if (input.boxId && input.boxId !== bundle.boxId.toString()) {
    const box = await StorageBox.findById(input.boxId).lean();
    if (!box) throw new Error("বাক্স পাওয়া যায়নি");
    if (box.status !== "ACTIVE") {
      throw new Error(`বাক্স ${box.boxCode} বন্ধ — নতুন বান্ডিল রাখা যাবে না`);
    }
    bundle.boxId = new Types.ObjectId(input.boxId);
    reboxedTo = box.boxCode;
  }
  bundle.status = "FILED";
  bundle.markModified("checkouts");
  await bundle.save();
  await writeAudit({
    eventKind: "SCRIPT_BUNDLE_CHECKED_IN",
    actorId: input.actorId,
    targetId: bundle._id.toString(),
    targetKind: "ScriptBundle",
    meta: { note: open.returnNote, reboxedTo },
  });
  return bundleShape(bundle);
}

// ---------------------------------------------------------------------------
// Retention + disposal / void (AR-3, D-#446)
// ---------------------------------------------------------------------------

/** The PROTECTED academic years: the current one + the one immediately before
 *  it (by startDate). Derived at request time — no stored flag, no scheduler. */
export async function protectedYearIds(): Promise<Types.ObjectId[]> {
  const current = await AcademicYear.findOne({ current: true }).lean();
  if (!current) return [];
  const previous = await AcademicYear.findOne({ startDate: { $lt: current.startDate } })
    .sort({ startDate: -1 })
    .lean();
  return previous ? [current._id, previous._id] : [current._id];
}

export async function listDisposable(): Promise<ScriptBundleShape[]> {
  const protectedIds = await protectedYearIds();
  const rows = await ScriptBundle.find({
    status: "FILED",
    academicYearId: { $nin: protectedIds },
  }).sort({ examDate: 1 });
  return rows.map(bundleShape);
}

export async function disposeBundle(input: {
  bundleId: string;
  reason: string;
  actorId: string;
}): Promise<ScriptBundleShape> {
  const bundle = await ScriptBundle.findById(input.bundleId);
  if (!bundle) throw new Error("বান্ডিল পাওয়া যায়নি");
  if (bundle.status === "CHECKED_OUT") {
    throw new Error("বের করা অবস্থায় নিষ্পত্তি করা যায় না — আগে ফেরত নিন");
  }
  if (bundle.status !== "FILED") throw new Error("বান্ডিলটি সংরক্ষিত অবস্থায় নেই");
  if (!input.reason.trim()) throw new Error("কারণ লেখা আবশ্যক");
  const protectedIds = await protectedYearIds();
  if (protectedIds.some((id) => id.equals(bundle.academicYearId))) {
    throw new Error("চলতি বা আগের শিক্ষাবর্ষের খাতা নিষ্পত্তি করা যায় না (D-#446)");
  }
  bundle.status = "DISPOSED";
  bundle.disposedBy = new Types.ObjectId(input.actorId);
  bundle.disposedAt = new Date();
  bundle.disposeReason = input.reason.trim();
  await bundle.save();
  await writeAudit({
    eventKind: "SCRIPT_BUNDLE_DISPOSED",
    actorId: input.actorId,
    targetId: bundle._id.toString(),
    targetKind: "ScriptBundle",
    meta: { reason: bundle.disposeReason },
  });
  return bundleShape(bundle);
}

export async function voidBundle(input: {
  bundleId: string;
  reason: string;
  actorId: string;
}): Promise<ScriptBundleShape> {
  const bundle = await ScriptBundle.findById(input.bundleId);
  if (!bundle) throw new Error("বান্ডিল পাওয়া যায়নি");
  if (bundle.status !== "FILED") {
    throw new Error("শুধু সংরক্ষিত (FILED) বান্ডিল বাতিল করা যায়");
  }
  if (!input.reason.trim()) throw new Error("কারণ লেখা আবশ্যক");
  bundle.status = "VOID";
  bundle.voidedBy = new Types.ObjectId(input.actorId);
  bundle.voidedAt = new Date();
  bundle.voidReason = input.reason.trim();
  await bundle.save();
  await writeAudit({
    eventKind: "SCRIPT_BUNDLE_VOIDED",
    actorId: input.actorId,
    targetId: bundle._id.toString(),
    targetKind: "ScriptBundle",
    meta: { reason: bundle.voidReason },
  });
  return bundleShape(bundle);
}

// ---------------------------------------------------------------------------
// Reads (AR-1/AR-2/AR-3)
// ---------------------------------------------------------------------------

export async function getBundleForSource(
  kind: ArchiveSourceKind,
  refId: string,
): Promise<ScriptBundleShape | null> {
  const bundle = await ScriptBundle.findOne({
    "source.kind": kind,
    "source.refId": refId,
    status: { $ne: "VOID" },
  });
  return bundle ? bundleShape(bundle) : null;
}

export async function getBundle(bundleId: string): Promise<ScriptBundleShape | null> {
  const bundle = await ScriptBundle.findById(bundleId);
  return bundle ? bundleShape(bundle) : null;
}

export async function listBundles(filter: {
  academicYearId?: string;
  classLevel?: number;
  subject?: string;
  status?: string;
  boxId?: string;
  /** Case-insensitive substring over the human id (CT-C5-BAN-0001). */
  labelQuery?: string;
}): Promise<ScriptBundleShape[]> {
  const q: Record<string, unknown> = {};
  if (filter.academicYearId) q.academicYearId = filter.academicYearId;
  if (filter.classLevel !== undefined) q.classLevel = filter.classLevel;
  if (filter.subject) q.subject = filter.subject;
  if (filter.status) q.status = filter.status;
  if (filter.boxId) q.boxId = filter.boxId;
  if (filter.labelQuery?.trim()) {
    const escaped = filter.labelQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    q.sourceLabel = { $regex: escaped, $options: "i" };
  }
  const rows = await ScriptBundle.find(q).sort({ examDate: -1 }).limit(500);
  return rows.map(bundleShape);
}

/** The batched lookup-line read (one query per screen, not per row): where are
 *  the scripts of THESE tests? Returns one entry per test that HAS a live
 *  bundle; absent = "ফাইল করা হয়নি" is the client's conclusion. */
export interface ArchiveLocationShape {
  testId: string;
  bundleId: string;
  boxCode: string;
  locationNote: string;
  status: string;
  /** Set while CHECKED_OUT — who holds the bundle. */
  holderName?: string;
}

export async function locationsForTests(testIds: string[]): Promise<ArchiveLocationShape[]> {
  if (testIds.length === 0) return [];
  const bundles = await ScriptBundle.find({
    "source.kind": "CLASS_TEST",
    "source.refId": { $in: testIds },
    status: { $ne: "VOID" },
  }).lean();
  if (bundles.length === 0) return [];
  const boxes = await StorageBox.find({ _id: { $in: bundles.map((b) => b.boxId) } })
    .select("boxCode locationNote")
    .lean();
  const boxOf = new Map(boxes.map((b) => [b._id.toString(), b]));
  const holderIds = bundles
    .filter((b) => b.status === "CHECKED_OUT")
    .map((b) => openCheckout(b)?.toUserId)
    .filter(Boolean) as Types.ObjectId[];
  const holders = holderIds.length
    ? await User.find({ _id: { $in: holderIds } }).select("name").lean()
    : [];
  const nameOf = new Map(holders.map((u) => [u._id.toString(), u.name as string]));
  return bundles.map((b) => {
    const box = boxOf.get(b.boxId.toString());
    const open = b.status === "CHECKED_OUT" ? openCheckout(b) : null;
    return {
      testId: b.source.refId.toString(),
      bundleId: b._id.toString(),
      boxCode: box?.boxCode ?? "?",
      locationNote: box?.locationNote ?? "",
      status: b.status,
      holderName: open ? nameOf.get(open.toUserId.toString()) : undefined,
    };
  });
}

export async function listBoxBundles(boxId: string): Promise<ScriptBundleShape[]> {
  const rows = await ScriptBundle.find({ boxId }).sort({ examDate: 1 });
  return rows.map(bundleShape);
}

export async function listOpenCheckouts(overdueOnly?: boolean): Promise<ScriptBundleShape[]> {
  const rows = await ScriptBundle.find({ status: "CHECKED_OUT" }).sort({ updatedAt: 1 });
  const shapes = rows.map(bundleShape);
  return overdueOnly ? shapes.filter((s) => s.overdue) : shapes;
}

export async function listPendingAcks(): Promise<ScriptBundleShape[]> {
  const rows = await ScriptBundle.find({
    status: { $in: ["FILED", "CHECKED_OUT"] },
    acknowledgedAt: null,
  }).sort({ filedAt: 1 });
  return rows.map(bundleShape);
}

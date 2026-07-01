/**
 * FeeSupportService (FIN-2B, prd-finance-fin2.md §3.B/§6, J-FIN2-5..J-FIN2-7,
 * D-#226/#227/#248) — the zakat / 3rd-party fee-support sub-system: providers,
 * effective-dated append-only allocations, the derived provider statement (owed-vs-paid),
 * provider receipts, and the guardian fee-due chase.
 *
 * Build ruling D-#248: the fee posting (FIN-2A) books the GROSS once; the provider/guardian
 * split is a DERIVED memo (via the pure `splitFee` over each FEE_COLLECTION posting × the
 * allocation active on its date) — it raises NO extra ledger movement, so cash is never
 * double-counted (§3.B "the receivable is a memo, not a second cash-in"). A ProviderReceipt
 * settles the receivable memo (it does not auto-post a second cash-in).
 *
 * Identity/operational plane; NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import {
  FINANCE_STUDENT_FEE_HEADS,
  FEE_COVERAGE_TYPES,
  FINANCE_PAYMENT_MODES,
} from "@scd/shared";
import { FeeProvider, type IFeeProvider } from "../models/FeeProvider";
import { FeeSupportAllocation, type IFeeSupportAllocation } from "../models/FeeSupportAllocation";
import { ProviderReceipt, type IProviderReceipt } from "../models/ProviderReceipt";
import { FinancePosting } from "../models/FinancePosting";
import { Student } from "../../foundation/models/Student";
import {
  splitFee,
  activeAllocationFor,
  type CoverageItem,
  type FeeLine,
  type AllocationLike,
} from "../feeSplit";
import { FinanceError, type FinanceActor } from "./FinanceLedgerService";
import { renderTemplate } from "../../templates/services/MessageTemplateService";
import { emitFinanceFeeDue } from "../../notifications/services/emitters";
import { writeAudit } from "../../platform/services/AuditService";

const FEE_HEAD_SET = new Set<string>(FINANCE_STUDENT_FEE_HEADS);
const COVERAGE_TYPE_SET = new Set<string>(FEE_COVERAGE_TYPES);
const MODE_SET = new Set<string>(FINANCE_PAYMENT_MODES);

// --- Providers --------------------------------------------------------------

export interface ProviderInput {
  name: string;
  nameBn?: string | null;
  contact?: string | null;
  note?: string | null;
  active?: boolean;
}

export async function createFeeProvider(input: ProviderInput): Promise<IFeeProvider> {
  if (!input.name || !input.name.trim()) throw new FinanceError("প্রদানকারীর নাম প্রয়োজন");
  return FeeProvider.create({
    name: input.name.trim(),
    nameBn: input.nameBn ?? null,
    contact: input.contact ?? null,
    note: input.note ?? null,
    active: input.active ?? true,
  });
}

export async function listFeeProviders(): Promise<IFeeProvider[]> {
  return FeeProvider.find().sort({ name: 1 });
}

// --- Allocations (effective-dated, append-only) -----------------------------

export interface SetAllocationInput {
  studentId: string;
  providerId: string;
  coverage: CoverageItem[];
  effectiveDate: Date;
  endDate?: Date | null;
  status?: string;
  note?: string | null;
}

function assertCoverage(coverage: CoverageItem[]): void {
  if (!Array.isArray(coverage) || coverage.length === 0) {
    throw new FinanceError("অন্তত একটি কভারেজ খাত প্রয়োজন");
  }
  for (const c of coverage) {
    if (!FEE_HEAD_SET.has(c.head)) throw new FinanceError(`অজানা ফি খাত: ${c.head}`);
    if (!COVERAGE_TYPE_SET.has(c.type)) throw new FinanceError(`অজানা কভারেজ টাইপ: ${c.type}`);
    if (c.type === "AMOUNT" && (c.amount == null || !Number.isFinite(c.amount) || c.amount <= 0)) {
      throw new FinanceError(`“${c.head}” খাতের জন্য একটি ধনাত্মক পরিমাণ প্রয়োজন`);
    }
  }
}

/** Declare (append) a fee-support allocation. A change is a NEW dated row (D-#226). */
export async function setFeeSupportAllocation(
  input: SetAllocationInput,
  actor: FinanceActor,
): Promise<IFeeSupportAllocation> {
  if (!(input.effectiveDate instanceof Date) || Number.isNaN(input.effectiveDate.getTime())) {
    throw new FinanceError("কার্যকর তারিখ বৈধ নয়");
  }
  assertCoverage(input.coverage);
  const provider = await FeeProvider.findById(input.providerId).lean();
  if (!provider) throw new FinanceError("প্রদানকারী পাওয়া যায়নি");

  const row = await FeeSupportAllocation.create({
    studentId: input.studentId,
    providerId: input.providerId,
    coverage: input.coverage.map((c) => ({ head: c.head, type: c.type, amount: c.type === "AMOUNT" ? c.amount : null })),
    effectiveDate: input.effectiveDate,
    endDate: input.endDate ?? null,
    status: input.status === "ENDED" ? "ENDED" : "ACTIVE",
    note: input.note ?? null,
    enteredByUserId: actor.userId,
  });

  await writeAudit({
    eventKind: "FEE_SUPPORT_ALLOCATION_SET",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: row._id,
    targetKind: "FeeSupportAllocation",
    meta: { studentId: input.studentId, providerId: input.providerId, status: row.status, effectiveDate: input.effectiveDate.toISOString() },
  });
  return row;
}

/** Load a student's allocations as the pure shape (newest included). */
async function loadAllocations(filter: Record<string, unknown> = {}): Promise<Array<AllocationLike & { providerId: string }>> {
  const rows = await FeeSupportAllocation.find(filter).lean<
    Array<{ studentId: Types.ObjectId; providerId: Types.ObjectId; coverage: CoverageItem[]; effectiveDate: Date; endDate?: Date | null; status: string; createdAt: Date }>
  >();
  return rows.map((r) => ({
    studentId: r.studentId.toString(),
    providerId: r.providerId.toString(),
    coverage: r.coverage,
    effectiveDate: new Date(r.effectiveDate),
    endDate: r.endDate ? new Date(r.endDate) : null,
    status: r.status,
    createdAt: new Date(r.createdAt),
  }));
}

// --- Provider receipts ------------------------------------------------------

export interface ProviderReceiptInput {
  providerId: string;
  amount: number;
  date: Date;
  mode: string;
  note?: string | null;
}

export async function recordProviderReceipt(
  input: ProviderReceiptInput,
  actor: FinanceActor,
): Promise<IProviderReceipt> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new FinanceError("পরিমাণ অবশ্যই ধনাত্মক");
  if (!MODE_SET.has(input.mode)) throw new FinanceError(`অজানা মোড: ${input.mode}`);
  if (!(input.date instanceof Date) || Number.isNaN(input.date.getTime())) throw new FinanceError("তারিখ বৈধ নয়");
  const provider = await FeeProvider.findById(input.providerId).lean();
  if (!provider) throw new FinanceError("প্রদানকারী পাওয়া যায়নি");

  const row = await ProviderReceipt.create({
    providerId: input.providerId,
    amount: input.amount,
    date: input.date,
    mode: input.mode,
    note: input.note ?? null,
    enteredByUserId: actor.userId,
  });
  await writeAudit({
    eventKind: "PROVIDER_RECEIPT_RECORDED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: row._id,
    targetKind: "ProviderReceipt",
    meta: { providerId: input.providerId, amount: input.amount, mode: input.mode, date: input.date.toISOString() },
  });
  return row;
}

// --- Derived reads (provider statement + guardian due) ----------------------

interface FeePostingLite {
  studentId: string;
  date: Date;
  feeLines: FeeLine[];
  reversed: boolean;
}

/** Load FEE_COLLECTION postings (with student + lines) as the pure shape. */
async function loadFeePostings(filter: Record<string, unknown> = {}): Promise<FeePostingLite[]> {
  const rows = await FinancePosting.find({ kind: "FEE_COLLECTION", studentId: { $ne: null }, ...filter }).lean<
    Array<{ studentId: Types.ObjectId; date: Date; feeLines?: FeeLine[]; reversesPostingId?: unknown }>
  >();
  return rows.map((r) => ({
    studentId: r.studentId.toString(),
    date: new Date(r.date),
    feeLines: r.feeLines ?? [],
    reversed: r.reversesPostingId != null,
  }));
}

/** The provider-due raised against a student's fee postings (derived via splitFee on the
 *  allocation active on each posting's date). A reversal subtracts. */
function providerDueForStudent(
  postings: readonly FeePostingLite[],
  allocations: readonly (AllocationLike & { providerId: string })[],
  studentId: string,
  providerId: string,
): number {
  let due = 0;
  for (const p of postings) {
    if (p.studentId !== studentId) continue;
    const alloc = activeAllocationFor(allocations, studentId, p.date);
    if (!alloc || alloc.providerId !== providerId) continue;
    const split = splitFee(p.feeLines, alloc.coverage);
    due += p.reversed ? -split.providerDue : split.providerDue;
  }
  return due;
}

export interface ProviderStatement {
  providerId: string;
  providerName: string;
  raised: number;
  received: number;
  outstanding: number;
}

/** Every provider's statement (FIN-6A dashboard rollup — zakat applied + receivables). */
export async function providerStatements(): Promise<ProviderStatement[]> {
  const providers = await FeeProvider.find().lean<Array<{ _id: Types.ObjectId }>>();
  return Promise.all(providers.map((p) => providerStatement(p._id.toString())));
}

/** The school-wide outstanding guardian-due across all fee postings (FIN-6A dashboard,
 *  derived via splitFee × the allocation active on each posting's date). */
export async function totalGuardianDueOutstanding(asOf: Date = new Date()): Promise<number> {
  const [postings, allocations] = await Promise.all([
    loadFeePostings({ date: { $lte: asOf } }),
    loadAllocations(),
  ]);
  let due = 0;
  for (const p of postings) {
    const alloc = activeAllocationFor(allocations, p.studentId, p.date);
    const split = splitFee(p.feeLines, alloc?.coverage ?? []);
    due += p.reversed ? -split.guardianDue : split.guardianDue;
  }
  return due;
}

/** Owed-vs-paid for a provider (J-FIN2-6): Σ provider-due raised − Σ receipts. */
export async function providerStatement(providerId: string): Promise<ProviderStatement> {
  const provider = await FeeProvider.findById(providerId).lean<{ name: string }>();
  if (!provider) throw new FinanceError("প্রদানকারী পাওয়া যায়নি");

  const allocations = await loadAllocations({ providerId });
  const studentIds = [...new Set(allocations.map((a) => a.studentId))];
  const postings = studentIds.length ? await loadFeePostings({ studentId: { $in: studentIds.map((s) => new Types.ObjectId(s)) } }) : [];

  let raised = 0;
  for (const sid of studentIds) raised += providerDueForStudent(postings, allocations, sid, providerId);

  const receipts = await ProviderReceipt.find({ providerId }).lean<Array<{ amount: number }>>();
  const received = receipts.reduce((s, r) => s + r.amount, 0);

  return { providerId, providerName: provider.name, raised, received, outstanding: raised - received };
}

export interface GuardianDue {
  studentId: string;
  studentName: string;
  guardianDue: number;
}

/** The guardian's remaining due across a student's fee postings (derived via splitFee). */
export async function guardianDueFor(studentId: string): Promise<number> {
  const [postings, allocations] = await Promise.all([
    loadFeePostings({ studentId: new Types.ObjectId(studentId) }),
    loadAllocations({ studentId: new Types.ObjectId(studentId) }),
  ]);
  let due = 0;
  for (const p of postings) {
    const alloc = activeAllocationFor(allocations, studentId, p.date);
    const split = splitFee(p.feeLines, alloc?.coverage ?? []);
    due += p.reversed ? -split.guardianDue : split.guardianDue;
  }
  return due;
}

// --- Guardian fee-due chase -------------------------------------------------

export interface FeeDueChaseOutcome {
  studentId: string;
  studentName: string;
  guardianDue: number;
  messageBn: string;
  waLink: string | null;
  unreachableByWa: boolean;
  notifiedGuardianIds: string[];
}

/** wa.me click-to-send link (ADR-003 — always a MANUAL send; null when no phone). */
export function feeDueWaLink(phone: string | undefined | null, message: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/**
 * Run the guardian fee-due chase for one student (J-FIN2-7): render the body ONCE from the
 * MT registry (never inline), build a wa.me link for the family phone, emit FINANCE_FEE_DUE
 * to login-enabled guardians, audit FINANCE_FEE_DUE_CHASED. A zero-due student is skipped.
 */
export async function chaseFeeDue(
  studentId: string,
  actor: FinanceActor,
  asOf: Date = new Date(),
): Promise<FeeDueChaseOutcome | null> {
  const student = await Student.findById(studentId).lean<{ _id: Types.ObjectId; name: string; nameBn?: string; phone?: string }>();
  if (!student) throw new FinanceError("শিক্ষার্থী পাওয়া যায়নি");

  const guardianDue = await guardianDueFor(studentId);
  if (guardianDue <= 0) return null;

  const studentName = student.nameBn || student.name;
  const params = { StudentName: studentName, AmountDue: guardianDue };
  const titleBn = await renderTemplate("finance.fee_due.chase.title");
  const bodyBn = await renderTemplate("finance.fee_due.chase.body", params);
  const waBody = await renderTemplate("finance.fee_due.chase.wa", params);

  const waLink = feeDueWaLink(student.phone, waBody);
  const asOfKey = asOf.toISOString().slice(0, 10);
  const notifiedGuardianIds = await emitFinanceFeeDue({ studentId, asOfKey, titleBn, messageBn: bodyBn });

  await writeAudit({
    eventKind: "FINANCE_FEE_DUE_CHASED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: student._id,
    targetKind: "Student",
    meta: { guardianDue, asOfKey, notified: notifiedGuardianIds.length, reachableByWa: waLink != null },
  });

  return {
    studentId,
    studentName,
    guardianDue,
    messageBn: bodyBn,
    waLink,
    unreachableByWa: waLink == null,
    notifiedGuardianIds,
  };
}

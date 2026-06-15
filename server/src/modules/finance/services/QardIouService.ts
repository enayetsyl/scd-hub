/**
 * QardIouService (FIN-3, prd-finance-fin3.md §3/§6, J-FIN3-1..J-FIN3-5, D-#232/#234) —
 * the Qard-e-Hasana / IOU register: a saved party master + append-only entries, with the
 * per-party outstanding + overdue derived (pure `qardIouMath`). One entry carries both the
 * cash and control effects (folded into `ledgerBalanceAsOf` — no FinancePosting twin).
 *
 * Staff salary advances are NOT recordable here — HR owns them (D-#188); this service has
 * no staff-advance path. Identity/operational plane; NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import {
  FINANCE_PARTY_KINDS,
  QARD_IOU_TYPES,
  QARD_IOU_DIRECTIONS,
  FINANCE_PAYMENT_MODES,
} from "@scd/shared";
import { FinanceParty, type IFinanceParty } from "../models/FinanceParty";
import { QardIouEntry, type IQardIouEntry } from "../models/QardIouEntry";
import { FinanceError, type FinanceActor } from "./FinanceLedgerService";
import {
  partyOutstanding as partyOutstandingPure,
  overdueList as overdueListPure,
  type QardEntryLike,
  type OverdueRow,
} from "../qardIouMath";
import { writeAudit } from "../../platform/services/AuditService";

const PARTY_KIND_SET = new Set<string>(FINANCE_PARTY_KINDS);
const TYPE_SET = new Set<string>(QARD_IOU_TYPES);
const DIRECTION_SET = new Set<string>(QARD_IOU_DIRECTIONS);
const MODE_SET = new Set<string>(FINANCE_PAYMENT_MODES);

// --- Party master -----------------------------------------------------------

export interface PartyInput {
  name: string;
  nameBn?: string | null;
  kind: string;
  contact?: string | null;
  note?: string | null;
  active?: boolean;
}

export async function setParty(input: PartyInput, actor: FinanceActor): Promise<IFinanceParty> {
  if (!input.name || !input.name.trim()) throw new FinanceError("পক্ষের নাম প্রয়োজন");
  if (!PARTY_KIND_SET.has(input.kind)) throw new FinanceError(`অজানা পক্ষের ধরন: ${input.kind}`);
  const row = await FinanceParty.create({
    name: input.name.trim(),
    nameBn: input.nameBn ?? null,
    kind: input.kind,
    contact: input.contact ?? null,
    note: input.note ?? null,
    active: input.active ?? true,
    enteredByUserId: actor.userId,
  });
  await writeAudit({
    eventKind: "FINANCE_PARTY_SET",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: row._id,
    targetKind: "FinanceParty",
    meta: { name: row.name, kind: row.kind },
  });
  return row;
}

export async function listParties(): Promise<IFinanceParty[]> {
  return FinanceParty.find().sort({ name: 1 });
}

// --- Register entries (append-only) -----------------------------------------

export interface ScheduleInput {
  dueDate: Date;
  amount: number;
}
export interface RecordEntryInput {
  partyId: string;
  type: string;
  direction: string;
  amount: number;
  date: Date;
  mode: string;
  dueDate?: Date | null;
  schedule?: ScheduleInput[];
  note?: string | null;
  reversesEntryId?: string | null;
}

/**
 * Append a register movement (J-FIN3-1/2/4). disburse/repay require amount > 0; an
 * ADJUSTMENT amount is SIGNED non-zero (opening = +, write-off = −). Audited
 * QARD_IOU_ENTRY_RECORDED. A reversal sets `reversesEntryId` (never an edit/delete).
 */
export async function recordEntry(input: RecordEntryInput, actor: FinanceActor): Promise<IQardIouEntry> {
  if (!TYPE_SET.has(input.type)) throw new FinanceError(`অজানা টাইপ: ${input.type}`);
  if (!DIRECTION_SET.has(input.direction)) throw new FinanceError(`অজানা দিকনির্দেশ: ${input.direction}`);
  if (!MODE_SET.has(input.mode)) throw new FinanceError(`অজানা মোড: ${input.mode}`);
  if (!(input.date instanceof Date) || Number.isNaN(input.date.getTime())) throw new FinanceError("তারিখ বৈধ নয়");
  if (!Number.isFinite(input.amount) || input.amount === 0) throw new FinanceError("পরিমাণ অবশ্যই অশূন্য সংখ্যা");
  if (input.direction !== "ADJUSTMENT" && input.amount <= 0) {
    throw new FinanceError("প্রদান/ফেরতের পরিমাণ অবশ্যই ধনাত্মক");
  }
  const party = await FinanceParty.findById(input.partyId).lean();
  if (!party) throw new FinanceError("পক্ষ পাওয়া যায়নি");

  const row = await QardIouEntry.create({
    partyId: input.partyId,
    type: input.type,
    direction: input.direction,
    amount: input.amount,
    date: input.date,
    mode: input.mode,
    dueDate: input.dueDate ?? null,
    schedule: input.schedule && input.schedule.length ? input.schedule : undefined,
    note: input.note ?? null,
    reversesEntryId: input.reversesEntryId ?? null,
    enteredByUserId: actor.userId,
  });
  await writeAudit({
    eventKind: "QARD_IOU_ENTRY_RECORDED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: row._id,
    targetKind: "QardIouEntry",
    meta: { partyId: input.partyId, type: input.type, direction: input.direction, amount: input.amount, date: input.date.toISOString() },
  });
  return row;
}

// --- Derived reads ----------------------------------------------------------

async function loadEntries(filter: Record<string, unknown> = {}): Promise<QardEntryLike[]> {
  const rows = await QardIouEntry.find(filter).lean<
    Array<{ type: string; direction: string; amount: number; date: Date; mode: string; partyId: Types.ObjectId; dueDate?: Date | null; reversesEntryId?: unknown }>
  >();
  return rows.map((r) => ({
    type: r.type,
    direction: r.direction,
    amount: r.amount,
    date: new Date(r.date),
    mode: r.mode,
    partyId: r.partyId.toString(),
    dueDate: r.dueDate ? new Date(r.dueDate) : null,
    reversesEntryId: r.reversesEntryId ?? null,
  }));
}

export interface PartyOutstanding {
  partyId: string;
  type: string;
  outstanding: number;
}

/** Per-party outstanding by type as of `asOf` (J-FIN3-1/2). */
export async function partyOutstanding(partyId: string, asOf: Date = new Date()): Promise<PartyOutstanding[]> {
  const entries = await loadEntries({ partyId: new Types.ObjectId(partyId) });
  return QARD_IOU_TYPES.map((type) => ({
    partyId,
    type,
    outstanding: partyOutstandingPure(entries, partyId, asOf, type),
  })).filter((r) => r.outstanding !== 0);
}

/** Parties past-due unpaid as of `asOf`, ranked by lateness (J-FIN3-3). */
export async function overdueList(asOf: Date = new Date()): Promise<OverdueRow[]> {
  const entries = await loadEntries();
  return overdueListPure(entries, asOf);
}

/** A party's register log, newest first (J-FIN3-4 audit trail). */
export async function partyEntries(partyId: string): Promise<IQardIouEntry[]> {
  return QardIouEntry.find({ partyId }).sort({ date: -1, createdAt: -1 });
}

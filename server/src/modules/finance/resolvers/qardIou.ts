/**
 * Qard/IOU register resolvers (FIN-3, prd-finance-fin3.md §3/§6, J-FIN3-1..J-FIN3-4).
 *
 * Party master + append-only entries + derived per-party outstanding / overdue. EVERY
 * field is gated `finance:manage` (Principal+Office); guardian none (REQ §5). Dates cross
 * as ISO strings. Identity/operational plane; no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { FinanceError, type FinanceActor } from "../services/FinanceLedgerService";
import {
  setParty,
  listParties,
  recordEntry,
  partyOutstanding,
  overdueList,
  partyEntries,
  type PartyOutstanding,
} from "../services/QardIouService";
import type { OverdueRow } from "../qardIouMath";
import type { IFinanceParty } from "../models/FinanceParty";
import type { IQardIouEntry } from "../models/QardIouEntry";

function actorOf(ctx: AppContext): FinanceActor {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return { userId: ctx.auth.userId, role: ctx.auth.role };
}
function parseDate(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new FinanceError(`তারিখ বৈধ নয়: ${value}`);
  return d;
}

const ScheduleInputRef = builder.inputType("QardIouScheduleInput", {
  fields: (t) => ({
    dueDate: t.string({ required: true }),
    amount: t.float({ required: true }),
  }),
});

// --- Output types -----------------------------------------------------------

const PartyRef = builder.objectRef<IFinanceParty>("FinanceParty");
PartyRef.implement({
  fields: (t) => ({
    id: t.id({ resolve: (p) => p._id.toString() }),
    name: t.exposeString("name"),
    nameBn: t.string({ nullable: true, resolve: (p) => p.nameBn ?? null }),
    kind: t.exposeString("kind"),
    contact: t.string({ nullable: true, resolve: (p) => p.contact ?? null }),
    note: t.string({ nullable: true, resolve: (p) => p.note ?? null }),
    active: t.exposeBoolean("active"),
  }),
});

const EntryRef = builder.objectRef<IQardIouEntry>("QardIouEntry");
EntryRef.implement({
  description: "One append-only Qard/IOU register movement (FIN-3).",
  fields: (t) => ({
    id: t.id({ resolve: (e) => e._id.toString() }),
    partyId: t.string({ resolve: (e) => e.partyId.toString() }),
    type: t.exposeString("type"),
    direction: t.exposeString("direction"),
    amount: t.exposeFloat("amount"),
    date: t.string({ resolve: (e) => e.date.toISOString() }),
    mode: t.exposeString("mode"),
    dueDate: t.string({ nullable: true, resolve: (e) => (e.dueDate ? e.dueDate.toISOString() : null) }),
    note: t.string({ nullable: true, resolve: (e) => e.note ?? null }),
    reversesEntryId: t.string({ nullable: true, resolve: (e) => (e.reversesEntryId ? e.reversesEntryId.toString() : null) }),
    createdAt: t.string({ resolve: (e) => e.createdAt.toISOString() }),
  }),
});

const OutstandingRef = builder.objectRef<PartyOutstanding>("QardIouOutstanding");
OutstandingRef.implement({
  fields: (t) => ({
    partyId: t.exposeString("partyId"),
    type: t.exposeString("type"),
    outstanding: t.exposeFloat("outstanding"),
  }),
});

const OverdueRef = builder.objectRef<OverdueRow>("QardIouOverdue");
OverdueRef.implement({
  fields: (t) => ({
    partyId: t.exposeString("partyId"),
    type: t.exposeString("type"),
    outstanding: t.exposeFloat("outstanding"),
    oldestDueDate: t.string({ resolve: (o) => o.oldestDueDate.toISOString() }),
    daysLate: t.exposeInt("daysLate"),
  }),
});

// --- Mutations (finance:manage) ---------------------------------------------

builder.mutationField("setFinanceParty", (t) =>
  t.field({
    type: PartyRef,
    description: "Create a Qard/IOU counterparty (non-staff). Requires finance:manage. Audited FINANCE_PARTY_SET.",
    authScopes: { hasPermission: "finance:manage" },
    args: {
      name: t.arg.string({ required: true }),
      nameBn: t.arg.string({ required: false }),
      kind: t.arg.string({ required: true }),
      contact: t.arg.string({ required: false }),
      note: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      setParty({ name: args.name, nameBn: args.nameBn ?? null, kind: args.kind, contact: args.contact ?? null, note: args.note ?? null }, actorOf(ctx)),
  }),
);

builder.mutationField("recordQardIouEntry", (t) =>
  t.field({
    type: EntryRef,
    description:
      "Append a Qard/IOU register movement (NEW_DISBURSEMENT/REPAYMENT_RECEIVED/ADJUSTMENT). One record " +
      "carries both the cash and control effects. ADJUSTMENT amount is signed. Requires finance:manage. " +
      "Audited QARD_IOU_ENTRY_RECORDED.",
    authScopes: { hasPermission: "finance:manage" },
    args: {
      partyId: t.arg.string({ required: true }),
      type: t.arg.string({ required: true }),
      direction: t.arg.string({ required: true }),
      amount: t.arg.float({ required: true }),
      date: t.arg.string({ required: true }),
      mode: t.arg.string({ required: true }),
      dueDate: t.arg.string({ required: false }),
      schedule: t.arg({ type: [ScheduleInputRef], required: false }),
      note: t.arg.string({ required: false }),
      reversesEntryId: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      recordEntry(
        {
          partyId: args.partyId,
          type: args.type,
          direction: args.direction,
          amount: args.amount,
          date: parseDate(args.date),
          mode: args.mode,
          dueDate: args.dueDate ? parseDate(args.dueDate) : null,
          schedule: args.schedule ? args.schedule.map((s) => ({ dueDate: parseDate(s.dueDate), amount: s.amount })) : undefined,
          note: args.note ?? null,
          reversesEntryId: args.reversesEntryId ?? null,
        },
        actorOf(ctx),
      ),
  }),
);

// --- Reads (finance:manage) -------------------------------------------------

builder.queryField("financeParties", (t) =>
  t.field({
    type: [PartyRef],
    description: "All Qard/IOU counterparties (A→Z). Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    resolve: () => listParties(),
  }),
);

builder.queryField("qardIouPartyOutstanding", (t) =>
  t.field({
    type: [OutstandingRef],
    description: "A party's outstanding by type as of `asOf` (default today). Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { partyId: t.arg.string({ required: true }), asOf: t.arg.string({ required: false }) },
    resolve: (_root, args) => partyOutstanding(args.partyId, args.asOf ? parseDate(args.asOf) : undefined),
  }),
);

builder.queryField("qardIouOverdue", (t) =>
  t.field({
    type: [OverdueRef],
    description: "Parties past-due unpaid as of `asOf`, ranked by lateness. Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { asOf: t.arg.string({ required: false }) },
    resolve: (_root, args) => overdueList(args.asOf ? parseDate(args.asOf) : undefined),
  }),
);

builder.queryField("qardIouPartyEntries", (t) =>
  t.field({
    type: [EntryRef],
    description: "A party's register log, newest first. Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { partyId: t.arg.string({ required: true }) },
    resolve: (_root, args) => partyEntries(args.partyId),
  }),
);

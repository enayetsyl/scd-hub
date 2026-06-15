/**
 * Fee-support resolvers (FIN-2B, prd-finance-fin2.md §3.B/§6, J-FIN2-5..J-FIN2-7).
 *
 * Providers, effective-dated allocations, provider receipts + statement, and the guardian
 * fee-due chase. EVERY field is gated `finance:manage` (Principal+Office); the guardian is
 * a recipient only — no field here is guardian-readable (REQ §5).
 *
 * Identity/operational plane; no corpus path (ADR-005). Dates cross as ISO strings.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { FinanceError, type FinanceActor } from "../services/FinanceLedgerService";
import {
  createFeeProvider,
  listFeeProviders,
  setFeeSupportAllocation,
  recordProviderReceipt,
  providerStatement,
  chaseFeeDue,
  type ProviderStatement,
  type FeeDueChaseOutcome,
} from "../services/FeeSupportService";
import type { IFeeProvider } from "../models/FeeProvider";
import type { IFeeSupportAllocation } from "../models/FeeSupportAllocation";
import type { IProviderReceipt } from "../models/ProviderReceipt";

function actorOf(ctx: AppContext): FinanceActor {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return { userId: ctx.auth.userId, role: ctx.auth.role };
}
function parseDate(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new FinanceError(`তারিখ বৈধ নয়: ${value}`);
  return d;
}

// --- Input types ------------------------------------------------------------

const CoverageItemInputRef = builder.inputType("FinanceCoverageItemInput", {
  description: "One per-head coverage entry (head ∈ FINANCE_STUDENT_FEE_HEADS; type FULL|AMOUNT; amount for AMOUNT).",
  fields: (t) => ({
    head: t.string({ required: true }),
    type: t.string({ required: true }),
    amount: t.float({ required: false }),
  }),
});

// --- Output types -----------------------------------------------------------

const ProviderRef = builder.objectRef<IFeeProvider>("FeeProvider");
ProviderRef.implement({
  fields: (t) => ({
    id: t.id({ resolve: (p) => p._id.toString() }),
    name: t.exposeString("name"),
    nameBn: t.string({ nullable: true, resolve: (p) => p.nameBn ?? null }),
    contact: t.string({ nullable: true, resolve: (p) => p.contact ?? null }),
    note: t.string({ nullable: true, resolve: (p) => p.note ?? null }),
    active: t.exposeBoolean("active"),
  }),
});

const CoverageItemRef = builder.objectRef<{ head: string; type: string; amount?: number | null }>("FinanceCoverageItem");
CoverageItemRef.implement({
  fields: (t) => ({
    head: t.exposeString("head"),
    type: t.exposeString("type"),
    amount: t.float({ nullable: true, resolve: (c) => c.amount ?? null }),
  }),
});

const AllocationRef = builder.objectRef<IFeeSupportAllocation>("FeeSupportAllocation");
AllocationRef.implement({
  description: "A roster-linked, effective-dated, append-only fee-support allocation (FIN-2B).",
  fields: (t) => ({
    id: t.id({ resolve: (a) => a._id.toString() }),
    studentId: t.string({ resolve: (a) => a.studentId.toString() }),
    providerId: t.string({ resolve: (a) => a.providerId.toString() }),
    coverage: t.field({ type: [CoverageItemRef], resolve: (a) => a.coverage.map((c) => ({ head: c.head, type: c.type, amount: c.amount ?? null })) }),
    effectiveDate: t.string({ resolve: (a) => a.effectiveDate.toISOString() }),
    endDate: t.string({ nullable: true, resolve: (a) => (a.endDate ? a.endDate.toISOString() : null) }),
    status: t.exposeString("status"),
    note: t.string({ nullable: true, resolve: (a) => a.note ?? null }),
    createdAt: t.string({ resolve: (a) => a.createdAt.toISOString() }),
  }),
});

const ReceiptRef = builder.objectRef<IProviderReceipt>("ProviderReceipt");
ReceiptRef.implement({
  fields: (t) => ({
    id: t.id({ resolve: (r) => r._id.toString() }),
    providerId: t.string({ resolve: (r) => r.providerId.toString() }),
    amount: t.exposeFloat("amount"),
    date: t.string({ resolve: (r) => r.date.toISOString() }),
    mode: t.exposeString("mode"),
    note: t.string({ nullable: true, resolve: (r) => r.note ?? null }),
  }),
});

const StatementRef = builder.objectRef<ProviderStatement>("FinanceProviderStatement");
StatementRef.implement({
  description: "A provider's owed-vs-paid (derived): Σ provider-due raised vs Σ receipts (J-FIN2-6).",
  fields: (t) => ({
    providerId: t.exposeString("providerId"),
    providerName: t.exposeString("providerName"),
    raised: t.exposeFloat("raised"),
    received: t.exposeFloat("received"),
    outstanding: t.exposeFloat("outstanding"),
  }),
});

const ChaseOutcomeRef = builder.objectRef<FeeDueChaseOutcome>("FinanceFeeDueChaseOutcome");
ChaseOutcomeRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    guardianDue: t.exposeFloat("guardianDue"),
    messageBn: t.exposeString("messageBn"),
    waLink: t.string({ nullable: true, resolve: (o) => o.waLink }),
    unreachableByWa: t.exposeBoolean("unreachableByWa"),
    notifiedGuardianIds: t.exposeStringList("notifiedGuardianIds"),
  }),
});

// --- Mutations (finance:manage) ---------------------------------------------

builder.mutationField("createFeeProvider", (t) =>
  t.field({
    type: ProviderRef,
    description: "Create a fee-support provider (zakat fund / sponsor). Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: {
      name: t.arg.string({ required: true }),
      nameBn: t.arg.string({ required: false }),
      contact: t.arg.string({ required: false }),
      note: t.arg.string({ required: false }),
    },
    resolve: (_root, args) => createFeeProvider({ name: args.name, nameBn: args.nameBn ?? null, contact: args.contact ?? null, note: args.note ?? null }),
  }),
);

builder.mutationField("setFeeSupportAllocation", (t) =>
  t.field({
    type: AllocationRef,
    description:
      "Declare a student's fee-support allocation (effective-dated, append-only — a change is a NEW row). " +
      "Coverage is per-head FULL|AMOUNT. Requires finance:manage. Audited FEE_SUPPORT_ALLOCATION_SET.",
    authScopes: { hasPermission: "finance:manage" },
    args: {
      studentId: t.arg.string({ required: true }),
      providerId: t.arg.string({ required: true }),
      coverage: t.arg({ type: [CoverageItemInputRef], required: true }),
      effectiveDate: t.arg.string({ required: true }),
      endDate: t.arg.string({ required: false }),
      status: t.arg.string({ required: false }),
      note: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      setFeeSupportAllocation(
        {
          studentId: args.studentId,
          providerId: args.providerId,
          coverage: args.coverage.map((c) => ({ head: c.head, type: c.type, amount: c.amount ?? null })),
          effectiveDate: parseDate(args.effectiveDate),
          endDate: args.endDate ? parseDate(args.endDate) : null,
          status: args.status ?? "ACTIVE",
          note: args.note ?? null,
        },
        actorOf(ctx),
      ),
  }),
);

builder.mutationField("recordProviderReceipt", (t) =>
  t.field({
    type: ReceiptRef,
    description: "Record a provider's payment against its receivable. Requires finance:manage. Audited PROVIDER_RECEIPT_RECORDED.",
    authScopes: { hasPermission: "finance:manage" },
    args: {
      providerId: t.arg.string({ required: true }),
      amount: t.arg.float({ required: true }),
      date: t.arg.string({ required: true }),
      mode: t.arg.string({ required: true }),
      note: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      recordProviderReceipt({ providerId: args.providerId, amount: args.amount, date: parseDate(args.date), mode: args.mode, note: args.note ?? null }, actorOf(ctx)),
  }),
);

builder.mutationField("chaseFeeDue", (t) =>
  t.field({
    type: ChaseOutcomeRef,
    nullable: true,
    description:
      "Run the guardian fee-due chase for a student — wa.me for the family + inbox/push for login-enabled " +
      "guardians (FINANCE_FEE_DUE). Returns null when the student has no outstanding due. Requires finance:manage. " +
      "Audited FINANCE_FEE_DUE_CHASED.",
    authScopes: { hasPermission: "finance:manage" },
    args: {
      studentId: t.arg.string({ required: true }),
      asOf: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) => chaseFeeDue(args.studentId, actorOf(ctx), args.asOf ? parseDate(args.asOf) : undefined),
  }),
);

// --- Reads (finance:manage) -------------------------------------------------

builder.queryField("feeProviders", (t) =>
  t.field({
    type: [ProviderRef],
    description: "All fee-support providers (A→Z). Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    resolve: () => listFeeProviders(),
  }),
);

builder.queryField("financeProviderStatement", (t) =>
  t.field({
    type: StatementRef,
    description: "A provider's owed-vs-paid statement (derived). Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { providerId: t.arg.string({ required: true }) },
    resolve: (_root, args) => providerStatement(args.providerId),
  }),
);

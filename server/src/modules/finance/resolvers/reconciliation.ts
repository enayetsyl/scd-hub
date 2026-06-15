/**
 * Reconciliation resolvers (FIN-4, prd-finance-fin4.md §3/§6, J-FIN4-1..J-FIN4-4).
 *
 * Record a dual reconciliation (bank + per-ledger Eximus) and read the history /
 * unreconciled days. EVERY field is gated `finance:manage` (Principal+Office); guardian
 * none. Identity/operational plane; no corpus path (ADR-005). Dates cross as ISO strings.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { type FinanceActor } from "../services/FinanceLedgerService";
import {
  recordReconciliation,
  reconciliationHistory,
  latestReconciliation,
  unreconciledDays,
} from "../services/ReconciliationService";
import type { IReconciliationEntry, ILedgerTriple } from "../models/ReconciliationEntry";

function actorOf(ctx: AppContext): FinanceActor {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return { userId: ctx.auth.userId, role: ctx.auth.role };
}

const TripleInputRef = builder.inputType("FinanceLedgerTripleInput", {
  description: "A per-ledger figure (Cash/Bank/Online) — e.g. the entered Eximus closing per ledger.",
  fields: (t) => ({
    CASH: t.float({ required: true }),
    BANK: t.float({ required: true }),
    ONLINE: t.float({ required: true }),
  }),
});

const TripleRef = builder.objectRef<ILedgerTriple>("FinanceLedgerTriple");
TripleRef.implement({
  fields: (t) => ({
    CASH: t.exposeFloat("CASH"),
    BANK: t.exposeFloat("BANK"),
    ONLINE: t.exposeFloat("ONLINE"),
  }),
});

const ReconRef = builder.objectRef<IReconciliationEntry>("ReconciliationEntry");
ReconRef.implement({
  description: "One dated, append-only reconciliation: app (derived) vs bank + Eximus (FIN-4).",
  fields: (t) => ({
    id: t.id({ resolve: (r) => r._id.toString() }),
    date: t.string({ resolve: (r) => r.date.toISOString() }),
    bankStatementBalance: t.float({ nullable: true, resolve: (r) => r.bankStatementBalance ?? null }),
    appBankBalance: t.exposeFloat("appBankBalance"),
    bankDiff: t.float({ nullable: true, resolve: (r) => r.bankDiff ?? null }),
    eximusClosing: t.field({ type: TripleRef, nullable: true, resolve: (r) => r.eximusClosing ?? null }),
    appClosing: t.field({ type: TripleRef, resolve: (r) => r.appClosing }),
    eximusDiff: t.field({ type: TripleRef, nullable: true, resolve: (r) => r.eximusDiff ?? null }),
    note: t.string({ nullable: true, resolve: (r) => r.note ?? null }),
    createdAt: t.string({ resolve: (r) => r.createdAt.toISOString() }),
  }),
});

// --- Mutation (finance:manage) ----------------------------------------------

builder.mutationField("recordReconciliation", (t) =>
  t.field({
    type: ReconRef,
    description:
      "Record a reconciliation for a date — diffs the app's DERIVED balances against an entered bank " +
      "balance and/or per-ledger Eximus closing. Append-only (a re-reconcile is a new entry). Requires " +
      "finance:manage. Audited RECONCILIATION_RECORDED.",
    authScopes: { hasPermission: "finance:manage" },
    args: {
      date: t.arg.string({ required: true }),
      bankStatementBalance: t.arg.float({ required: false }),
      eximusClosing: t.arg({ type: TripleInputRef, required: false }),
      note: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      recordReconciliation(
        {
          date: args.date,
          bankStatementBalance: args.bankStatementBalance ?? null,
          eximusClosing: args.eximusClosing ?? null,
          note: args.note ?? null,
        },
        actorOf(ctx),
      ),
  }),
);

// --- Reads (finance:manage) -------------------------------------------------

builder.queryField("latestReconciliation", (t) =>
  t.field({
    type: ReconRef,
    nullable: true,
    description: "A date's current reconciliation (latest entry) or null. Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { date: t.arg.string({ required: true }) },
    resolve: (_root, args) => latestReconciliation(args.date),
  }),
);

builder.queryField("reconciliationHistory", (t) =>
  t.field({
    type: [ReconRef],
    description: "Reconciliation history over [from, to], newest first. Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { from: t.arg.string({ required: true }), to: t.arg.string({ required: true }) },
    resolve: (_root, args) => reconciliationHistory(args.from, args.to),
  }),
);

builder.queryField("unreconciledDays", (t) =>
  t.field({
    type: ["String"],
    description: "Days in [from, to] with finance activity but no reconciliation. Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { from: t.arg.string({ required: true }), to: t.arg.string({ required: true }) },
    resolve: (_root, args) => unreconciledDays(args.from, args.to),
  }),
);

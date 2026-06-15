/**
 * Finance ledger resolvers (FIN-1, prd-finance-fin1.md §3/§6, J-FIN1-1..J-FIN1-5).
 *
 * The ledger foundation surface: declare an opening balance (append-only) and read the
 * authoritative opening per ledger (and the single `ledgerBalanceAsOf` seam FIN-2
 * extends with postings). EVERY field is gated `authScopes: { hasPermission:
 * "finance:manage" }` — Principal+Office only; Teacher/Guardian are denied at the scope
 * layer (J-FIN1-5). Dates cross the wire as ISO strings (the codebase has no Date
 * scalar) and are parsed here.
 *
 * Identity/operational plane; no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import {
  setOpeningBalance,
  openingBalances,
  ledgerBalanceAsOf,
  FinanceError,
  type FinanceActor,
  type LedgerBalance,
} from "../services/FinanceLedgerService";
import type { ILedgerOpeningBalance } from "../models/LedgerOpeningBalance";

/** The acting Principal/Office (gated finance:manage) — the audit actor. */
function actorOf(ctx: AppContext): FinanceActor {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return { userId: ctx.auth.userId, role: ctx.auth.role };
}

/** Parse an ISO date arg (YYYY-MM-DD or full ISO); throw a Bangla 422 if invalid. */
function parseDate(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new FinanceError(`তারিখ বৈধ নয়: ${value}`);
  return d;
}

// --- Output types -----------------------------------------------------------

const LedgerBalanceRef = builder.objectRef<LedgerBalance>("FinanceLedgerBalance");
LedgerBalanceRef.implement({
  description:
    "One ledger's balance as of a query date (FIN-1: the authoritative opening; " +
    "opening + Σ(postings) from FIN-2). Derived — never stored.",
  fields: (t) => ({
    ledger: t.exposeString("ledger"),
    amount: t.exposeFloat("amount"),
  }),
});

const OpeningBalanceRef = builder.objectRef<ILedgerOpeningBalance>("LedgerOpeningBalance");
OpeningBalanceRef.implement({
  description:
    "A declared opening balance (append-only, effective-dated — FIN-1 §3). A correction " +
    "is a NEW row, never an overwrite; the latest declaration ≤ a query date is authoritative.",
  fields: (t) => ({
    id: t.id({ resolve: (r) => r._id.toString() }),
    ledger: t.exposeString("ledger"),
    amount: t.exposeFloat("amount"),
    effectiveDate: t.string({ resolve: (r) => r.effectiveDate.toISOString() }),
    note: t.string({ nullable: true, resolve: (r) => r.note ?? null }),
    enteredByUserId: t.string({ resolve: (r) => r.enteredByUserId.toString() }),
    createdAt: t.string({ resolve: (r) => r.createdAt.toISOString() }),
  }),
});

// --- Mutation (finance:manage) ----------------------------------------------

builder.mutationField("setLedgerOpeningBalance", (t) =>
  t.field({
    type: OpeningBalanceRef,
    description:
      "Declare a ledger's opening balance (effective-dated, append-only — a correction is " +
      "a NEW row). amount is SIGNED (a control ledger may be negative). effectiveDate is ISO. " +
      "Requires finance:manage. Audited FINANCE_OPENING_BALANCE_SET.",
    authScopes: { hasPermission: "finance:manage" },
    args: {
      ledger: t.arg.string({ required: true }),
      amount: t.arg.float({ required: true }),
      effectiveDate: t.arg.string({ required: true }),
      note: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      setOpeningBalance(
        {
          ledger: args.ledger,
          amount: args.amount,
          effectiveDate: parseDate(args.effectiveDate),
          note: args.note ?? null,
        },
        actorOf(ctx),
      ),
  }),
);

// --- Reads (finance:manage) -------------------------------------------------

builder.queryField("ledgerOpeningBalances", (t) =>
  t.field({
    type: [LedgerBalanceRef],
    description:
      "The authoritative opening per ledger as of `asOf` (default today), for all 5 ledgers " +
      "(un-declared ⇒ 0), derived. Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { asOf: t.arg.string({ required: false }) },
    resolve: (_root, args) => openingBalances(args.asOf ? parseDate(args.asOf) : undefined),
  }),
);

builder.queryField("ledgerBalanceAsOf", (t) =>
  t.field({
    type: LedgerBalanceRef,
    description:
      "One ledger's balance as of `asOf` (default today) — the seam FIN-2 extends with " +
      "Σ(postings). FIN-1 returns the authoritative opening. Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: {
      ledger: t.arg.string({ required: true }),
      asOf: t.arg.string({ required: false }),
    },
    resolve: async (_root, args) => {
      const amount = await ledgerBalanceAsOf(args.ledger, args.asOf ? parseDate(args.asOf) : undefined);
      return { ledger: args.ledger as LedgerBalance["ledger"], amount };
    },
  }),
);

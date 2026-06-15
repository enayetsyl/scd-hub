/**
 * Typed GraphQL operations for the Finance / Accounting module (FIN-6B app surfaces
 * over the FIN-1..FIN-6A server resolvers — server/src/modules/finance/*).
 * Hand-authored to mirror the resolvers exactly; NO server change. Kept in its own
 * module to avoid bloating operations.ts (same pattern as observation.ts).
 *
 * The app build does NOT validate against the live schema, so ops are plain gql
 * strings — but field names match the server EXACTLY. The snapshot ledger field is
 * named `in` (a JS keyword); it is aliased to `moneyIn` in the query so the TS is clean.
 */
import { gql } from "urql";

type NoVars = Record<string, never>;

// ---------------------------------------------------------------------------
// Shared sub-shapes
// ---------------------------------------------------------------------------

export interface FinanceAmountByHeadT {
  head: string;
  amount: number;
}
export interface FinanceLedgerVecT {
  CASH: number;
  BANK: number;
  ONLINE: number;
}
const AMOUNT_BY_HEAD = `head amount`;
const LEDGER_VEC = `CASH BANK ONLINE`;

// ---------------------------------------------------------------------------
// FIN-1 — ledgers + opening balances
// ---------------------------------------------------------------------------

export interface LedgerOpeningBalanceT {
  id: string;
  ledger: string;
  amount: number;
  effectiveDate: string;
  note: string | null;
  enteredByUserId: string;
  createdAt: string;
}
export interface FinanceLedgerBalanceT {
  ledger: string;
  amount: number;
}

const OPENING_BALANCE_FIELDS = `id ledger amount effectiveDate note enteredByUserId createdAt`;

export const SET_LEDGER_OPENING_BALANCE = gql<
  { setLedgerOpeningBalance: LedgerOpeningBalanceT },
  { ledger: string; amount: number; effectiveDate: string; note?: string | null }
>`
  mutation SetLedgerOpeningBalance($ledger: String!, $amount: Float!, $effectiveDate: String!, $note: String) {
    setLedgerOpeningBalance(ledger: $ledger, amount: $amount, effectiveDate: $effectiveDate, note: $note) {
      ${OPENING_BALANCE_FIELDS}
    }
  }
`;

export const LEDGER_OPENING_BALANCES_QUERY = gql<
  { ledgerOpeningBalances: FinanceLedgerBalanceT[] },
  { asOf?: string | null }
>`
  query LedgerOpeningBalances($asOf: String) {
    ledgerOpeningBalances(asOf: $asOf) { ledger amount }
  }
`;

export const LEDGER_BALANCE_AS_OF_QUERY = gql<
  { ledgerBalanceAsOf: FinanceLedgerBalanceT },
  { ledger: string; asOf?: string | null }
>`
  query LedgerBalanceAsOf($ledger: String!, $asOf: String) {
    ledgerBalanceAsOf(ledger: $ledger, asOf: $asOf) { ledger amount }
  }
`;

// ---------------------------------------------------------------------------
// FIN-2A — postings + daily snapshot + month-to-date + fee history
// ---------------------------------------------------------------------------

export interface FinanceFeeLineT {
  head: string;
  amount: number;
}
export interface FinancePostingT {
  id: string;
  date: string;
  kind: string;
  mode: string | null;
  amount: number;
  note: string | null;
  studentId: string | null;
  feeLines: FinanceFeeLineT[] | null;
  incomeHead: string | null;
  expenseHead: string | null;
  movementHead: string | null;
  toLedger: string | null;
  salaryBaseAmount: number | null;
  reversesPostingId: string | null;
  createdAt: string;
}

const POSTING_FIELDS = `id date kind mode amount note studentId feeLines { head amount } incomeHead expenseHead movementHead toLedger salaryBaseAmount reversesPostingId createdAt`;

export interface FeeLineInput {
  head: string;
  amount: number;
}
export interface SalaryAdjustmentInput {
  label: string;
  amount: number;
}

export const RECORD_FINANCE_POSTING = gql<
  { recordFinancePosting: FinancePostingT },
  {
    date: string;
    kind: string;
    mode?: string | null;
    amount?: number | null;
    note?: string | null;
    studentId?: string | null;
    feeLines?: FeeLineInput[] | null;
    incomeHead?: string | null;
    expenseHead?: string | null;
    toLedger?: string | null;
    salaryBaseAmount?: number | null;
    salaryAdjustments?: SalaryAdjustmentInput[] | null;
  }
>`
  mutation RecordFinancePosting(
    $date: String!, $kind: String!, $mode: String, $amount: Float, $note: String,
    $studentId: String, $feeLines: [FeeLineInput!], $incomeHead: String, $expenseHead: String,
    $toLedger: String, $salaryBaseAmount: Float, $salaryAdjustments: [SalaryAdjustmentInput!]
  ) {
    recordFinancePosting(
      date: $date, kind: $kind, mode: $mode, amount: $amount, note: $note,
      studentId: $studentId, feeLines: $feeLines, incomeHead: $incomeHead, expenseHead: $expenseHead,
      toLedger: $toLedger, salaryBaseAmount: $salaryBaseAmount, salaryAdjustments: $salaryAdjustments
    ) { ${POSTING_FIELDS} }
  }
`;

export const REVERSE_FINANCE_POSTING = gql<
  { reverseFinancePosting: FinancePostingT },
  { postingId: string }
>`
  mutation ReverseFinancePosting($postingId: String!) {
    reverseFinancePosting(postingId: $postingId) { ${POSTING_FIELDS} }
  }
`;

export interface FinanceSnapshotLedgerT {
  ledger: string;
  opening: number;
  moneyIn: number;
  out: number;
  closing: number;
}
export interface FinanceDailySnapshotT {
  date: string;
  ledgers: FinanceSnapshotLedgerT[];
}

export const FINANCE_DAILY_SNAPSHOT_QUERY = gql<
  { financeDailySnapshot: FinanceDailySnapshotT },
  { date: string }
>`
  query FinanceDailySnapshot($date: String!) {
    financeDailySnapshot(date: $date) {
      date
      ledgers { ledger opening moneyIn: in out closing }
    }
  }
`;

export interface FinanceMonthToDateT {
  month: string;
  feeByHead: FinanceAmountByHeadT[];
  incomeByHead: FinanceAmountByHeadT[];
  expenseByHead: FinanceAmountByHeadT[];
  totalIn: number;
  totalOut: number;
}

export const FINANCE_MONTH_TO_DATE_QUERY = gql<
  { financeMonthToDate: FinanceMonthToDateT },
  { month: string }
>`
  query FinanceMonthToDate($month: String!) {
    financeMonthToDate(month: $month) {
      month
      feeByHead { ${AMOUNT_BY_HEAD} }
      incomeByHead { ${AMOUNT_BY_HEAD} }
      expenseByHead { ${AMOUNT_BY_HEAD} }
      totalIn totalOut
    }
  }
`;

export const STUDENT_FEE_HISTORY_QUERY = gql<
  { studentFeeHistory: FinancePostingT[] },
  { studentId: string }
>`
  query StudentFeeHistory($studentId: String!) {
    studentFeeHistory(studentId: $studentId) { ${POSTING_FIELDS} }
  }
`;

export interface HrPayrollNetPayableT {
  monthKey: string;
  total: number;
  found: boolean;
}

export const HR_PAYROLL_NET_PAYABLE_TOTAL_QUERY = gql<
  { hrPayrollNetPayableTotal: HrPayrollNetPayableT },
  { monthKey: string }
>`
  query HrPayrollNetPayableTotal($monthKey: String!) {
    hrPayrollNetPayableTotal(monthKey: $monthKey) { monthKey total found }
  }
`;

// ---------------------------------------------------------------------------
// FIN-2B — providers, fee-support allocations, receipts, fee-due chase
// ---------------------------------------------------------------------------

export interface FeeProviderT {
  id: string;
  name: string;
  nameBn: string | null;
  contact: string | null;
  note: string | null;
  active: boolean;
}

const PROVIDER_FIELDS = `id name nameBn contact note active`;

export const CREATE_FEE_PROVIDER = gql<
  { createFeeProvider: FeeProviderT },
  { name: string; nameBn?: string | null; contact?: string | null; note?: string | null }
>`
  mutation CreateFeeProvider($name: String!, $nameBn: String, $contact: String, $note: String) {
    createFeeProvider(name: $name, nameBn: $nameBn, contact: $contact, note: $note) { ${PROVIDER_FIELDS} }
  }
`;

export const FEE_PROVIDERS_QUERY = gql<{ feeProviders: FeeProviderT[] }, NoVars>`
  query FeeProviders { feeProviders { ${PROVIDER_FIELDS} } }
`;

export interface FeeCoverageT {
  head: string;
  type: string;
  amount: number | null;
}
export interface FeeSupportAllocationT {
  id: string;
  studentId: string;
  providerId: string;
  coverage: FeeCoverageT[];
  effectiveDate: string;
  endDate: string | null;
  status: string;
  note: string | null;
  createdAt: string;
}
export interface FeeCoverageInput {
  head: string;
  type: string;
  amount?: number | null;
}

const ALLOCATION_FIELDS = `id studentId providerId coverage { head type amount } effectiveDate endDate status note createdAt`;

export const SET_FEE_SUPPORT_ALLOCATION = gql<
  { setFeeSupportAllocation: FeeSupportAllocationT },
  {
    studentId: string;
    providerId: string;
    coverage: FeeCoverageInput[];
    effectiveDate: string;
    endDate?: string | null;
    status?: string | null;
    note?: string | null;
  }
>`
  mutation SetFeeSupportAllocation(
    $studentId: String!, $providerId: String!, $coverage: [FeeCoverageInput!]!,
    $effectiveDate: String!, $endDate: String, $status: String, $note: String
  ) {
    setFeeSupportAllocation(
      studentId: $studentId, providerId: $providerId, coverage: $coverage,
      effectiveDate: $effectiveDate, endDate: $endDate, status: $status, note: $note
    ) { ${ALLOCATION_FIELDS} }
  }
`;

export interface ProviderReceiptT {
  id: string;
  providerId: string;
  amount: number;
  date: string;
  mode: string | null;
  note: string | null;
}

export const RECORD_PROVIDER_RECEIPT = gql<
  { recordProviderReceipt: ProviderReceiptT },
  { providerId: string; amount: number; date: string; mode?: string | null; note?: string | null }
>`
  mutation RecordProviderReceipt($providerId: String!, $amount: Float!, $date: String!, $mode: String, $note: String) {
    recordProviderReceipt(providerId: $providerId, amount: $amount, date: $date, mode: $mode, note: $note) {
      id providerId amount date mode note
    }
  }
`;

export interface FinanceFeeDueChaseOutcomeT {
  studentId: string;
  studentName: string;
  guardianDue: number;
  messageBn: string;
  waLink: string | null;
  unreachableByWa: boolean;
  notifiedGuardianIds: string[];
}

export const CHASE_FEE_DUE = gql<
  { chaseFeeDue: FinanceFeeDueChaseOutcomeT },
  { studentId: string; asOf?: string | null }
>`
  mutation ChaseFeeDue($studentId: String!, $asOf: String) {
    chaseFeeDue(studentId: $studentId, asOf: $asOf) {
      studentId studentName guardianDue messageBn waLink unreachableByWa notifiedGuardianIds
    }
  }
`;

export interface FinanceProviderStatementT {
  providerId: string;
  providerName: string;
  raised: number;
  received: number;
  outstanding: number;
}

export const FINANCE_PROVIDER_STATEMENT_QUERY = gql<
  { financeProviderStatement: FinanceProviderStatementT },
  { providerId: string }
>`
  query FinanceProviderStatement($providerId: String!) {
    financeProviderStatement(providerId: $providerId) {
      providerId providerName raised received outstanding
    }
  }
`;

// ---------------------------------------------------------------------------
// FIN-3 — Qard/IOU register: parties + entries + outstanding/overdue
// ---------------------------------------------------------------------------

export interface FinancePartyT {
  id: string;
  name: string;
  nameBn: string | null;
  kind: string;
  contact: string | null;
  note: string | null;
  active: boolean;
}

const PARTY_FIELDS = `id name nameBn kind contact note active`;

export const SET_FINANCE_PARTY = gql<
  { setFinanceParty: FinancePartyT },
  { name: string; nameBn?: string | null; kind: string; contact?: string | null; note?: string | null }
>`
  mutation SetFinanceParty($name: String!, $nameBn: String, $kind: String!, $contact: String, $note: String) {
    setFinanceParty(name: $name, nameBn: $nameBn, kind: $kind, contact: $contact, note: $note) { ${PARTY_FIELDS} }
  }
`;

export const FINANCE_PARTIES_QUERY = gql<{ financeParties: FinancePartyT[] }, NoVars>`
  query FinanceParties { financeParties { ${PARTY_FIELDS} } }
`;

export interface QardIouScheduleInput {
  dueDate: string;
  amount: number;
}
export interface QardIouEntryT {
  id: string;
  partyId: string;
  type: string;
  direction: string;
  amount: number;
  date: string;
  mode: string | null;
  dueDate: string | null;
  note: string | null;
  reversesEntryId: string | null;
  createdAt: string;
}

const QARD_IOU_ENTRY_FIELDS = `id partyId type direction amount date mode dueDate note reversesEntryId createdAt`;

export const RECORD_QARD_IOU_ENTRY = gql<
  { recordQardIouEntry: QardIouEntryT },
  {
    partyId: string;
    type: string;
    direction: string;
    amount: number;
    date: string;
    mode?: string | null;
    dueDate?: string | null;
    schedule?: QardIouScheduleInput[] | null;
    note?: string | null;
    reversesEntryId?: string | null;
  }
>`
  mutation RecordQardIouEntry(
    $partyId: String!, $type: String!, $direction: String!, $amount: Float!, $date: String!,
    $mode: String, $dueDate: String, $schedule: [QardIouScheduleInput!], $note: String, $reversesEntryId: String
  ) {
    recordQardIouEntry(
      partyId: $partyId, type: $type, direction: $direction, amount: $amount, date: $date,
      mode: $mode, dueDate: $dueDate, schedule: $schedule, note: $note, reversesEntryId: $reversesEntryId
    ) { ${QARD_IOU_ENTRY_FIELDS} }
  }
`;

export interface QardIouOutstandingT {
  partyId: string;
  type: string;
  outstanding: number;
}

export const QARD_IOU_PARTY_OUTSTANDING_QUERY = gql<
  { qardIouPartyOutstanding: QardIouOutstandingT[] },
  { partyId: string; asOf?: string | null }
>`
  query QardIouPartyOutstanding($partyId: String!, $asOf: String) {
    qardIouPartyOutstanding(partyId: $partyId, asOf: $asOf) { partyId type outstanding }
  }
`;

export interface QardIouOverdueT {
  partyId: string;
  type: string;
  outstanding: number;
  oldestDueDate: string | null;
  daysLate: number;
}

export const QARD_IOU_OVERDUE_QUERY = gql<
  { qardIouOverdue: QardIouOverdueT[] },
  { asOf?: string | null }
>`
  query QardIouOverdue($asOf: String) {
    qardIouOverdue(asOf: $asOf) { partyId type outstanding oldestDueDate daysLate }
  }
`;

export const QARD_IOU_PARTY_ENTRIES_QUERY = gql<
  { qardIouPartyEntries: QardIouEntryT[] },
  { partyId: string }
>`
  query QardIouPartyEntries($partyId: String!) {
    qardIouPartyEntries(partyId: $partyId) { ${QARD_IOU_ENTRY_FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// FIN-4 — reconciliation
// ---------------------------------------------------------------------------

export interface ReconciliationEntryT {
  id: string;
  date: string;
  bankStatementBalance: number;
  appBankBalance: number;
  bankDiff: number;
  eximusClosing: FinanceLedgerVecT;
  appClosing: FinanceLedgerVecT;
  eximusDiff: FinanceLedgerVecT;
  note: string | null;
  createdAt: string;
}
export interface EximusClosingInput {
  CASH: number;
  BANK: number;
  ONLINE: number;
}

const RECON_FIELDS = `id date bankStatementBalance appBankBalance bankDiff eximusClosing { ${LEDGER_VEC} } appClosing { ${LEDGER_VEC} } eximusDiff { ${LEDGER_VEC} } note createdAt`;

export const RECORD_RECONCILIATION = gql<
  { recordReconciliation: ReconciliationEntryT },
  { date: string; bankStatementBalance: number; eximusClosing: EximusClosingInput; note?: string | null }
>`
  mutation RecordReconciliation($date: String!, $bankStatementBalance: Float!, $eximusClosing: EximusClosingInput!, $note: String) {
    recordReconciliation(date: $date, bankStatementBalance: $bankStatementBalance, eximusClosing: $eximusClosing, note: $note) {
      ${RECON_FIELDS}
    }
  }
`;

export const LATEST_RECONCILIATION_QUERY = gql<
  { latestReconciliation: ReconciliationEntryT | null },
  { date?: string | null }
>`
  query LatestReconciliation($date: String) {
    latestReconciliation(date: $date) { ${RECON_FIELDS} }
  }
`;

export const RECONCILIATION_HISTORY_QUERY = gql<
  { reconciliationHistory: ReconciliationEntryT[] },
  { from?: string | null; to?: string | null }
>`
  query ReconciliationHistory($from: String, $to: String) {
    reconciliationHistory(from: $from, to: $to) { ${RECON_FIELDS} }
  }
`;

export const UNRECONCILED_DAYS_QUERY = gql<
  { unreconciledDays: string[] },
  { from: string; to: string }
>`
  query UnreconciledDays($from: String!, $to: String!) {
    unreconciledDays(from: $from, to: $to)
  }
`;

// ---------------------------------------------------------------------------
// FIN-5 — budget lines + budget-vs-actual + surplus/deficit
// ---------------------------------------------------------------------------

export interface BudgetMonthlyOverrideT {
  monthKey: string;
  amount: number;
}
export interface BudgetLineT {
  id: string;
  academicYearId: string;
  head: string;
  kind: string;
  annualAmount: number;
  monthlyOverrides: BudgetMonthlyOverrideT[];
  note: string | null;
}
export interface BudgetMonthlyOverrideInput {
  monthKey: string;
  amount: number;
}

const BUDGET_LINE_FIELDS = `id academicYearId head kind annualAmount monthlyOverrides { monthKey amount } note`;

export const SET_BUDGET_LINE = gql<
  { setBudgetLine: BudgetLineT },
  {
    academicYearId: string;
    head: string;
    kind: string;
    annualAmount: number;
    monthlyOverrides?: BudgetMonthlyOverrideInput[] | null;
    note?: string | null;
  }
>`
  mutation SetBudgetLine(
    $academicYearId: String!, $head: String!, $kind: String!, $annualAmount: Float!,
    $monthlyOverrides: [BudgetMonthlyOverrideInput!], $note: String
  ) {
    setBudgetLine(
      academicYearId: $academicYearId, head: $head, kind: $kind, annualAmount: $annualAmount,
      monthlyOverrides: $monthlyOverrides, note: $note
    ) { ${BUDGET_LINE_FIELDS} }
  }
`;

export const BUDGET_LINES_QUERY = gql<
  { budgetLines: BudgetLineT[] },
  { academicYearId: string }
>`
  query BudgetLines($academicYearId: String!) {
    budgetLines(academicYearId: $academicYearId) { ${BUDGET_LINE_FIELDS} }
  }
`;

export interface BudgetVsActualMonthT {
  monthKey: string;
  target: number;
  actual: number;
  variance: number;
}
export interface BudgetVsActualLineT {
  head: string;
  kind: string;
  annualTarget: number;
  months: BudgetVsActualMonthT[];
  cumulativeTarget: number;
  cumulativeActual: number;
  cumulativeVariance: number;
}
export interface BudgetVsActualT {
  academicYearId: string;
  asOfMonth: string;
  lines: BudgetVsActualLineT[];
}

export const BUDGET_VS_ACTUAL_QUERY = gql<
  { budgetVsActual: BudgetVsActualT },
  { academicYearId: string; asOf?: string | null }
>`
  query BudgetVsActual($academicYearId: String!, $asOf: String) {
    budgetVsActual(academicYearId: $academicYearId, asOf: $asOf) {
      academicYearId asOfMonth
      lines {
        head kind annualTarget
        months { monthKey target actual variance }
        cumulativeTarget cumulativeActual cumulativeVariance
      }
    }
  }
`;

export interface BudgetSurplusMonthT {
  monthKey: string;
  income: number;
  expense: number;
  surplus: number;
}
export interface BudgetSurplusDeficitT {
  academicYearId: string;
  months: BudgetSurplusMonthT[];
  ytdIncome: number;
  ytdExpense: number;
  ytdSurplus: number;
}

export const BUDGET_SURPLUS_DEFICIT_QUERY = gql<
  { budgetSurplusDeficit: BudgetSurplusDeficitT },
  { academicYearId: string; asOf?: string | null }
>`
  query BudgetSurplusDeficit($academicYearId: String!, $asOf: String) {
    budgetSurplusDeficit(academicYearId: $academicYearId, asOf: $asOf) {
      academicYearId
      months { monthKey income expense surplus }
      ytdIncome ytdExpense ytdSurplus
    }
  }
`;

// ---------------------------------------------------------------------------
// FIN-6A — monthly report + year overview + YTD income statement + trends
// ---------------------------------------------------------------------------

export interface FinanceLedgerSnapshotT {
  ledger: string;
  balance: number;
}
export interface FinanceMonthlyReportT {
  month: string;
  feeByHead: FinanceAmountByHeadT[];
  incomeByHead: FinanceAmountByHeadT[];
  expenseByHead: FinanceAmountByHeadT[];
  totalIn: number;
  totalOut: number;
  net: number;
  ledgerSnapshot: FinanceLedgerSnapshotT[];
}

export const FINANCE_MONTHLY_REPORT_QUERY = gql<
  { financeMonthlyReport: FinanceMonthlyReportT },
  { month: string }
>`
  query FinanceMonthlyReport($month: String!) {
    financeMonthlyReport(month: $month) {
      month
      feeByHead { ${AMOUNT_BY_HEAD} }
      incomeByHead { ${AMOUNT_BY_HEAD} }
      expenseByHead { ${AMOUNT_BY_HEAD} }
      totalIn totalOut net
      ledgerSnapshot { ledger balance }
    }
  }
`;

export interface FinanceReconSummaryT {
  date: string;
  bankDiff: number;
  eximusDiff: FinanceLedgerVecT;
}
export interface FinanceYearOverviewT {
  academicYearId: string;
  cashPosition: number;
  ytdIncome: number;
  ytdExpense: number;
  ytdSurplus: number;
  qardOutstanding: number;
  iouOutstanding: number;
  zakatApplied: number;
  providerReceivableOutstanding: number;
  feesDueOutstanding: number;
  lastReconciliation: FinanceReconSummaryT | null;
}

export const FINANCE_YEAR_OVERVIEW_QUERY = gql<
  { financeYearOverview: FinanceYearOverviewT },
  { academicYearId: string; asOf?: string | null }
>`
  query FinanceYearOverview($academicYearId: String!, $asOf: String) {
    financeYearOverview(academicYearId: $academicYearId, asOf: $asOf) {
      academicYearId cashPosition ytdIncome ytdExpense ytdSurplus
      qardOutstanding iouOutstanding zakatApplied providerReceivableOutstanding feesDueOutstanding
      lastReconciliation { date bankDiff eximusDiff { ${LEDGER_VEC} } }
    }
  }
`;

export interface FinanceYtdIncomeStatementT {
  academicYearId: string;
  incomeLines: FinanceAmountByHeadT[];
  expenseLines: FinanceAmountByHeadT[];
  totalIncome: number;
  totalExpense: number;
  net: number;
}

export const FINANCE_YTD_INCOME_STATEMENT_QUERY = gql<
  { financeYtdIncomeStatement: FinanceYtdIncomeStatementT },
  { academicYearId: string; asOf?: string | null }
>`
  query FinanceYtdIncomeStatement($academicYearId: String!, $asOf: String) {
    financeYtdIncomeStatement(academicYearId: $academicYearId, asOf: $asOf) {
      academicYearId
      incomeLines { ${AMOUNT_BY_HEAD} }
      expenseLines { ${AMOUNT_BY_HEAD} }
      totalIncome totalExpense net
    }
  }
`;

export interface FinanceTrendPointT {
  monthKey: string;
  income: number;
  expense: number;
  net: number;
}

export const FINANCE_TRENDS_QUERY = gql<
  { financeTrends: FinanceTrendPointT[] },
  { academicYearId: string; asOf?: string | null }
>`
  query FinanceTrends($academicYearId: String!, $asOf: String) {
    financeTrends(academicYearId: $academicYearId, asOf: $asOf) { monthKey income expense net }
  }
`;

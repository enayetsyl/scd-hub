/**
 * Example data for the বেতন ও অর্থ (payroll + finance) help guides (spec `fin`).
 *
 * Create-only, local-only (same guard as scripts/help/fixture.ts). Builds on the base
 * school and adds, with plainly EXAMPLE amounts (round figures, no real person):
 *   - salary, payment method and bank details for the 5 base staff;
 *     teacher2 is on probation (no confirmation date) with 2 held leave days in October;
 *   - the HR policy's letterhead and the school's own bank (example values), so the
 *     bank advice pack is ready;
 *   - a salary advance for teacher2 (instalments);
 *   - October staff attendance with LATE days for two people (the lateness card);
 *   - two LOCKED runs (2026-08, 2026-09) through the real PayrollService. The spec
 *     prepares 2026-10 itself, on screen;
 *   - finance books: opening balances, a few postings, a fee provider + allocation +
 *     receipt, qard parties + entries (one overdue), two reconciliations, budget lines.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hc npx tsx scripts/help/fixtures/fin.ts [--reset]
 */
import mongoose, { Types } from "mongoose";
import { seedBaseSchool } from "../fixture";
import { StaffProfile } from "../../../src/modules/foundation/models/StaffProfile";
import { TeacherAttendanceDay } from "../../../src/modules/attendance/models/TeacherAttendanceDay";
import { setHrPolicy } from "../../../src/modules/hr/services/HrPolicyService";
import { recordPayChange } from "../../../src/modules/hr/services/PayHistoryService";
import { issueAdvance } from "../../../src/modules/hr/services/AdvanceService";
import { applyForLeave, decideLeave } from "../../../src/modules/hr/services/StaffLeaveService";
import { preparePayrollRun, approvePayrollRun } from "../../../src/modules/hr/services/PayrollService";
import { setOpeningBalance } from "../../../src/modules/finance/services/FinanceLedgerService";
import { recordPosting } from "../../../src/modules/finance/services/FinanceSnapshotService";
import {
  createFeeProvider,
  setFeeSupportAllocation,
  recordProviderReceipt,
} from "../../../src/modules/finance/services/FeeSupportService";
import { setParty, recordEntry } from "../../../src/modules/finance/services/QardIouService";
import { recordReconciliation } from "../../../src/modules/finance/services/ReconciliationService";
import { setBudgetLine } from "../../../src/modules/finance/services/BudgetService";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  console.error("Refusing: MONGODB_URI must be a local in-memory database (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

/** Dhaka noon on a day key, as the app stores a dated posting. */
const day = (key: string): Date => new Date(`${key}T12:00:00+06:00`);

/** Example pay rows, one per base staff login (phone is the join key, as on prod). */
const PAY = [
  // own bank (the school's) → internal sheet
  { phone: "01700000001", salary: 50000, method: "bank", bank: "উদাহরণ ব্যাংক", branch: "উদাহরণ শাখা", account: "0000000000101", routing: "" },
  // cash envelope
  { phone: "01700000002", salary: 20000, method: "cash" },
  // another bank → BEFTN, with a routing number
  { phone: "01700000003", salary: 25000, method: "bank", bank: "নমুনা ব্যাংক", branch: "নমুনা শাখা", account: "0000000000103", routing: "000000001" },
  // bKash
  { phone: "01700000004", salary: 22000, method: "bkash", account: "01700000004" },
  // another bank but NO routing number → shows in "যাঁদের পাঠানো যাবে না"
  { phone: "01700000005", salary: 18000, method: "bank", bank: "নমুনা ব্যাংক", branch: "নমুনা শাখা", account: "0000000000105", routing: "" },
] as const;

export async function seedFin() {
  const base = await seedBaseSchool();
  const { users } = base;
  const principal = users.principal.toString();
  const office = { userId: users.office.toString(), role: "OFFICE" };

  // ── Staff pay ──────────────────────────────────────────────────────────────
  const profiles: Record<string, Types.ObjectId> = {};
  for (const p of PAY) {
    const probation = p.phone === "01700000004";
    const sp = await StaffProfile.findOneAndUpdate(
      { phone: p.phone },
      {
        $set: {
          monthlySalary: p.salary,
          paymentMethod: p.method,
          joiningDate: probation ? new Date("2026-06-01") : new Date("2024-01-01"),
          ...(probation ? { employmentStatus: "probation" } : { confirmationDate: new Date("2024-07-01") }),
          ...("account" in p ? { bankAccount: p.account } : {}),
          ...("bank" in p ? { bankName: p.bank, bankBranch: p.branch, ...(p.routing ? { routingNo: p.routing } : {}) } : {}),
        },
      },
      { new: true },
    );
    if (!sp) throw new Error(`no staff profile for ${p.phone}`);
    if ("bank" in p) await StaffProfile.updateOne({ _id: sp._id }, { $set: { bankAccountName: sp.name } });
    profiles[p.phone] = sp._id;
    await recordPayChange({
      staffProfileId: sp._id.toString(),
      monthlySalary: p.salary,
      effectiveFrom: null,
      previousSalary: null,
      joiningMonth: (probation ? "2026-06" : "2024-01"),
      note: null,
      actorId: principal,
    });
  }

  // ── HR policy: the advice letterhead + the school's own bank (example values) ──
  await setHrPolicy({
    employerNameBn: "উদাহরণ স্কুল",
    employerAddressBn: "উদাহরণ সড়ক, উদাহরণ শহর",
    orgAddress: "Example Road, Example Town",
    orgPhone: "01900000000",
    orgEmail: "office@example.test",
    schoolBankName: "উদাহরণ ব্যাংক",
    schoolBankBranch: "উদাহরণ শাখা",
    schoolAccountNo: "0000000009999",
    signatoryName: "Example Convener",
    signatoryTitle: "Convener, Managing Committee",
    signatoryNameBn: "উদাহরণ অধ্যক্ষ",
    signatoryTitleBn: "অধ্যক্ষ",
    actorId: principal,
  } as Parameters<typeof setHrPolicy>[0]);

  // ── An advance for teacher2: ৳10,000 in ৳2,000 instalments ────────────────
  await issueAdvance({
    staffProfileId: profiles["01700000004"].toString(),
    principal: 10000,
    issueDate: new Date("2026-07-15"),
    recoveryMode: "installments",
    installmentAmount: 2000,
    note: "উদাহরণ: চিকিৎসার জন্য",
    actorId: principal,
  });

  // ── Two locked months, through the real run ────────────────────────────────
  for (const [monthKey, workingDays] of [["2026-08", 26], ["2026-09", 25]] as const) {
    const { run } = await preparePayrollRun({ monthKey, workingDays, actorId: office.userId });
    await approvePayrollRun(run._id.toString(), principal);
  }

  // ── October: leave + lateness for the Prepare screen ──────────────────────
  // teacher2 (probation) takes 2 days casual leave → held, listed on the leave card.
  const held = await applyForLeave({
    staffProfileId: profiles["01700000004"].toString(),
    leaveType: "casual",
    fromKey: "2026-10-14",
    toKey: "2026-10-15",
    reason: "উদাহরণ: পারিবারিক কাজ",
    actorId: users.teacher2.toString(),
  });
  await decideLeave(held._id.toString(), "approve", principal);

  // October attendance (Sun–Thu). teacher: 4 LATE → 1 day; reviewer: 6 LATE → 2 days.
  const lateDays: Record<string, string[]> = {
    "01700000003": ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"],
    "01700000005": ["2026-10-06", "2026-10-08", "2026-10-13", "2026-10-15", "2026-10-20", "2026-10-22"],
  };
  const rows = [];
  for (let d = 1; d <= 31; d++) {
    const key = `2026-10-${String(d).padStart(2, "0")}`;
    const dow = new Date(`${key}T12:00:00+06:00`).getUTCDay(); // 5 Fri, 6 Sat
    if (dow === 5 || dow === 6) continue;
    for (const p of PAY) {
      const late = lateDays[p.phone]?.includes(key);
      rows.push({
        staffProfileId: profiles[p.phone],
        dateKey: key,
        status: late ? "LATE" : "PRESENT",
        punchIn: late ? "07:52" : "07:20",
        punchOut: "14:10",
        importedBy: users.office,
      });
    }
  }
  await TeacherAttendanceDay.insertMany(rows);

  // ── Finance books (example amounts) ────────────────────────────────────────
  for (const [ledger, amount] of [["CASH", 50000], ["BANK", 200000], ["ONLINE", 10000]] as const) {
    await setOpeningBalance({ ledger, amount, effectiveDate: new Date("2026-01-01"), note: "উদাহরণ প্রারম্ভিক ব্যালান্স" }, office);
  }
  const provider = await createFeeProvider({ name: "Example Zakat Fund", nameBn: "উদাহরণ যাকাত তহবিল", contact: "01900000001" });
  const supported = base.students.c5[0].toString();
  await setFeeSupportAllocation(
    {
      studentId: supported,
      providerId: provider._id.toString(),
      coverage: [{ head: "TUITION", type: "FULL" }],
      effectiveDate: new Date("2026-01-01"),
      status: "ACTIVE",
    },
    office,
  );
  const postings = [
    { date: day("2026-11-02"), kind: "FEE_COLLECTION", mode: "CASH", studentId: supported, feeLines: [{ head: "TUITION", amount: 1500 }], note: "উদাহরণ: নভেম্বরের টিউশন" },
    { date: day("2026-11-02"), kind: "OTHER_INCOME", mode: "CASH", incomeHead: "SADAKA", amount: 5000, note: "উদাহরণ: সাদাকা" },
    { date: day("2026-11-03"), kind: "EXPENSE", mode: "BANK", expenseHead: "UTILITIES", amount: 3200, note: "উদাহরণ: বিদ্যুৎ বিল" },
    { date: day("2026-11-04"), kind: "EXPENSE", mode: "CASH", expenseHead: "OFFICE_STATIONARY", amount: 850, note: "উদাহরণ: খাতা ও কলম" },
    { date: day("2026-11-04"), kind: "TRANSFER", mode: "CASH", toLedger: "BANK", amount: 10000, note: "উদাহরণ: নগদ ব্যাংকে জমা" },
    { date: day("2026-11-05"), kind: "OTHER_INCOME", mode: "ONLINE", incomeHead: "BOOKS_STATIONERIES", amount: 2400, note: "উদাহরণ: বই বিক্রি" },
  ];
  for (const p of postings) await recordPosting(p, office);
  await recordProviderReceipt({ providerId: provider._id.toString(), amount: 1000, date: day("2026-11-05"), mode: "BANK", note: "উদাহরণ" }, office);

  const family = await setParty({ name: "Example Family", nameBn: "উদাহরণ পরিবার", kind: "INDIVIDUAL", contact: "01900000002" }, office);
  const society = await setParty({ name: "Example Society", nameBn: "উদাহরণ সমিতি", kind: "COMMUNITY", contact: "01900000003" }, office);
  await recordEntry({ partyId: family._id.toString(), type: "QARD_E_HASANA", direction: "NEW_DISBURSEMENT", amount: 15000, date: day("2026-08-10"), mode: "CASH", dueDate: day("2026-10-31"), note: "উদাহরণ" }, office);
  await recordEntry({ partyId: family._id.toString(), type: "QARD_E_HASANA", direction: "REPAYMENT_RECEIVED", amount: 5000, date: day("2026-09-15"), mode: "CASH", note: "উদাহরণ" }, office);
  await recordEntry({ partyId: society._id.toString(), type: "IOU", direction: "NEW_DISBURSEMENT", amount: 3000, date: day("2026-10-20"), mode: "BANK", dueDate: day("2026-12-31"), note: "উদাহরণ" }, office);

  await recordReconciliation({ date: "2026-10-31", bankStatementBalance: 200000, eximusClosing: { CASH: 50000, BANK: 200000, ONLINE: 10000 }, note: "উদাহরণ" }, office);
  await recordReconciliation({ date: "2026-11-03", bankStatementBalance: 196800, eximusClosing: { CASH: 55000, BANK: 196800, ONLINE: 10000 }, note: "উদাহরণ" }, office);

  const yearId = base.yearId.toString();
  await setBudgetLine({ academicYearId: yearId, head: "SALARY", kind: "EXPENSE", annualAmount: 1600000, note: "উদাহরণ" }, office);
  await setBudgetLine({ academicYearId: yearId, head: "TUITION_FEE", kind: "INCOME", annualAmount: 1200000, note: "উদাহরণ" }, office);

  return { ...base, profiles, providerId: provider._id, parties: { family: family._id, society: society._id } };
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(uri);
    if (process.argv.includes("--reset")) await mongoose.connection.dropDatabase();
    const ids = await seedFin();
    console.log("fixture: fin (pay for 5 staff, runs 2026-08 + 2026-09 locked, October lateness + held leave, finance books)");
    console.log(JSON.stringify(ids));
    await mongoose.disconnect();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

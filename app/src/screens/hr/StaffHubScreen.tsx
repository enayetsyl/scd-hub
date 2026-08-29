/**
 * StaffHubScreen (SH-6, corrected in SH-9) — ONE screen for a staff member's whole
 * record, replacing the destinations the owner had to walk between.
 *
 * LIVE DATA, NOT THE ROUTE PARAM. The record arrives as a navigation parameter for the
 * first paint (so the header never flashes empty), but every read after that comes from
 * `staffProfile(id)` and is refetched on focus. The 2026-08-26 prod E2E test found why
 * this matters: a confirmation succeeded server-side — status flipped, date stamped,
 * letter issued, audit written — and the screen still read শিক্ষানবিশ with the
 * স্থায়ীকরণ button sitting there inviting a second press. The param is a snapshot taken
 * when the row was tapped; it cannot know about anything that happened since.
 *
 * TABS ARE LAZY AND SEPARATELY GATED. Each tab runs its own query and mounts only when
 * active, so a caller without `payroll:manage` never fires the payroll request. D-#532
 * was a permission-carrying field returning `null` under a screen that read through it,
 * which took down the whole navigator; nothing here reads through a refused field.
 *
 * Registered in the ADMIN stack, beside the staff list it opens from. Never FIRST: it
 * takes params, and a param-taking initial route crashes the tab on open — something
 * neither tsc nor `expo export` catches.
 */
import React from "react";
import { Linking, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useQuery, useMutation } from "urql";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AdminStackParamList } from "../../navigation/types";
import {
  STAFF_PROFILE_QUERY,
  STAFF_LETTERS_QUERY,
  STAFF_LEAVE_POOL_QUERY,
  STAFF_PROBATION_DEBT_QUERY,
  STAFF_ATTENDANCE_QUERY,
  STAFF_ATTENDANCE_SUMMARY_QUERY,
  STAFF_LATENESS_PREVIEW_QUERY,
  STAFF_PAYSLIPS_QUERY,
  STAFF_APPRAISALS_QUERY,
  STAFF_CONDUCT_RECORDS_QUERY,
  STAFF_OBSERVATIONS_QUERY,
  OFFBOARDING_CASES_QUERY,
  HR_POLICY_QUERY,
  VOID_STAFF_LETTER,
  STAFF_CREDENTIAL_CANDIDATES,
  PROVISION_STAFF_LOGIN,
  type ProvisionedCredentialT,
  type StaffT,
} from "../../graphql/operations";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Row,
  Badge,
  Button,
  Chip,
  ChipRow,
  Divider,
  Loader,
  EmptyState,
  Notice,
  Field,
} from "../../components/ui";
import {
  STR,
  bnNum,
  hrCategoryLabel,
  employmentTypeLabel,
  employmentStatusLabel,
  leaveTypeLabel,
  paymentMethodLabel,
  appraisalStatusLabel,
  appraisalOutcomeLabel,
  conductStageLabel,
  conductRecordStatusLabel,
  offboardingStatusLabel,
  offboardingTriggerLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "StaffHub">;

type TabKey = "profile" | "attendance" | "leave" | "payroll" | "documents" | "performance" | "exit";

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return "—";
  return bnNum(`${d}/${m}/${y}`);
}

function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthBounds(monthKey: string): { fromKey: string; toKey: string } {
  const [y, m] = monthKey.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { fromKey: `${monthKey}-01`, toKey: `${monthKey}-${String(last).padStart(2, "0")}` };
}
function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  return monthKeyOf(new Date(y, m - 1 + delta, 1));
}
const MONTHS_BN = ["জানুয়ারি","ফেব্রুয়ারি","মার্চ","এপ্রিল","মে","জুন","জুলাই","আগস্ট","সেপ্টেম্বর","অক্টোবর","নভেম্বর","ডিসেম্বর"];
const MONTHS_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function isEn(): boolean {
  return STR.stfTabProfile === "Profile";
}
function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return isEn() ? `${MONTHS_EN[m - 1]} ${y}` : `${MONTHS_BN[m - 1]} ${bnNum(String(y))}`;
}

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "muted"> = {
  PRESENT: "ok", LATE: "warn", ABSENT: "danger", LEAVE: "muted",
};
function attendanceStatusLabel(s: string): string {
  const bn: Record<string, string> = { PRESENT: "উপস্থিত", LATE: "বিলম্বে", ABSENT: "অনুপস্থিত", LEAVE: "ছুটিতে" };
  const en: Record<string, string> = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent", LEAVE: "On leave" };
  return (isEn() ? en : bn)[s] ?? s;
}
const taka = (n: number): string => `৳ ${bnNum(n.toLocaleString("en-US"))}`;

/**
 * joiningDate + N months → the date probation was due to end (D-#586).
 *
 * Month arithmetic, not 30-day arithmetic: six months from 31 January is 31 July,
 * and JS rolls a short month forward on its own (31 Aug + 6 → 3 Mar), which is close
 * enough for a reminder and never silently wrong by a month.
 */
export function probationEndKey(joiningIso: string | null | undefined, months: number): string | null {
  if (!joiningIso || months <= 0) return null;
  const d = new Date(joiningIso);
  if (Number.isNaN(d.getTime())) return null;
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
  return end.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------

/**
 * The app login for THIS staff member (D-#581).
 *
 * পাসওয়ার্ড রিসেট used to navigate to a school-wide credentials list — from a screen
 * that already knew exactly whose password was being reset — where the operator then
 * had to find the same person again among 25 rows. The list screen is gone; this card
 * does the whole job in place.
 *
 * `provisionStaffLogin` covers BOTH cases: it creates the login if there is none and
 * resets the password if there is (returning `alreadyExisted`), so one button and one
 * mutation are enough. The candidates query is still what says whether a login exists
 * and, when one cannot be made, why — a support staff member has no app login at all
 * (D-#25) and a staff member with no phone has no login id.
 */
function CredentialCard({ staff }: { staff: StaffT }): React.ReactElement {
  const [{ data, fetching }, refetch] = useQuery({
    query: STAFF_CREDENTIAL_CANDIDATES,
    requestPolicy: "cache-and-network",
  });
  const [, provision] = useMutation(PROVISION_STAFF_LOGIN);
  const [busy, setBusy] = React.useState(false);
  const [cred, setCred] = React.useState<ProvisionedCredentialT | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const row = (data?.staffCredentialCandidates ?? []).find((c) => c.staffId === staff.id);

  async function run(): Promise<void> {
    setBusy(true);
    setErr(null);
    setCred(null);
    setCopied(false);
    const res = await provision({ staffProfileId: staff.id });
    setBusy(false);
    if (res.error || !res.data?.provisionStaffLogin) {
      setErr(friendlyError(res.error));
      return;
    }
    setCred(res.data.provisionStaffLogin);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Card>
      <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.staffCredentials}</Body>
      {err ? <Notice message={err} tone="danger" /> : null}
      {fetching && !row ? (
        <Loader label={STR.loading} />
      ) : !row ? (
        <Muted>{STR.stfNoCredentialRow}</Muted>
      ) : (
        <>
          {row.phone ? <Row label={STR.loginId} value={row.phone} /> : null}
          {row.mappedRole ? <Row label={STR.role} value={row.mappedRole} /> : null}
          <View style={{ marginTop: space(1), flexDirection: "row" }}>
            <Badge
              text={row.loginExists ? STR.loginExistsLabel : row.provisionable ? STR.noLoginLabel : (row.reason ?? STR.noLoginLabel)}
              tone={row.loginExists ? "ok" : row.provisionable ? "muted" : "warn"}
            />
          </View>
          {row.provisionable ? (
            <Button
              title={row.loginExists ? STR.resetPassword : STR.generateLogin}
              onPress={run}
              loading={busy}
              disabled={busy}
              variant={row.loginExists ? "secondary" : "primary"}
              style={{ marginTop: space(2) }}
            />
          ) : null}
        </>
      )}

      {cred ? (
        <View style={{ marginTop: space(2) }}>
          <Row label={STR.loginId} value={cred.identifier} />
          <Row label={STR.generatedPassword} value={cred.password} />
          <Notice message={STR.credentialOnceWarning} tone="warn" />
          <Button title={STR.shareWhatsApp} onPress={() => Linking.openURL(cred.waLink)} style={{ marginTop: space(2) }} />
          <Button
            title={copied ? STR.copied : STR.copy}
            variant="secondary"
            style={{ marginTop: space(1) }}
            onPress={() => {
              void Clipboard.setStringAsync(
                `${STR.loginId}: ${cred.identifier}\n${STR.generatedPassword}: ${cred.password}`,
              ).then(() => setCopied(true));
            }}
          />
        </View>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function ProfileTab({ staff, canLeave }: { staff: StaffT; canLeave: boolean }): React.ReactElement {
  const onProbation = !staff.confirmationDate;
  const [{ data: policyData }] = useQuery({ query: HR_POLICY_QUERY });
  const probationEnd = onProbation
    ? probationEndKey(staff.joiningDate, policyData?.hrPolicy.probationMonths ?? 0)
    : null;
  // Overdue is the whole reason to compute the date: the confirmation, its held-leave
  // settlement (D-#540) and the letter all wait on someone noticing.
  const probationOverdue = probationEnd !== null && probationEnd < new Date().toISOString().slice(0, 10);
  const [{ data: pool }] = useQuery({
    query: STAFF_LEAVE_POOL_QUERY, variables: { staffProfileId: staff.id }, pause: !canLeave, requestPolicy: "cache-and-network",
  });
  const [{ data: debt }] = useQuery({
    query: STAFF_PROBATION_DEBT_QUERY, variables: { staffProfileId: staff.id }, pause: !canLeave, requestPolicy: "cache-and-network",
  });
  const held = debt?.staffProbationDebt.totalDays ?? 0;
  const remaining = pool?.staffLeavePool.remainingDays ?? 0;

  return (
    <View>
      {onProbation ? <Notice tone="warn" message={STR.stfOnProbationNotice} /> : null}

      {canLeave ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.stfAtAGlance}</Body>
          {/* On probation the pool is NOT spendable — every day taken is unpaid and
              held until confirmation. Labelling it "ছুটি বাকি" next to a probation
              notice told the Principal the opposite of the rule (prod E2E, 2026-08-26). */}
          <Row
            label={onProbation ? STR.stfPoolOnConfirmation : STR.stfLeaveRemaining}
            value={`${bnNum(String(remaining))} ${STR.stfDays}`}
          />
          {onProbation ? <Muted>{STR.stfPoolNotDrawableYet}</Muted> : null}
          {held > 0 ? <Row label={STR.stfHeldUnpaid} value={`${bnNum(String(held))} ${STR.stfDays}`} /> : null}
        </Card>
      ) : null}

      <Card>
        <Row label={STR.staffId} value={staff.schoolId} />
        <Row label={STR.category} value={hrCategoryLabel(staff.category)} />
        <Row label={STR.designation} value={staff.designation ?? "—"} />
        <Row label={STR.employmentType} value={employmentTypeLabel(staff.employmentType)} />
        <Row label={STR.employmentStatus} value={employmentStatusLabel(staff.employmentStatus)} />
        <Row label={STR.joiningDate} value={fmtDate(staff.joiningDate)} />
        {staff.confirmationDate ? <Row label={STR.stfConfirmedOn} value={fmtDate(staff.confirmationDate)} /> : null}
        {probationEnd ? <Row label={STR.stfProbationEnds} value={fmtDate(probationEnd)} /> : null}
        {probationOverdue ? <Notice tone="warn" message={STR.stfProbationOverdue} /> : null}
        {staff.biometricId ? <Row label={STR.biometricId} value={staff.biometricId} /> : null}
      </Card>

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfContact}</Body>
        <Row label={STR.phone} value={staff.phone ?? "—"} />
        {staff.whatsapp ? <Row label={STR.whatsapp} value={staff.whatsapp} /> : null}
        {staff.email ? <Row label={STR.email} value={staff.email} /> : null}
        {staff.presentAddress ? (
          <>
            <Divider />
            <Muted>{STR.stfPresentAddress}</Muted>
            <Body>{staff.presentAddress}</Body>
          </>
        ) : null}
      </Card>

      {/* Empty rows for a record with nothing in them are noise — show what exists. */}
      {staff.dob || staff.bloodGroup || staff.maritalStatus || staff.qualification ||
       staff.fatherName || staff.motherName || staff.spouseName ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfPersonal}</Body>
          {staff.dob ? <Row label={STR.dob} value={fmtDate(staff.dob)} /> : null}
          {staff.bloodGroup ? <Row label={STR.bloodGroup} value={staff.bloodGroup} /> : null}
          {staff.maritalStatus ? <Row label={STR.maritalStatus} value={staff.maritalStatus} /> : null}
          {staff.qualification ? <Row label={STR.qualification} value={staff.qualification} /> : null}
          {staff.fatherName ? <Row label={STR.fatherName} value={staff.fatherName} /> : null}
          {staff.motherName ? <Row label={STR.motherName} value={staff.motherName} /> : null}
          {staff.spouseName ? <Row label={STR.spouseName} value={staff.spouseName} /> : null}
        </Card>
      ) : null}

      {staff.nid || staff.bankAccount ? (
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700", flex: 1 }}>{STR.stfSensitive}</Body>
            <Badge text={STR.stfPrincipalOnly} tone="gold" />
          </View>
          {staff.nid ? <Row label={STR.nid} value={staff.nid} /> : null}
          {staff.bankAccount ? <Row label={STR.bankAccount} value={staff.bankAccount} /> : null}
        </Card>
      ) : null}
    </View>
  );
}

function AttendanceTab({ staff }: { staff: StaffT }): React.ReactElement {
  const [monthKey, setMonthKey] = React.useState(() => monthKeyOf(new Date()));
  const { fromKey, toKey } = monthBounds(monthKey);
  const [{ data, fetching, error }] = useQuery({
    query: STAFF_ATTENDANCE_QUERY, variables: { staffProfileId: staff.id, fromKey, toKey }, requestPolicy: "cache-and-network",
  });
  const [{ data: sum }] = useQuery({
    query: STAFF_ATTENDANCE_SUMMARY_QUERY, variables: { staffProfileId: staff.id, fromKey, toKey }, requestPolicy: "cache-and-network",
  });
  const [{ data: late }] = useQuery({
    query: STAFF_LATENESS_PREVIEW_QUERY, variables: { staffProfileId: staff.id, monthKey }, requestPolicy: "cache-and-network",
  });
  const days = data?.staffAttendance ?? [];
  const s = sum?.staffAttendanceSummary;
  const l = late?.staffLatenessPreview;

  return (
    <View>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Button title="‹" variant="ghost" onPress={() => setMonthKey(shiftMonth(monthKey, -1))} />
          <Body style={{ fontWeight: "700" }}>{monthLabel(monthKey)}</Body>
          <Button title="›" variant="ghost" onPress={() => setMonthKey(shiftMonth(monthKey, 1))} />
        </View>
      </Card>

      {s ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfAttendanceSummary}</Body>
          <Row label={STR.stfWorkingDays} value={bnNum(String(s.total))} />
          <Row label={STR.stfPresent} value={`${bnNum(String(s.present))} (${bnNum(String(s.presentPct))}%)`} />
          <Row label={STR.stfLate} value={bnNum(String(s.late))} />
          <Row label={STR.stfAbsent} value={bnNum(String(s.absent))} />
          <Row label={STR.stfOnLeave} value={bnNum(String(s.leave))} />
        </Card>
      ) : null}

      {l && l.lateCount > 0 ? (
        <Notice
          tone={l.enabled ? "warn" : "info"}
          message={l.enabled ? STR.stfLatenessExplain : STR.stfLatenessOff}
        />
      ) : null}

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfPunchTimes}</Body>
        {error ? <Notice tone="danger" message={friendlyError(error)} />
          : fetching ? <Loader label={STR.loading} />
          : days.length === 0 ? <EmptyState message={STR.stfNoAttendance} />
          : days.slice().reverse().map((d) => (
              <View key={d.dateKey}>
                <Divider />
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                  <Body style={{ flex: 1 }}>{fmtDate(d.dateKey)}</Body>
                  <Badge text={attendanceStatusLabel(d.status)} tone={STATUS_TONE[d.status] ?? "muted"} />
                  <Muted>{`${d.punchIn ?? "—"} · ${d.punchOut ?? "—"}`}</Muted>
                </View>
              </View>
            ))}
        <Divider />
        <Muted>{STR.stfBiometricNote}</Muted>
      </Card>
    </View>
  );
}

function LeaveTab({ staff }: { staff: StaffT }): React.ReactElement {
  const onProbation = !staff.confirmationDate;
  const [{ data: pool, fetching }] = useQuery({
    query: STAFF_LEAVE_POOL_QUERY, variables: { staffProfileId: staff.id }, requestPolicy: "cache-and-network",
  });
  const [{ data: debt }] = useQuery({
    query: STAFF_PROBATION_DEBT_QUERY, variables: { staffProfileId: staff.id }, requestPolicy: "cache-and-network",
  });
  const p = pool?.staffLeavePool;
  const d = debt?.staffProbationDebt;
  if (fetching && !p) return <Loader label={STR.loading} />;

  return (
    <View>
      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.stfLeavePool}</Body>
        <Muted>{STR.stfPoolNote}</Muted>
        {/* The pool exists for a probationer, but they cannot draw it yet. Saying so
            here is the difference between a figure and a promise. */}
        {onProbation ? <Notice tone="warn" message={STR.stfPoolNotDrawableYet} /> : null}
        <Divider />
        <Row label={STR.stfPoolAllowance} value={`${bnNum(String(p?.allowanceDays ?? 0))} ${STR.stfDays}`} />
        <Row label={STR.stfPoolCarried} value={`${bnNum(String(p?.carriedOverDays ?? 0))} ${STR.stfDays}`} />
        <Row label={STR.stfPoolTaken} value={`${bnNum(String(p?.takenDays ?? 0))} ${STR.stfDays}`} />
        <Row
          label={onProbation ? STR.stfPoolOnConfirmation : STR.stfPoolRemaining}
          value={`${bnNum(String(p?.remainingDays ?? 0))} ${STR.stfDays}`}
        />
        {p?.overridden ? <Muted>{STR.stfPoolOverridden}</Muted> : null}
        {p?.proRated ? <Muted>{STR.stfPoolProRated}</Muted> : null}
      </Card>

      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Body style={{ fontWeight: "700", flex: 1 }}>{STR.stfHeldDebt}</Body>
          {d && d.totalDays > 0 ? <Badge text={`${bnNum(String(d.totalDays))} ${STR.stfDays}`} tone="warn" /> : null}
        </View>
        {!d || d.totalDays === 0 ? <Muted>{STR.stfNoHeldDebt}</Muted> : (
          <>
            <Muted>{STR.stfHeldDebtNote}</Muted>
            <Divider />
            <Row label={STR.stfHeldOnConfirm} value={STR.stfHeldOnConfirmValue} />
            <Row label={STR.stfHeldOnExit} value={STR.stfHeldOnExitValue} />
            <Divider />
            {d.rows.map((r) => (
              <Row key={r.id} label={`${fmtDate(r.fromKey)} · ${leaveTypeLabel(r.leaveType)}`}
                value={`${bnNum(String(r.days))} ${STR.stfDays}`} />
            ))}
          </>
        )}
      </Card>
    </View>
  );
}

function PayrollTab({ staff, onSetPay }: { staff: StaffT; onSetPay: () => void }): React.ReactElement {
  const monthKey = monthKeyOf(new Date());
  const [{ data, fetching, error }] = useQuery({
    query: STAFF_PAYSLIPS_QUERY, variables: { staffProfileId: staff.id }, requestPolicy: "cache-and-network",
  });
  const [{ data: pol }] = useQuery({ query: HR_POLICY_QUERY });
  const [{ data: late }] = useQuery({
    query: STAFF_LATENESS_PREVIEW_QUERY, variables: { staffProfileId: staff.id, monthKey }, requestPolicy: "cache-and-network",
  });
  const slips = data?.staffPayslips ?? [];
  const p = pol?.hrPolicy;
  const l = late?.staffLatenessPreview;
  const salary = staff.monthlySalary;
  // Indicative only — payroll computes the real rate from the run's working days.
  const dayRate = salary != null && salary > 0 ? Math.round(salary / 26) : null;

  return (
    <View>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Body style={{ fontWeight: "700", flex: 1 }}>{STR.stfSalarySetup}</Body>
          <Badge text={STR.stfPrincipalOnly} tone="gold" />
        </View>
        <Row label={STR.stfMonthlySalary} value={salary != null ? taka(salary) : "—"} />
        <Row label={STR.stfPaymentMethod} value={staff.paymentMethod ? paymentMethodLabel(staff.paymentMethod) : "—"} />
        {dayRate != null ? <Row label={STR.stfDayRate} value={taka(dayRate)} /> : null}
        {staff.bankAccount ? <Row label={STR.bankAccount} value={staff.bankAccount} /> : null}
        {salary == null ? <Notice tone="warn" message={STR.stfNoSalaryYet} /> : null}
        {/* Setting pay used to mean leaving the hub entirely for the payroll screens —
            the exact scatter this hub exists to end. */}
        <Button title={STR.stfSetPay} variant="secondary" onPress={onSetPay} style={{ marginTop: space(2) }} />
      </Card>

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfLatenessRule}</Body>
        {p && !p.latenessRuleEnabled ? <Notice tone="info" message={STR.stfLatenessOff} /> : null}
        <Muted>{STR.stfLatenessExplain}</Muted>
        {l ? (
          <>
            <Divider />
            <Row label={`${STR.stfLate} — ${monthLabel(monthKey)}`} value={`${bnNum(String(l.lateCount))} ${STR.stfDays}`} />
            <Row label={STR.stfChargedDays} value={`${bnNum(String(l.chargedDays))} ${STR.stfDays}`} />
            <Row label={STR.stfFromLeave} value={`${bnNum(String(l.paidFromLeave))} ${STR.stfDays}`} />
            <Row label={STR.stfToSalary} value={`${bnNum(String(l.chargedToSalary))} ${STR.stfDays}`} />
            {l.chargedDays === 0 ? (
              <Muted>{`${STR.stfLatesUntilCharge}: ${bnNum(String(l.latesUntilNextCharge))}`}</Muted>
            ) : null}
          </>
        ) : null}
      </Card>

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfPayslips}</Body>
        {error ? <Notice tone="danger" message={friendlyError(error)} />
          : fetching && slips.length === 0 ? <Loader label={STR.loading} />
          : slips.length === 0 ? <EmptyState message={STR.stfNoPayslips} />
          : slips.map((s) => (
              <View key={s.id}>
                <Divider />
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ fontWeight: "700" }}>{monthLabel(s.monthKey)}</Body>
                  <Body style={{ fontWeight: "700" }}>{taka(s.netPay)}</Body>
                </View>
                {s.deductions.length > 0 ? (
                  <Muted>{`${STR.stfDeductions}: ${s.deductions.map((x) => `${x.type} ${taka(x.amount)}`).join(" · ")}`}</Muted>
                ) : null}
              </View>
            ))}
      </Card>
    </View>
  );
}

function DocumentsTab({
  staff, onIssue, onConfirm,
}: { staff: StaffT; onIssue: (kind: string) => void; onConfirm: () => void }): React.ReactElement {
  const [{ data, fetching, error }, refetch] = useQuery({
    query: STAFF_LETTERS_QUERY, variables: { staffProfileId: staff.id }, requestPolicy: "cache-and-network",
  });
  const [, voidLetter] = useMutation(VOID_STAFF_LETTER);
  const [voidingId, setVoidingId] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  const letters = data?.staffLetters ?? [];
  const confirmed = !!staff.confirmationDate;

  async function onVoid(letterId: string): Promise<void> {
    if (!reason.trim()) return;
    setBusy(true); setFailure(null);
    const res = await voidLetter({ letterId, reason: reason.trim() });
    setBusy(false);
    if (res.error) { setFailure(friendlyError(res.error)); return; }
    setVoidingId(null); setReason(""); setNotice(STR.stfLetterVoided);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <View>
      {notice ? <Notice tone="ok" message={notice} /> : null}
      {failure ? <Notice tone="danger" message={failure} /> : null}

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.stfNewLetter}</Body>
        <Button title={STR.stfLetterAppointment} onPress={() => onIssue("appointment")} />
        <View style={{ height: space(2) }} />
        {confirmed ? (
          <Button title={STR.stfLetterConfirmation} variant="secondary" onPress={() => onIssue("confirmation")} />
        ) : (
          <>
            {/* The caption explains why the LETTER is unavailable; the button beside it
                starts the confirmation that makes it available. Previously the caption
                read as though the button itself were disabled. */}
            <Muted>{STR.stfConfirmFirstNote}</Muted>
            <View style={{ height: space(1) }} />
            <Button title={STR.stfConfirmTitle} variant="secondary" onPress={onConfirm} />
          </>
        )}
        <View style={{ height: space(2) }} />
        <Button title={STR.stfLetterCertificate} variant="secondary" onPress={() => onIssue("service_certificate")} />
        {/* The Bangla চুক্তিপত্র, for staff who sign a contract rather than receive an
            appointment letter — the খালা and the দারোয়ান (D-#586). */}
        {staff.category === "support" ? (
          <>
            <View style={{ height: space(2) }} />
            <Button title={STR.stfLetterContract} variant="secondary" onPress={() => onIssue("support_contract")} />
          </>
        ) : null}
      </Card>

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfIssuedLetters}</Body>
        {error ? <Notice tone="danger" message={friendlyError(error)} />
          : fetching && letters.length === 0 ? <Loader label={STR.loading} />
          : letters.length === 0 ? <EmptyState message={STR.stfNoLetters} />
          : letters.map((l) => (
              <View key={l.id}>
                <Divider />
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space(2) }}>
                  <Body style={{ fontWeight: "700", flex: 1 }}>{letterKindLabel(l.kind)}</Body>
                  <Badge text={l.status === "void" ? STR.stfLetterStatusVoid : STR.stfLetterStatusIssued}
                    tone={l.status === "void" ? "danger" : "ok"} />
                </View>
                <Muted>{`${l.refNo} · ${fmtDate(l.letterDate)}`}</Muted>
                <Muted>{`${l.designation} · ${l.salaryMode === "paid" ? STR.stfSalaryModePaid : STR.stfSalaryModeHonorary}`}</Muted>
                {l.voidReason ? <Muted>{l.voidReason}</Muted> : null}
                <View style={{ flexDirection: "row", gap: space(2), marginTop: space(1), flexWrap: "wrap" }}>
                  {PDF_SUPPORTED ? (
                    <Button title={STR.stfViewPdf} variant="secondary" onPress={() => void openPdf(`/pdf/staff-letter/${l.id}`)} />
                  ) : null}
                  {l.status === "issued" ? (
                    <Button title={STR.stfVoidLetter} variant="ghost" onPress={() => setVoidingId(l.id)} />
                  ) : null}
                </View>
                {voidingId === l.id ? (
                  <View style={{ marginTop: space(2) }}>
                    <Field label={STR.stfVoidReasonPrompt} value={reason} onChangeText={setReason} />
                    <Button title={STR.stfVoidLetter} variant="danger" loading={busy}
                      disabled={!reason.trim()} onPress={() => void onVoid(l.id)} />
                  </View>
                ) : null}
              </View>
            ))}
        <Divider />
        <Muted>{STR.stfLetterFrozenNote}</Muted>
      </Card>
    </View>
  );
}

function PerformanceTab({ staff }: { staff: StaffT }): React.ReactElement {
  const [{ data: appr, fetching }] = useQuery({
    query: STAFF_APPRAISALS_QUERY, variables: { staffProfileId: staff.id }, requestPolicy: "cache-and-network",
  });
  const [{ data: cond }] = useQuery({
    query: STAFF_CONDUCT_RECORDS_QUERY, variables: { staffProfileId: staff.id }, requestPolicy: "cache-and-network",
  });
  const [{ data: obs }] = useQuery({
    query: STAFF_OBSERVATIONS_QUERY, variables: { staffProfileId: staff.id }, requestPolicy: "cache-and-network",
  });
  const appraisals = appr?.staffAppraisals ?? [];
  const conduct = cond?.staffConductRecords ?? [];
  const observations = obs?.staffObservations ?? [];
  if (fetching && appraisals.length === 0) return <Loader label={STR.loading} />;

  return (
    <View>
      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.hrMyAppraisals}</Body>
        {appraisals.length === 0 ? <Muted>{STR.empty}</Muted> : appraisals.map((a) => (
          <View key={a.id}>
            <Divider />
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>{bnNum(a.createdAt.slice(0, 4))}</Body>
              <Badge text={appraisalStatusLabel(a.status)} tone={a.status === "signed_off" ? "ok" : "info"} />
            </View>
            {a.overallOutcome ? <Row label={STR.hrAppraisalOutcome} value={appraisalOutcomeLabel(a.overallOutcome)} /> : null}
          </View>
        ))}
      </Card>

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.hrMyConduct}</Body>
        {conduct.length === 0 ? <Muted>{STR.empty}</Muted> : conduct.map((c) => (
          <View key={c.id}>
            <Divider />
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>{conductStageLabel(c.stage)}</Body>
              <Badge text={conductRecordStatusLabel(c.status)} tone={c.status === "lapsed" ? "muted" : "info"} />
            </View>
            <Muted>{c.issue}</Muted>
          </View>
        ))}
      </Card>

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfObservations}</Body>
        {observations.length === 0 ? <Muted>{STR.empty}</Muted> : (
          <Muted>{`${bnNum(String(observations.length))} ${STR.stfObservationCount}`}</Muted>
        )}
      </Card>
    </View>
  );
}

function ExitTab({ staff }: { staff: StaffT }): React.ReactElement {
  const [{ data, fetching }] = useQuery({ query: OFFBOARDING_CASES_QUERY, variables: { status: null }, requestPolicy: "cache-and-network" });
  const mine = (data?.offboardingCases ?? []).filter((c) => c.staffProfileId === staff.id);
  if (fetching && mine.length === 0) return <Loader label={STR.loading} />;

  return (
    <View>
      {mine.length === 0 ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.stfNoExitCase}</Body>
          {/* Starting an exit stays in the HR tab deliberately: it opens a clearance
              workflow with a settlement, not a field on a profile. */}
          <Muted>{STR.stfExitStartElsewhere}</Muted>
        </Card>
      ) : mine.map((c) => (
        <Card key={c.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700", flex: 1 }}>{offboardingTriggerLabel(c.trigger)}</Body>
            <Badge text={offboardingStatusLabel(c.status)} tone={c.status === "settled" ? "ok" : "warn"} />
          </View>
          <Row label={STR.stfExitLastDay} value={fmtDate(c.lastWorkingDayKey)} />
          <Row label={STR.stfExitAccessRevoked} value={c.accessRevoked ? STR.stfYes : STR.stfNo} />
        </Card>
      ))}
    </View>
  );
}

function letterKindLabel(kind: string): string {
  if (kind === "appointment") return STR.stfLetterAppointment;
  if (kind === "confirmation") return STR.stfLetterConfirmation;
  if (kind === "support_contract") return STR.stfLetterContract;
  return STR.stfLetterCertificate;
}

// ---------------------------------------------------------------------------

export default function StaffHubScreen({ route, navigation }: Props): React.ReactElement {
  const initial = route.params.staff;
  const { can } = useAuth();
  const nav = useNavigation<NavigationProp<AdminStackParamList>>();

  const [{ data, error }, refetch] = useQuery({
    query: STAFF_PROFILE_QUERY,
    variables: { staffProfileId: initial.id }, requestPolicy: "cache-and-network",
  });

  // Any write on this screen navigates away and back, so refetching on focus is what
  // makes a confirmation, an edit or a letter visible without a manual reload.
  React.useEffect(
    () =>
      navigation.addListener("focus", () => {
        refetch({ requestPolicy: "network-only" });
        setReloadKey((n) => n + 1);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigation],
  );

  // The param paints the first frame; the live record replaces it the moment it lands.
  const staff: StaffT = data?.staffProfile ?? initial;

  const canStaff = can("staff:manage");
  // Provisioning a login is `user:manage`, NOT `staff:manage` — Office holds the
  // second and not the first, and was offered a button that could only refuse
  // (D-#581). The gate here is now the same one the mutation asserts.
  const canCredentials = can("user:manage");
  const canLeave = can("leave:manage");
  const canAttendance = can("attendance:manage");
  const canPayroll = can("payroll:manage");
  const canPerformance = can("performance:manage");

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "profile", label: STR.stfTabProfile },
    ...(canAttendance ? [{ key: "attendance" as TabKey, label: STR.stfTabAttendance }] : []),
    ...(canLeave ? [{ key: "leave" as TabKey, label: STR.stfTabLeave }] : []),
    ...(canPayroll ? [{ key: "payroll" as TabKey, label: STR.stfTabPayroll }] : []),
    ...(canStaff ? [{ key: "documents" as TabKey, label: STR.stfTabDocuments }] : []),
    ...(canPerformance ? [{ key: "performance" as TabKey, label: STR.stfTabPerformance }] : []),
    ...(canStaff ? [{ key: "exit" as TabKey, label: STR.stfTabExit }] : []),
  ];
  const [tab, setTab] = React.useState<TabKey>("profile");
  // Bumped on focus so the ACTIVE tab remounts when we return from a write. The hub
  // stays mounted while a confirm/letter screen sits on top of it, so nothing else
  // would make its queries run again (D-#575).
  const [reloadKey, setReloadKey] = React.useState(0);

  return (
    <Screen scroll>
      <H2>{staff.nameBn || staff.name}</H2>
      <Muted>{`${staff.designation ?? hrCategoryLabel(staff.category)} · ${STR.staffId} ${staff.schoolId}`}</Muted>

      {error ? <Notice tone="warn" message={friendlyError(error)} /> : null}

      <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2), flexWrap: "wrap" }}>
        <Badge text={employmentStatusLabel(staff.employmentStatus)} tone={staff.confirmationDate ? "ok" : "warn"} />
      </View>

      <View style={{ marginTop: space(3) }}>
        <ChipRow>
          {tabs.map((t) => (
            <Chip key={t.key} label={t.label} selected={tab === t.key} onPress={() => setTab(t.key)} />
          ))}
        </ChipRow>
      </View>

      {canStaff ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.stfQuickActions}</Body>
          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            <Button title={STR.staffEditAction} variant="secondary" onPress={() => nav.navigate("StaffForm", { staff })} />
            {!staff.confirmationDate ? (
              <Button title={STR.stfConfirmTitle} onPress={() => nav.navigate("ConfirmEmployment", { staff })} />
            ) : null}
          </View>
        </Card>
      ) : null}

      {/* The password is reset HERE, for THIS person (D-#581). It used to navigate to a
          school-wide credentials list, where you then had to find the same person
          again — from a screen that already knew who they were. */}
      {canCredentials ? <CredentialCard staff={staff} /> : null}

      {tab === "profile" ? <ProfileTab key={reloadKey} staff={staff} canLeave={canLeave} /> : null}
      {tab === "attendance" && canAttendance ? <AttendanceTab key={reloadKey} staff={staff} /> : null}
      {tab === "leave" && canLeave ? <LeaveTab key={reloadKey} staff={staff} /> : null}
      {tab === "payroll" && canPayroll ? (
        <PayrollTab key={reloadKey} staff={staff} onSetPay={() => navigation.navigate("StaffPayEdit", { staff })} />
      ) : null}
      {tab === "documents" && canStaff ? (
        <DocumentsTab
          key={reloadKey}
          staff={staff}
          onIssue={(kind) => navigation.navigate("IssueLetter", { staff, kind })}
          onConfirm={() => navigation.navigate("ConfirmEmployment", { staff })}
        />
      ) : null}
      {tab === "performance" && canPerformance ? <PerformanceTab key={reloadKey} staff={staff} /> : null}
      {tab === "exit" && canStaff ? <ExitTab key={reloadKey} staff={staff} /> : null}
    </Screen>
  );
}

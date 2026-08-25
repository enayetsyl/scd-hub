/**
 * StaffHubScreen (SH-6; docs/prd-staff-hub.md) — ONE screen for a staff member's whole
 * record, replacing the six destinations the owner had to walk between: the staff list,
 * the credentials screen, leave admin, payroll, performance and offboarding.
 *
 * TABS ARE LAZY AND SEPARATELY GATED. Each tab runs its own query and is only mounted
 * when it is the active tab, so a caller who lacks `payroll:manage` never fires the
 * payroll query at all. That is deliberate: D-#532 was a permission-carrying field
 * returning `null` under a screen that read through it, and it took down the whole
 * navigator. Nothing here reads through a refused field, because nothing here asks for
 * one it cannot hold.
 *
 * Registered in the ADMIN stack, beside the staff list it is opened from and the
 * StaffForm its সম্পাদনা action returns to — one stack, so every navigate here is
 * type-checked against the routes that actually exist. It is never registered FIRST:
 * this screen takes params, and a param-taking initial route crashes the whole tab on
 * open, which neither tsc nor `expo export` catches.
 */
import React from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AdminStackParamList } from "../../navigation/types";
import {
  STAFF_LETTERS_QUERY,
  STAFF_LEAVE_POOL_QUERY,
  STAFF_PROBATION_DEBT_QUERY,
  STAFF_ATTENDANCE_QUERY,
  STAFF_ATTENDANCE_SUMMARY_QUERY,
  STAFF_LATENESS_PREVIEW_QUERY,
  STAFF_PAYSLIPS_QUERY,
  VOID_STAFF_LETTER,
  type StaffT,
} from "../../graphql/operations";
import { useMutation } from "urql";
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
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "StaffHub">;

type TabKey = "profile" | "attendance" | "leave" | "payroll" | "documents";

/** ISO/date-key → DD/MM/YYYY in Bangla numerals. */
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
/** "2026-08" → "আগস্ট ২০২৬" (BN) / "August 2026" (EN). */
const MONTHS_BN = ["জানুয়ারি","ফেব্রুয়ারি","মার্চ","এপ্রিল","মে","জুন","জুলাই","আগস্ট","সেপ্টেম্বর","অক্টোবর","নভেম্বর","ডিসেম্বর"];
const MONTHS_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const en = STR.stfTabProfile === "Profile";
  return en ? `${MONTHS_EN[m - 1]} ${y}` : `${MONTHS_BN[m - 1]} ${bnNum(String(y))}`;
}

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "muted"> = {
  PRESENT: "ok",
  LATE: "warn",
  ABSENT: "danger",
  LEAVE: "muted",
};
function attendanceStatusLabel(s: string): string {
  const en = STR.stfTabProfile === "Profile";
  const bn: Record<string, string> = { PRESENT: "উপস্থিত", LATE: "বিলম্বে", ABSENT: "অনুপস্থিত", LEAVE: "ছুটিতে" };
  const eng: Record<string, string> = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent", LEAVE: "On leave" };
  return (en ? eng : bn)[s] ?? s;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function ProfileTab({ staff, canLeave }: { staff: StaffT; canLeave: boolean }): React.ReactElement {
  // The at-a-glance strip is the consolidation payoff, but it is the ONE place the
  // profile tab reaches into another tab's data — so it is gated on the same
  // permission that tab is, and simply absent otherwise.
  const [{ data: pool }] = useQuery({
    query: STAFF_LEAVE_POOL_QUERY,
    variables: { staffProfileId: staff.id },
    pause: !canLeave,
  });
  const [{ data: debt }] = useQuery({
    query: STAFF_PROBATION_DEBT_QUERY,
    variables: { staffProfileId: staff.id },
    pause: !canLeave,
  });

  const onProbation = !staff.confirmationDate;
  const held = debt?.staffProbationDebt.totalDays ?? 0;

  return (
    <View>
      {onProbation ? <Notice tone="warn" message={STR.stfOnProbationNotice} /> : null}

      {canLeave ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.stfAtAGlance}</Body>
          <Row label={STR.stfLeaveRemaining} value={`${bnNum(String(pool?.staffLeavePool.remainingDays ?? 0))} ${STR.stfDays}`} />
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

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfPersonal}</Body>
        <Row label={STR.dob} value={fmtDate(staff.dob)} />
        <Row label={STR.bloodGroup} value={staff.bloodGroup ?? "—"} />
        {staff.maritalStatus ? <Row label={STR.maritalStatus} value={staff.maritalStatus} /> : null}
        {staff.qualification ? <Row label={STR.qualification} value={staff.qualification} /> : null}
        {staff.fatherName ? <Row label={STR.fatherName} value={staff.fatherName} /> : null}
        {staff.motherName ? <Row label={STR.motherName} value={staff.motherName} /> : null}
        {staff.spouseName ? <Row label={STR.spouseName} value={staff.spouseName} /> : null}
      </Card>

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
    query: STAFF_ATTENDANCE_QUERY,
    variables: { staffProfileId: staff.id, fromKey, toKey },
  });
  const [{ data: sum }] = useQuery({
    query: STAFF_ATTENDANCE_SUMMARY_QUERY,
    variables: { staffProfileId: staff.id, fromKey, toKey },
  });
  const [{ data: late }] = useQuery({
    query: STAFF_LATENESS_PREVIEW_QUERY,
    variables: { staffProfileId: staff.id, monthKey },
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

      {/* The lateness reckoning is shown where the lates are, not only on the payslip:
          a teacher should learn a charge is coming before it lands on their pay. */}
      {l && l.lateCount > 0 ? (
        <Notice
          tone={l.enabled ? "warn" : "info"}
          message={
            l.enabled
              ? `${STR.stfLatenessExplain} — ${bnNum(String(l.lateCount))} / ${bnNum(String(l.lateDaysPerCharge))}`
              : STR.stfLatenessOff
          }
        />
      ) : null}

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfPunchTimes}</Body>
        {error ? (
          <Notice tone="danger" message={friendlyError(error)} />
        ) : fetching ? (
          <Loader label={STR.loading} />
        ) : days.length === 0 ? (
          <EmptyState message={STR.stfNoAttendance} />
        ) : (
          days
            .slice()
            .reverse()
            .map((d) => (
              <View key={d.dateKey}>
                <Divider />
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                  <Body style={{ flex: 1 }}>{fmtDate(d.dateKey)}</Body>
                  <Badge text={attendanceStatusLabel(d.status)} tone={STATUS_TONE[d.status] ?? "muted"} />
                  <Muted>{`${d.punchIn ?? "—"} · ${d.punchOut ?? "—"}`}</Muted>
                </View>
              </View>
            ))
        )}
        <Divider />
        <Muted>{STR.stfBiometricNote}</Muted>
      </Card>
    </View>
  );
}

function LeaveTab({ staff }: { staff: StaffT }): React.ReactElement {
  const [{ data: pool, fetching }] = useQuery({
    query: STAFF_LEAVE_POOL_QUERY,
    variables: { staffProfileId: staff.id },
  });
  const [{ data: debt }] = useQuery({
    query: STAFF_PROBATION_DEBT_QUERY,
    variables: { staffProfileId: staff.id },
  });

  const p = pool?.staffLeavePool;
  const d = debt?.staffProbationDebt;

  if (fetching && !p) return <Loader label={STR.loading} />;

  return (
    <View>
      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.stfLeavePool}</Body>
        <Muted>{STR.stfPoolNote}</Muted>
        <Divider />
        <Row label={STR.stfPoolAllowance} value={`${bnNum(String(p?.allowanceDays ?? 0))} ${STR.stfDays}`} />
        <Row label={STR.stfPoolCarried} value={`${bnNum(String(p?.carriedOverDays ?? 0))} ${STR.stfDays}`} />
        <Row label={STR.stfPoolTaken} value={`${bnNum(String(p?.takenDays ?? 0))} ${STR.stfDays}`} />
        <Row label={STR.stfPoolRemaining} value={`${bnNum(String(p?.remainingDays ?? 0))} ${STR.stfDays}`} />
        {p?.overridden ? <Muted>{STR.stfPoolOverridden}</Muted> : null}
        {p?.proRated ? <Muted>{STR.stfPoolProRated}</Muted> : null}
      </Card>

      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Body style={{ fontWeight: "700", flex: 1 }}>{STR.stfHeldDebt}</Body>
          {d && d.totalDays > 0 ? <Badge text={`${bnNum(String(d.totalDays))} ${STR.stfDays}`} tone="warn" /> : null}
        </View>
        {!d || d.totalDays === 0 ? (
          <Muted>{STR.stfNoHeldDebt}</Muted>
        ) : (
          <>
            <Muted>{STR.stfHeldDebtNote}</Muted>
            <Divider />
            <Row label={STR.stfHeldOnConfirm} value={STR.stfHeldOnConfirmValue} />
            <Row label={STR.stfHeldOnExit} value={STR.stfHeldOnExitValue} />
            <Divider />
            {d.rows.map((r) => (
              <Row
                key={r.id}
                label={`${fmtDate(r.fromKey)} · ${leaveTypeLabel(r.leaveType)}`}
                value={`${bnNum(String(r.days))} ${STR.stfDays}`}
              />
            ))}
          </>
        )}
      </Card>
    </View>
  );
}

function PayrollTab({ staff }: { staff: StaffT }): React.ReactElement {
  const [{ data, fetching, error }] = useQuery({
    query: STAFF_PAYSLIPS_QUERY,
    variables: { staffProfileId: staff.id },
  });
  const slips = data?.staffPayslips ?? [];

  return (
    <View>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Body style={{ fontWeight: "700", flex: 1 }}>{STR.stfSalarySetup}</Body>
          <Badge text={STR.stfPrincipalOnly} tone="gold" />
        </View>
        <Row
          label={STR.stfMonthlySalary}
          value={staff.monthlySalary != null ? `৳ ${bnNum(String(staff.monthlySalary))}` : "—"}
        />
        <Row label={STR.stfPaymentMethod} value={staff.paymentMethod ?? "—"} />
      </Card>

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfPayslips}</Body>
        {error ? (
          <Notice tone="danger" message={friendlyError(error)} />
        ) : fetching && slips.length === 0 ? (
          <Loader label={STR.loading} />
        ) : slips.length === 0 ? (
          <EmptyState message={STR.stfNoPayslips} />
        ) : (
          slips.map((s) => (
            <View key={s.id}>
              <Divider />
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>{monthLabel(s.monthKey)}</Body>
                <Body style={{ fontWeight: "700" }}>{`৳ ${bnNum(String(s.netPay))}`}</Body>
              </View>
              {s.deductions.length > 0 ? (
                <Muted>
                  {`${STR.stfDeductions}: ${s.deductions
                    .map((x) => `${x.type} ৳${bnNum(String(x.amount))}`)
                    .join(" · ")}`}
                </Muted>
              ) : null}
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

function DocumentsTab({
  staff,
  onIssue,
  onConfirm,
}: {
  staff: StaffT;
  onIssue: (kind: string) => void;
  onConfirm: () => void;
}): React.ReactElement {
  const [{ data, fetching, error }, refetch] = useQuery({
    query: STAFF_LETTERS_QUERY,
    variables: { staffProfileId: staff.id },
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
    setBusy(true);
    setFailure(null);
    const res = await voidLetter({ letterId, reason: reason.trim() });
    setBusy(false);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    setVoidingId(null);
    setReason("");
    setNotice(STR.stfLetterVoided);
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
            <Button title={STR.stfConfirmTitle} variant="secondary" onPress={onConfirm} />
            <Muted style={{ marginTop: space(1) }}>{STR.stfConfirmFirstNote}</Muted>
          </>
        )}
        <View style={{ height: space(2) }} />
        <Button title={STR.stfLetterCertificate} variant="secondary" onPress={() => onIssue("service_certificate")} />
      </Card>

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfIssuedLetters}</Body>
        {error ? (
          <Notice tone="danger" message={friendlyError(error)} />
        ) : fetching && letters.length === 0 ? (
          <Loader label={STR.loading} />
        ) : letters.length === 0 ? (
          <EmptyState message={STR.stfNoLetters} />
        ) : (
          letters.map((l) => (
            <View key={l.id}>
              <Divider />
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                <Body style={{ fontWeight: "700", flex: 1 }}>{letterKindLabel(l.kind)}</Body>
                <Badge
                  text={l.status === "void" ? STR.stfVoidLetter : STR.stfLetterIssued}
                  tone={l.status === "void" ? "danger" : "ok"}
                />
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
                  <Button
                    title={STR.stfVoidLetter}
                    variant="danger"
                    loading={busy}
                    disabled={!reason.trim()}
                    onPress={() => void onVoid(l.id)}
                  />
                </View>
              ) : null}
            </View>
          ))
        )}
        <Divider />
        <Muted>{STR.stfLetterFrozenNote}</Muted>
      </Card>
    </View>
  );
}

function letterKindLabel(kind: string): string {
  if (kind === "appointment") return STR.stfLetterAppointment;
  if (kind === "confirmation") return STR.stfLetterConfirmation;
  return STR.stfLetterCertificate;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function StaffHubScreen({ route, navigation }: Props): React.ReactElement {
  const { staff } = route.params;
  const { can } = useAuth();
  const nav = useNavigation<NavigationProp<AdminStackParamList>>();

  const canStaff = can("staff:manage");
  const canLeave = can("leave:manage");
  const canAttendance = can("attendance:manage");
  const canPayroll = can("payroll:manage");

  // Only the tabs the caller can actually read are offered — the gate is here, and
  // the server enforces it again. A tab the caller lacks is absent, not disabled:
  // an inert control that never explains itself is worse than no control.
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "profile", label: STR.stfTabProfile },
    ...(canAttendance ? [{ key: "attendance" as TabKey, label: STR.stfTabAttendance }] : []),
    ...(canLeave ? [{ key: "leave" as TabKey, label: STR.stfTabLeave }] : []),
    ...(canPayroll ? [{ key: "payroll" as TabKey, label: STR.stfTabPayroll }] : []),
    ...(canStaff ? [{ key: "documents" as TabKey, label: STR.stfTabDocuments }] : []),
  ];
  const [tab, setTab] = React.useState<TabKey>("profile");

  return (
    <Screen scroll>
      <H2>{staff.nameBn || staff.name}</H2>
      <Muted>{`${staff.designation ?? hrCategoryLabel(staff.category)} · ${STR.staffId} ${staff.schoolId}`}</Muted>

      <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2), flexWrap: "wrap" }}>
        <Badge
          text={employmentStatusLabel(staff.employmentStatus)}
          tone={staff.confirmationDate ? "ok" : "warn"}
        />
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
            <Button
              title={STR.staffEditAction}
              variant="secondary"
              onPress={() => nav.navigate("StaffForm", { staff })}
            />
            {!staff.confirmationDate ? (
              <Button
                title={STR.stfConfirmTitle}
                onPress={() => nav.navigate("ConfirmEmployment", { staff })}
              />
            ) : null}
          </View>
        </Card>
      ) : null}

      {tab === "profile" ? <ProfileTab staff={staff} canLeave={canLeave} /> : null}
      {tab === "attendance" && canAttendance ? <AttendanceTab staff={staff} /> : null}
      {tab === "leave" && canLeave ? <LeaveTab staff={staff} /> : null}
      {tab === "payroll" && canPayroll ? <PayrollTab staff={staff} /> : null}
      {tab === "documents" && canStaff ? (
        <DocumentsTab
          staff={staff}
          onIssue={(kind) => navigation.navigate("IssueLetter", { staff, kind })}
          onConfirm={() => navigation.navigate("ConfirmEmployment", { staff })}
        />
      ) : null}
    </Screen>
  );
}

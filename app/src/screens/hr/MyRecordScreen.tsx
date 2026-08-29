/**
 * MyRecordScreen — a staff member's own employment record (prd-hr H5.5, own-row):
 * appraisals (incl. outcome), conduct ladder, grievances (+ raise), CPD log, and
 * any observations the caller authored as a supervisor. All own-row, no permission.
 *
 * SH-7 adds the own-row leave picture: the shared annual pool (D-#539) and any held
 * probation-leave days (D-#540) — the balance a teacher is most likely to ask about,
 * and the one number that can now drop without them having applied for anything.
 *
 * SH-8 closes the two gaps this header flagged since PR-1 — and they were still open:
 * `myPayslips` and `myStaffAttendance` have existed on the SERVER since PR-2/AT-1, but
 * no app operation ever called them, so a teacher could not see their own punch times
 * or their own payslip anywhere. Both are own-row (no permission) and return empty for
 * a login with no linked StaffProfile, so neither can be what breaks this screen.
 * Payslips are LOCKED runs only — a prepared run is not a payslip yet.
 */
import React from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import {
  MY_APPRAISALS_QUERY,
  MY_CONDUCT_RECORDS_QUERY,
  MY_GRIEVANCES_QUERY,
  MY_DEVELOPMENT_LOG_QUERY,
  MY_OBSERVATIONS_QUERY,
  MY_LEAVE_POOL_QUERY,
  MY_PROBATION_DEBT_QUERY,
  MY_STAFF_ATTENDANCE_QUERY,
  MY_PAYSLIPS_QUERY,
  RAISE_GRIEVANCE,
  SUBJECTS_QUERY,
} from "../../graphql/operations";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Row,
  Divider,
  Button,
  Badge,
  Field,
  Loader,
  EmptyState,
  Notice,
} from "../../components/ui";
import {
  STR,
  bnNum,
  appraisalStatusLabel,
  appraisalOutcomeLabel,
  conductStageLabel,
  conductRecordStatusLabel,
  grievanceStatusLabel,
  payDeductionTypeLabel,
  payLineNote,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

/** SH-8 — the last 30 days, as the two date keys myStaffAttendance takes. */
function last30(): { fromKey: string; toKey: string } {
  const key = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { fromKey: key(from), toKey: key(to) };
}

/** `2026-08-25` → `২৫/০৮/২০২৬`. */
function fmtDayKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return y && m && d ? bnNum(`${d}/${m}/${y}`) : dateKey;
}

const ATT_TONE: Record<string, "ok" | "warn" | "danger" | "muted"> = {
  PRESENT: "ok",
  LATE: "warn",
  ABSENT: "danger",
  LEAVE: "muted",
};
function attStatusLabel(status: string): string {
  if (status === "PRESENT") return STR.stfPresent;
  if (status === "LATE") return STR.stfLate;
  if (status === "ABSENT") return STR.stfAbsent;
  if (status === "LEAVE") return STR.stfOnLeave;
  return status;
}
function grievanceTone(s: string): "info" | "ok" | "muted" {
  return s === "resolved" || s === "closed" ? "ok" : s === "under_review" ? "info" : "muted";
}

export default function MyRecordScreen(): React.ReactElement {
  const [subject, setSubject] = React.useState("");
  const [detail, setDetail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [apprQ] = useQuery({ query: MY_APPRAISALS_QUERY });
  const [conductQ] = useQuery({ query: MY_CONDUCT_RECORDS_QUERY });
  const [grievQ, refetchGriev] = useQuery({ query: MY_GRIEVANCES_QUERY });
  const [cpdQ] = useQuery({ query: MY_DEVELOPMENT_LOG_QUERY });
  const [obsQ] = useQuery({ query: MY_OBSERVATIONS_QUERY });
  const [subjectsQ] = useQuery({ query: SUBJECTS_QUERY });
  // SH-7 — the two own-row reads MyRecordScreen has lacked since PR-1.
  const [poolQ] = useQuery({ query: MY_LEAVE_POOL_QUERY });
  const [debtQ] = useQuery({ query: MY_PROBATION_DEBT_QUERY });
  const attRange = React.useMemo(() => last30(), []);
  const [attQ] = useQuery({ query: MY_STAFF_ATTENDANCE_QUERY, variables: attRange });
  const [slipQ] = useQuery({ query: MY_PAYSLIPS_QUERY });

  const [, raise] = useMutation(RAISE_GRIEVANCE);

  const appraisals = apprQ.data?.myAppraisals ?? [];
  const conduct = conductQ.data?.myConductRecords ?? [];
  const grievances = grievQ.data?.myGrievances ?? [];
  const cpd = cpdQ.data?.myDevelopmentLog ?? [];
  const observations = obsQ.data?.myObservations ?? [];
  const subjectName = new Map((subjectsQ.data?.subjects ?? []).map((s) => [s.id, s.nameBn]));
  const pool = poolQ.data?.myLeavePool;
  const heldDebt = debtQ.data?.myProbationDebt;
  const attendance = attQ.data?.myStaffAttendance ?? [];
  const payslips = slipQ.data?.myPayslips ?? [];

  const anyLoading = apprQ.fetching || conductQ.fetching || grievQ.fetching || cpdQ.fetching;
  const firstError = apprQ.error ?? conductQ.error ?? grievQ.error ?? cpdQ.error ?? obsQ.error;

  async function submitGrievance(): Promise<void> {
    if (subject.trim() === "" || detail.trim() === "") return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await raise({ subject: subject.trim(), detail: detail.trim() });
    setBusy(false);
    if (res.error || !res.data?.raiseGrievance) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrGrievanceRaised);
    setSubject("");
    setDetail("");
    refetchGriev({ requestPolicy: "network-only" });
  }

  if (anyLoading) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }

  // The own-row my* resolvers throw "No staff profile linked…" when the login has
  // no StaffProfile; surface that once rather than five times.
  if (firstError) {
    return (
      <Screen scroll>
        <H2>{STR.hrMyRecord}</H2>
        <Notice message={friendlyError(firstError)} tone="warn" />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <H2>{STR.hrMyRecord}</H2>

      {/* SH-7: own leave balance + held probation days. Both are own-row (no
          permission) and return a zeroed view for a login with no linked
          StaffProfile, so this block can never be the thing that breaks the screen. */}
      <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.stfMyLeavePool}</Body>
      <Card>
        {/* A probationer's pool is what she WILL get, not what she can take now: every
            day off before confirmation is held unpaid (D-#540). Labelling it "বাকি" was
            the exact opposite of the rule she is under, so the label follows the flag. */}
        {pool?.onProbation ? <Notice tone="warn" message={STR.stfOnProbationNotice} /> : null}
        <Row label={STR.stfPoolAllowance} value={`${bnNum(String(pool?.allowanceDays ?? 0))} ${STR.stfDays}`} />
        <Row label={STR.stfPoolTaken} value={`${bnNum(String(pool?.takenDays ?? 0))} ${STR.stfDays}`} />
        <Row
          label={pool?.onProbation ? STR.stfPoolOnConfirmation : STR.stfPoolRemaining}
          value={`${bnNum(String(pool?.remainingDays ?? 0))} ${STR.stfDays}`}
        />
        {pool?.onProbation ? <Muted>{STR.stfPoolNotDrawableYet}</Muted> : null}
        <Muted>{STR.stfPoolNote}</Muted>
      </Card>

      {heldDebt && heldDebt.totalDays > 0 ? (
        <>
          <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.stfMyHeldDebt}</Body>
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Muted style={{ flex: 1 }}>{STR.stfHeldDebtNote}</Muted>
              <Badge text={`${bnNum(String(heldDebt.totalDays))} ${STR.stfDays}`} tone="warn" />
            </View>
            <Row label={STR.stfHeldOnConfirm} value={STR.stfHeldOnConfirmValue} />
            <Row label={STR.stfHeldOnExit} value={STR.stfHeldOnExitValue} />
          </Card>
        </>
      ) : null}

      {/* SH-8 — own attendance, last 30 days. The punch times a teacher could not see
          anywhere in the app until now. Newest first: the question is almost always
          "what did today/yesterday record", not "what did last month". */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>
        {STR.stfMyAttendanceRecent}
      </Body>
      <Card>
        {attendance.length === 0 ? (
          <Muted>{STR.stfMyNoAttendance}</Muted>
        ) : (
          attendance
            .slice()
            .reverse()
            .map((d, i) => (
              <View key={d.id}>
                {i > 0 ? <Divider /> : null}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                  <Body style={{ flex: 1 }}>{fmtDayKey(d.dateKey)}</Body>
                  <Badge text={attStatusLabel(d.status)} tone={ATT_TONE[d.status] ?? "muted"} />
                  <Muted>{`${d.punchIn ?? "—"} · ${d.punchOut ?? "—"}`}</Muted>
                </View>
              </View>
            ))
        )}
      </Card>

      {/* SH-8 — own payslips (LOCKED runs only). */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>
        {STR.stfMyPayslips}
      </Body>
      {payslips.length === 0 ? (
        <Card><Muted>{STR.stfMyNoPayslips}</Muted></Card>
      ) : (
        payslips.map((s) => (
          <Card key={s.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>{s.monthKey}</Body>
              <Body style={{ fontWeight: "700" }}>{`৳ ${bnNum(String(s.netPay))}`}</Body>
            </View>
            <Row label={STR.hrPayGross} value={`৳ ${bnNum(String(s.grossSalary))}`} />
            {s.deductions.map((d, i) => (
              <Row
                key={`${s.id}-${i}`}
                // Was `d.note ?? d.type` — which printed a teacher her own payslip line
                // as the raw English type, or as "advance 665f…" with a database id in
                // it. The type has a Bangla label; the note is only ever an extra.
                label={`${payDeductionTypeLabel(d.type)}${payLineNote(d.note) ? ` · ${payLineNote(d.note)}` : ""}`}
                value={`− ৳ ${bnNum(String(d.amount))}${d.days ? ` (${bnNum(String(d.days))} ${STR.stfDays})` : ""}`}
              />
            ))}
          </Card>
        ))
      )}

      {/* Appraisals */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrMyAppraisals}</Body>
      {appraisals.length === 0 ? (
        <Card><Muted>{STR.empty}</Muted></Card>
      ) : (
        appraisals.map((a) => (
          <Card key={a.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>{bnNum(a.createdAt.slice(0, 4))}</Body>
              <Badge text={appraisalStatusLabel(a.status)} tone={a.status === "signed_off" ? "ok" : "info"} />
            </View>
            {a.goals.length > 0 ? <Muted>{STR.hrAppraisalGoals}: {a.goals.join("; ")}</Muted> : null}
            {a.developmentNeeds.length > 0 ? <Muted>{STR.hrAppraisalDevNeeds}: {a.developmentNeeds.join("; ")}</Muted> : null}
            {a.overallOutcome ? <Row label={STR.hrAppraisalOutcome} value={appraisalOutcomeLabel(a.overallOutcome)} /> : null}
            {a.outcomeNote ? <Muted>“{a.outcomeNote}”</Muted> : null}
          </Card>
        ))
      )}

      {/* Conduct */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrMyConduct}</Body>
      {conduct.length === 0 ? (
        <Card><Muted>{STR.empty}</Muted></Card>
      ) : (
        conduct.map((c) => (
          <Card key={c.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>{conductStageLabel(c.stage)}</Body>
              <Badge text={conductRecordStatusLabel(c.status)} tone={c.status === "lapsed" ? "muted" : "info"} />
            </View>
            <Row label={STR.hrConductIssue} value={c.issue} />
            {c.hearingNote ? <Muted>{STR.hrConductHearing}: {c.hearingNote}</Muted> : null}
            {c.outcome ? <Muted>{STR.hrConductOutcome}: {c.outcome}</Muted> : null}
          </Card>
        ))
      )}

      {/* Grievances + raise */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrMyGrievances}</Body>
      <Muted style={{ marginBottom: space(2) }}>{STR.hrGrievanceConfidential}</Muted>
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}
      <Card>
        <Field label={STR.hrGrievanceSubject} value={subject} onChangeText={setSubject} placeholder={STR.hrGrievanceSubjectPlaceholder} autoCapitalize="sentences" />
        <Field
          label={STR.hrGrievanceDetail}
          value={detail}
          onChangeText={setDetail}
          placeholder={STR.hrGrievanceDetailPlaceholder}
          multiline
          autoCapitalize="sentences"
        />
        <Button
          title={STR.hrGrievanceSubmit}
          onPress={submitGrievance}
          loading={busy}
          disabled={busy || subject.trim() === "" || detail.trim() === ""}
        />
      </Card>
      {grievances.map((g) => (
        <Card key={g.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700", flex: 1 }}>{g.subject}</Body>
            <Badge text={grievanceStatusLabel(g.status)} tone={grievanceTone(g.status)} />
          </View>
          <Muted>{g.detail}</Muted>
          {g.resolutionNote ? <Muted>“{g.resolutionNote}”</Muted> : null}
        </Card>
      ))}

      {/* CPD */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrMyCpd}</Body>
      {cpd.length === 0 ? (
        <Card><Muted>{STR.empty}</Muted></Card>
      ) : (
        cpd.map((d) => (
          <Card key={d.id}>
            <Body style={{ fontWeight: "700" }}>{d.activity}</Body>
            <Muted>{bnNum(d.dateKey)}</Muted>
            {d.outcome ? <Muted>{STR.hrCpdOutcome}: {d.outcome}</Muted> : null}
          </Card>
        ))
      )}

      {/* Observations the caller authored (supervisor); hidden when none. */}
      {observations.length > 0 ? (
        <>
          <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrMyObservations}</Body>
          {observations.map((o) => (
            <Card key={o.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700", flex: 1 }}>{o.subjectId ? subjectName.get(o.subjectId) ?? "—" : STR.hrMyObservations}</Body>
                <Muted>{bnNum(o.dateKey)}</Muted>
              </View>
              <Muted>{o.notes}</Muted>
              {o.followUp ? <Muted>{STR.hrFollowUp}: {o.followUp}</Muted> : null}
            </Card>
          ))}
        </>
      ) : null}

    </Screen>
  );
}

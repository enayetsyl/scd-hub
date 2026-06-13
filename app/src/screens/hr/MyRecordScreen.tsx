/**
 * MyRecordScreen — a staff member's own employment record (prd-hr H5.5, own-row):
 * appraisals (incl. outcome), conduct ladder, grievances (+ raise), CPD log, and
 * any observations the caller authored as a supervisor. All own-row, no permission.
 *
 * NOT shown — no own-row server read exists yet (flagged for the coordinator):
 *   - own payslips  (payslips are payslipsForRun / payroll:manage only)
 *   - own staff attendance (teacherAttendance* is attendance:manage only)
 * These surface as "pending" notices rather than a fabricated/over-privileged read.
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
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

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

  const [, raise] = useMutation(RAISE_GRIEVANCE);

  const appraisals = apprQ.data?.myAppraisals ?? [];
  const conduct = conductQ.data?.myConductRecords ?? [];
  const grievances = grievQ.data?.myGrievances ?? [];
  const cpd = cpdQ.data?.myDevelopmentLog ?? [];
  const observations = obsQ.data?.myObservations ?? [];
  const subjectName = new Map((subjectsQ.data?.subjects ?? []).map((s) => [s.id, s.nameBn]));

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

      {/* Appraisals */}
      <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.hrMyAppraisals}</Body>
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

      {/* Flagged gaps — no own-row server read exists for these yet. */}
      <Divider />
      <Body style={{ fontWeight: "700", marginTop: space(2), marginBottom: space(2) }}>{STR.hrPayslipsTitle}</Body>
      <Notice message={STR.hrNoServerRead} tone="info" />
      <Body style={{ fontWeight: "700", marginTop: space(2), marginBottom: space(2) }}>{STR.hrAttendanceTitle}</Body>
      <Notice message={STR.hrNoServerRead} tone="info" />
    </Screen>
  );
}

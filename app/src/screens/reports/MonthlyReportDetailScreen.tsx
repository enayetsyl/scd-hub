/**
 * MonthlyReportDetailScreen (MR-5b) — one child's revision: the numbers as frozen,
 * the trend chips, the flags, and the comment a person must own before release.
 *
 * Everything shown comes out of `snapshotJson`. NOTHING is recomputed here — the
 * figure a family saw is the figure in that blob, and a screen that re-derived it
 * would eventually disagree with the PDF and the guardian's copy.
 */
import React, { useMemo, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { useRoute, type RouteProp } from "@react-navigation/native";
import {
  DRAFT_MONTHLY_COMMENT_MUTATION,
  MONTHLY_REPORT_QUERY,
  RELEASE_MONTHLY_REPORT_MUTATION,
  REVIEW_MONTHLY_COMMENT_MUTATION,
  REVOKE_MONTHLY_REPORT_MUTATION,
  parseSnapshot,
  type MonthlyReportT,
  type MonthlySnapshotT,
  type TrendT,
} from "../../graphql/monthlyReport";
import { Screen, Body, Muted, Card, Button, Field } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { space, useColors } from "../../theme";
import type { ReportsStackParamList } from "../../navigation/types";
import { blockedLabel } from "./MonthlyReportConsoleScreen";

type DetailRoute = RouteProp<ReportsStackParamList, "MonthlyReportDetail">;

function trendLabel(t: TrendT | undefined): string {
  switch (t?.state) {
    case "UP":
      return STR.mrTrendUp;
    case "DOWN":
      return STR.mrTrendDown;
    case "STEADY":
      return STR.mrTrendSteady;
    default:
      return STR.mrTrendNa;
  }
}

function trendColor(t: TrendT | undefined, colors: ReturnType<typeof useColors>): string {
  switch (t?.state) {
    case "UP":
      return colors.success;
    case "DOWN":
      return colors.error;
    case "STEADY":
      return colors.textPrimary;
    default:
      return colors.textSecondary;
  }
}

function Chip({ trend }: { trend: TrendT | undefined }): React.ReactElement {
  const colors = useColors();
  const delta = trend?.delta;
  return (
    <Muted style={{ color: trendColor(trend, colors) }}>
      {trendLabel(trend)}
      {delta != null ? ` (${delta > 0 ? "+" : ""}${bnNum(delta)})` : ""}
    </Muted>
  );
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
      <Muted style={{ flex: 1 }}>{label}</Muted>
      <Body>{value}</Body>
    </View>
  );
}

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${bnNum(Math.round(v))}%`;
}

function Sections({ snap }: { snap: MonthlySnapshotT }): React.ReactElement {
  const m = snap.metrics ?? {};
  const t = snap.trends ?? {};
  const cohort = snap.cohort;

  return (
    <>
      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.mrAttendance}</Body>
        <Chip trend={t.attendance} />
        <Row
          label={`${bnNum(m.attendance?.present ?? 0)} / ${bnNum(m.attendance?.schoolDays ?? 0)}`}
          value={pct(m.attendance?.rate ?? null)}
        />
        <Row label={STR.mrClassAvg} value={pct(cohort?.attendanceRate?.avg ?? null)} />
        {cohort?.attendanceRate?.best != null ? (
          <Row label={STR.mrClassBest} value={pct(cohort.attendanceRate.best)} />
        ) : null}
        {snap.schoolBestPresentDays != null ? (
          <Row label={STR.mrSchoolBest} value={bnNum(snap.schoolBestPresentDays)} />
        ) : null}
      </Card>

      {(["homework", "assignment"] as const).map((key) => {
        const block = m[key];
        if (!block) return null;
        const trend = key === "homework" ? t.homeworkSubmission : t.assignmentSubmission;
        return (
          <Card key={key}>
            <Body style={{ fontWeight: "700" }}>{key === "homework" ? STR.mrHomework : STR.mrAssignment}</Body>
            <Chip trend={trend} />
            <Row
              label={`${bnNum(block.submitted)} / ${bnNum(block.expectedWhilePresent)}`}
              value={pct(block.submissionRate)}
            />
            <Row label={STR.mrCoverage} value={pct(block.coverage?.pct ?? null)} />
            {block.bySubject?.map((s) => (
              <Row
                key={s.subject}
                label={hwSubjectLabel(s.subject)}
                value={`${bnNum(s.submitted)}/${bnNum(s.expectedWhilePresent)} · ${pct(s.qualityRate)}`}
              />
            ))}
          </Card>
        );
      })}

      {m.classTest ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.mrClassTest}</Body>
          <Chip trend={t.classTest} />
          <Row
            label={`${bnNum(m.classTest.marksObtained)} / ${bnNum(m.classTest.marksFull)}`}
            value={pct(m.classTest.rate)}
          />
          <Row label={STR.mrCoverage} value={pct(m.classTest.coverage?.pct ?? null)} />
        </Card>
      ) : null}

      {m.hifz && m.hifz.sessions > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.mrHifz}</Body>
          <Row
            label={`${bnNum(m.hifz.present)} / ${bnNum(m.hifz.sessions)}`}
            value={bnNum(m.hifz.juzHeard)}
          />
        </Card>
      ) : null}

      {m.concerns ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.mrConcerns}</Body>
          <Chip trend={t.concerns} />
          <Row label={STR.mrConcerns} value={bnNum(m.concerns.concern)} />
        </Card>
      ) : null}

      {m.library && m.library.taken + m.library.stillHeld > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.mrLibrary}</Body>
          <Row label={STR.mrLibrary} value={`${bnNum(m.library.taken)} · ${bnNum(m.library.overdue)}`} />
        </Card>
      ) : null}

      {/* Absent for a teacher — the server strips the block, so nothing renders. */}
      {m.fees ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.mrFees}</Body>
          <Row label={STR.mrFees} value={bnNum(m.fees.paidTotal)} />
        </Card>
      ) : null}
    </>
  );
}

export default function MonthlyReportDetailScreen(): React.ReactElement {
  const route = useRoute<DetailRoute>();
  const colors = useColors();
  const { reportId } = route.params;

  const [q, refetch] = useQuery({ query: MONTHLY_REPORT_QUERY, variables: { reportId } });
  const [, draft] = useMutation(DRAFT_MONTHLY_COMMENT_MUTATION);
  const [, review] = useMutation(REVIEW_MONTHLY_COMMENT_MUTATION);
  const [, release] = useMutation(RELEASE_MONTHLY_REPORT_MUTATION);
  const [, revoke] = useMutation(REVOKE_MONTHLY_REPORT_MUTATION);

  const report: MonthlyReportT | null = q.data?.monthlyReport ?? null;
  const snap = useMemo(() => (report ? parseSnapshot(report.snapshotJson) : {}), [report]);
  const [text, setText] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  // The editable body starts from whatever a person last owned, else the draft.
  const body = text ?? report?.comment ?? report?.commentDraft ?? "";
  const after = (r: { error?: { message: string } | null }): boolean => {
    if (r.error) {
      Alert.alert(STR.mrActionFailed, r.error.message);
      return false;
    }
    setText(null);
    refetch({ requestPolicy: "network-only" });
    return true;
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <QueryGate results={[q]} onRetry={() => refetch({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          {report ? (
            <>
              <Card>
                <Body style={{ fontWeight: "700" }}>
                  {report.studentName}
                  {report.rollNumber ? ` (${bnNum(report.rollNumber)})` : ""}
                </Body>
                <Muted>
                  {bnNum(report.periodKey)} — {STR.mrRevision} {bnNum(report.revision)}
                </Muted>
                <Muted>
                  {report.status}
                  {report.provisional ? ` · ${STR.mrProvisional}` : ""}
                  {report.isRerelease ? ` · ${STR.mrRevised}` : ""}
                </Muted>
                <Muted>
                  {STR.mrDataAsOf}: {report.dataAsOf.slice(0, 10)}
                </Muted>
                {report.changeLog.length > 0 ? (
                  <View style={{ marginTop: space(2) }}>
                    <Muted style={{ fontWeight: "700" }}>{STR.mrChangeLog}</Muted>
                    {report.changeLog.map((c) => (
                      <Muted key={c}>{c}</Muted>
                    ))}
                  </View>
                ) : null}
                {snap.flags?.map((f) => (
                  <Muted key={f.flag} style={{ color: colors.error }}>
                    {f.flag === "ABSENT_STREAK"
                      ? `${STR.mrFlagStreak}: ${bnNum(f.value)}`
                      : f.flag === "ABSENT_UNCOVERED"
                        ? `${STR.mrFlagUncovered}: ${bnNum(f.value)}`
                        : STR.mrFlagSerious}
                  </Muted>
                ))}
              </Card>

              <Sections snap={snap} />

              {/* §4: a narrowed subject teacher gets no paragraph at all. */}
              {report.fullView ? (
                <Card>
                  <Body style={{ fontWeight: "700" }}>{STR.mrComment}</Body>
                  {report.commentIsFallback ? (
                    <Muted style={{ color: colors.warning }}>
                      {STR.mrCommentFallback}
                      {report.commentFallbackReason ? `: ${report.commentFallbackReason}` : ""}
                    </Muted>
                  ) : null}
                  {report.commentModel ? <Muted>{report.commentModel}</Muted> : null}
                  <Field value={body} onChangeText={setText} multiline />
                  <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                    <Button
                      title={STR.mrGenerate}
                      variant="secondary"
                      onPress={async () => {
                        await after(await draft({ reportId }));
                      }}
                    />
                    <Button
                      title={STR.mrAccept}
                      onPress={async () => {
                        if (!body.trim()) return;
                        await after(await review({ reportId, text: body }));
                      }}
                    />
                  </View>
                </Card>
              ) : null}

              <Card>
                {report.status === "RELEASED" ? (
                  <>
                    <Muted>{STR.mrReleased}</Muted>
                    <Field label={STR.mrRevokeReason} value={reason} onChangeText={setReason} multiline />
                    <Button
                      title={STR.mrRevoke}
                      variant="danger"
                      onPress={async () => {
                        if (!reason.trim()) return;
                        await after(await revoke({ reportId, reason }));
                      }}
                    />
                  </>
                ) : (
                  <>
                    {blockedLabel(report.blockedReason) ? (
                      <Muted style={{ color: colors.error }}>{blockedLabel(report.blockedReason)}</Muted>
                    ) : null}
                    {report.requiresPrincipal ? (
                      <Field label={STR.mrOverrideReason} value={reason} onChangeText={setReason} multiline />
                    ) : null}
                    <Button
                      title={STR.mrRelease}
                      disabled={!report.releasable && !report.requiresPrincipal}
                      onPress={async () => {
                        await after(await release({ reportId, overrideReason: reason.trim() || null }));
                      }}
                    />
                  </>
                )}
              </Card>
            </>
          ) : null}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}

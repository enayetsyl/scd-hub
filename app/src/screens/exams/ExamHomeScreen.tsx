/**
 * ExamHomeScreen — the exam hub (EX-1..EX-9, docs/prd-exams.md).
 *
 * Takes NO route params, and is registered FIRST in the stack, so it is the stack's
 * initial route. A param-requiring screen in that position crashes the whole tab on
 * mount and neither tsc nor the web export catches it.
 *
 * Two audiences on one screen, because they overlap in practice:
 *   · a TEACHER sees "my duties" — the papers they must check, recheck or tabulate;
 *   · Office/Principal additionally see every paper and the publish controls.
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  EXAMS_QUERY,
  EXAM_PAPERS_QUERY,
  MY_EXAM_DUTIES_QUERY,
  MY_PENDING_CUSTODY_QUERY,
  SUBMIT_EXAM_RESULTS,
  APPROVE_EXAM_RESULTS,
} from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Badge, Chip, Loader, Notice, Divider } from "../../components/ui";
import {
  STR,
  bnNum,
  examTermLabel,
  examStatusLabel,
  examDutyRoleLabel,
  routineSubjectLabel,
  isoDateLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme/tokens";
import type { ExamsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ExamsStackParamList, "ExamHome">;

export default function ExamHomeScreen({ navigation }: Props): React.ReactElement {
  // The server stays the gate; hiding a control the role cannot use just avoids a
  // pointless round-trip to a Bangla denial.
  const { can } = useAuth();
  // Permission catalogue (D-#799): each control names its own action.
  const canView = can("exam_results:view");
  /** Sees every paper (not just own duties) and may work on any of them. */
  const canManage = can("exam_results:edit_all");
  const canSeeAllPapers = canManage || can("exam_results:settings") || can("exam_results:assign");
  const canSubmit = can("exam_results:submit");
  const canPublish = can("exam_results:publish");
  const canCustody = can("exam_custody:view");
  const canAcknowledge = can("exam_custody:acknowledge");

  const [examsQ, refetchExams] = useQuery({ query: EXAMS_QUERY, variables: { academicYearId: null } });
  const exams = examsQ.data?.exams ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const examId = selectedId ?? exams[0]?.id ?? null;
  const exam = exams.find((e) => e.id === examId) ?? null;

  const [papersQ] = useQuery({
    query: EXAM_PAPERS_QUERY,
    variables: { examId: examId ?? "" },
    pause: !examId || !canView,
  });
  const papers = papersQ.data?.examPapers ?? [];

  const [dutiesQ] = useQuery({
    query: MY_EXAM_DUTIES_QUERY,
    variables: { examId },
    pause: !examId || !canView,
  });
  const duties = dutiesQ.data?.myExamDuties ?? [];

  const [pendingQ] = useQuery({ query: MY_PENDING_CUSTODY_QUERY, pause: !canAcknowledge });
  const pendingCount = pendingQ.data?.myPendingCustodyAcknowledgements?.length ?? 0;

  const [, submitResults] = useMutation(SUBMIT_EXAM_RESULTS);
  const [, approveResults] = useMutation(APPROVE_EXAM_RESULTS);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** paperId → the duty roles this caller holds on it, so a teacher sees only their own. */
  const dutyByPaper = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const d of duties) {
      if (!d.paperId) continue;
      m.set(d.paperId, [...(m.get(d.paperId) ?? []), d.role]);
    }
    return m;
  }, [duties]);

  const visiblePapers = canSeeAllPapers ? papers : papers.filter((p) => dutyByPaper.has(p.id));

  async function onSubmit(): Promise<void> {
    if (!examId) return;
    setError(null); setOk(null); setBusy(true);
    const res = await submitResults({ examId });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.exSubmitted);
    refetchExams({ requestPolicy: "network-only" });
  }

  async function onApprove(): Promise<void> {
    if (!examId) return;
    setError(null); setOk(null); setBusy(true);
    const res = await approveResults({ examId });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.exApproved);
    refetchExams({ requestPolicy: "network-only" });
  }

  if (examsQ.fetching) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      {/* Custody inbox first — an unacknowledged handover blocks tabulation downstream,
          so it is the most time-critical thing on the screen. */}
      {pendingCount > 0 ? (
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700" }}>{STR.exWaitingOnYou}</Body>
            <Badge text={bnNum(pendingCount)} tone="warn" />
          </View>
          <View style={{ marginTop: space(2) }}>
            <Button
              title={STR.exCustodyTitle}
              variant="secondary"
              onPress={() => examId && navigation.navigate("ExamCustody", { examId, title: exam?.name ?? "" })}
              disabled={!examId}
            />
          </View>
        </Card>
      ) : null}

      {exams.length === 0 ? (
        <Card>
          <Muted>{STR.exNoExams}</Muted>
        </Card>
      ) : (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.exExams}</Body>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
            {exams.map((e) => (
              <Chip
                key={e.id}
                label={`${e.name} · ${examTermLabel(e.term)}`}
                selected={e.id === examId}
                onPress={() => setSelectedId(e.id)}
              />
            ))}
          </View>
          {exam ? (
            <View style={{ marginTop: space(2) }}>
              <Muted>
                {examStatusLabel(exam.status)}
                {exam.publishedAt ? ` · ${STR.exPublished} ${isoDateLabel(exam.publishedAt)}` : ` · ${STR.exUnpublishedState}`}
              </Muted>
            </View>
          ) : null}
        </Card>
      )}

      {exam && (canSubmit || canPublish) ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.exReportTitle}</Body>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
            {canSubmit ? (
              <Button title={STR.exSubmitResults} variant="secondary" onPress={onSubmit} loading={busy} disabled={busy} />
            ) : null}
            {canPublish ? <Button title={STR.exApprove} onPress={onApprove} loading={busy} disabled={busy} /> : null}
          </View>
          <Muted style={{ marginTop: space(2) }}>
            {/* Naming the precondition is cheaper than a failed mutation. */}
            {STR.exBlockedBy}: {STR.exNotTabulated}
          </Muted>
        </Card>
      ) : null}

      <Card>
        <Body style={{ fontWeight: "700" }}>{canSeeAllPapers ? STR.exPapers : STR.exMyDuties}</Body>
        {papersQ.fetching || dutiesQ.fetching ? (
          <Loader label={STR.loading} />
        ) : visiblePapers.length === 0 ? (
          <Muted>{canSeeAllPapers ? STR.exNoPapers : STR.exNoDuties}</Muted>
        ) : (
          visiblePapers.map((p, i) => {
            const roles = dutyByPaper.get(p.id) ?? [];
            return (
              <View key={p.id}>
                {i > 0 ? <Divider /> : null}
                <View style={{ marginTop: space(2) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Body style={{ fontWeight: "700" }}>{routineSubjectLabel(p.subject)}</Body>
                    <Badge
                      text={p.tabulatedAt ? STR.exTabulated : STR.exNotTabulated}
                      tone={p.tabulatedAt ? "ok" : "muted"}
                    />
                  </View>
                  <Muted>
                    {STR.exFullMarks}: {bnNum(p.paperFullMarks)} ·{" "}
                    {p.components.map((c) => `${c.component} ${bnNum(c.maxMarks)}`).join(" + ")}
                  </Muted>
                  {roles.length ? (
                    <Muted>{roles.map((r) => examDutyRoleLabel(r)).join(" · ")}</Muted>
                  ) : null}

                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                    {(canManage || roles.includes("CHECKER")) && !p.tabulatedAt ? (
                      <Button
                        title={STR.exEnterMarks}
                        variant="secondary"
                        onPress={() =>
                          navigation.navigate("ExamMarkGrid", {
                            paperId: p.id,
                            title: routineSubjectLabel(p.subject),
                          })
                        }
                      />
                    ) : null}
                    {canManage || roles.some((r) => ["RECHECKER", "TABULATOR", "MARK_RECHECKER"].includes(r)) ? (
                      <Button
                        title={STR.exRecheckTitle}
                        variant="secondary"
                        onPress={() =>
                          navigation.navigate("ExamRecheck", {
                            paperId: p.id,
                            title: routineSubjectLabel(p.subject),
                          })
                        }
                      />
                    ) : null}
                    {canCustody ? (
                      <Button
                        title={STR.exCustodyTitle}
                        variant="ghost"
                        onPress={() =>
                          navigation.navigate("ExamCustody", {
                            examId: p.examId,
                            paperId: p.id,
                            title: routineSubjectLabel(p.subject),
                          })
                        }
                      />
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })
        )}
      </Card>
    </Screen>
  );
}

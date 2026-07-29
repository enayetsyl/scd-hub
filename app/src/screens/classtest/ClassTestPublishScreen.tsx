/**
 * ClassTestPublishScreen (CT-5 + CT-8 approval gate, tracker:write / roster:manage) —
 * the release surface, role-aware:
 *   • Teacher (tracker:write): SUBMIT the exam for release / RECALL a pending submission.
 *     Submitting does NOT reach guardians.
 *   • Office/Principal (roster:manage): APPROVE & release (→ guardian delivery: wa.me +
 *     in-app), SEND BACK with a reason (→ draft), or UNPUBLISH. Only the admin sends the
 *     wa.me messages (ADR-003 manual send). A re-publish RE-notifies (publishedVersion++).
 * Per-row status: Draft → Pending approval → Published.
 */
import React, { useMemo, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation, type CombinedError } from "urql";
import { STUDENTS_QUERY } from "../../graphql/operations";
import {
  CLASS_TEST_RESULTS_QUERY,
  PUBLISH_CLASS_TEST_EXAM,
  UNPUBLISH_CLASS_TEST_RESULT,
  UNPUBLISH_CLASS_TEST_EXAM,
  SUBMIT_CLASS_TEST_EXAM,
  RECALL_CLASS_TEST_EXAM,
  SEND_BACK_CLASS_TEST_EXAM,
  CLASS_TEST_QUERY,
  type ClassTestPublishOutcomeT,
} from "../../graphql/classTest";
import { Screen, Card, Body, Muted, Button, Badge, Field, Loader, Notice } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { roleHasPermission } from "@scd/shared";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ClassTestStackParamList, "ClassTestPublish">;

export default function ClassTestPublishScreen({ route }: Props): React.ReactElement {
  const { testId, title } = route.params;
  // CT-8 role split: teacher submits; Office/Principal (roster:manage) approve + send WhatsApp.
  const { role } = useAuth();
  const isAdmin = !!role && roleHasPermission(role, "roster:manage");

  const [testQ] = useQuery({ query: CLASS_TEST_QUERY, variables: { id: testId } });
  const test = testQ.data?.classTest ?? null;
  const [studentsQ] = useQuery({ query: STUDENTS_QUERY, variables: { sectionId: test?.sectionId ?? "" }, pause: !test });
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of studentsQ.data?.studentsInSection ?? []) m.set(s.id, s.name);
    return m;
  }, [studentsQ.data]);
  const [resultsQ, refetch] = useQuery({ query: CLASS_TEST_RESULTS_QUERY, variables: { testId }, requestPolicy: "cache-and-network" });
  const results = resultsQ.data?.classTestResults ?? [];

  const [, publishExam] = useMutation(PUBLISH_CLASS_TEST_EXAM);
  const [, unpublishOne] = useMutation(UNPUBLISH_CLASS_TEST_RESULT);
  const [, unpublishExam] = useMutation(UNPUBLISH_CLASS_TEST_EXAM);
  const [, submitExam] = useMutation(SUBMIT_CLASS_TEST_EXAM);
  const [, recallExam] = useMutation(RECALL_CLASS_TEST_EXAM);
  const [, sendBackExam] = useMutation(SEND_BACK_CLASS_TEST_EXAM);

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ClassTestPublishOutcomeT | null>(null);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackReason, setSendBackReason] = useState("");

  const refresh = (): void => refetch({ requestPolicy: "network-only" });

  async function run(fn: () => Promise<{ error?: CombinedError; data?: unknown }>, okMsg: string): Promise<unknown> {
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error));
      return null;
    }
    setOk(okMsg);
    refresh();
    return res.data;
  }

  async function onApprove(): Promise<void> {
    const data = (await run(() => publishExam({ testId }), STR.ctPublishedSummary)) as
      | { publishClassTestExam: ClassTestPublishOutcomeT }
      | null;
    if (data) setOutcome(data.publishClassTestExam);
  }

  async function onSendBack(): Promise<void> {
    const done = await run(() => sendBackExam({ testId, reason: sendBackReason.trim() }), STR.ctSentBack);
    if (done) {
      setSendBackOpen(false);
      setSendBackReason("");
    }
  }

  // Nothing entered yet ⇒ neither submit nor approve can do anything: the server
  // throws "No results entered for this exam". That guard is right, but letting the
  // button be pressed turns a foreseeable empty state into a server error (and, until
  // the observability fix, a GlitchTip alert). Gate it here instead.
  // `resultsQ.fetching` guard: an in-flight first load must not look "empty".
  const hasResults = results.length > 0;
  const resultsUnknown = resultsQ.fetching && results.length === 0;
  const blockEmpty = !hasResults && !resultsUnknown;

  // Exam-level status: any pending (submitted, not published) row?
  const anySubmitted = results.some((r) => r.submittedAt && !r.publishedAt);
  const anyPublished = results.some((r) => !!r.publishedAt);
  const sentBackReason = results.find((r) => r.sendBackReason)?.sendBackReason ?? null;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{title}</Body>

          {isAdmin ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
              <Button title={STR.ctApproveRelease} onPress={onApprove} loading={busy} disabled={busy || blockEmpty} />
              <Button title={STR.ctSendBack} variant="secondary" onPress={() => setSendBackOpen((v) => !v)} disabled={busy} />
              <Button title={STR.ctUnpublishAll} variant="ghost" onPress={() => void run(() => unpublishExam({ testId }), STR.ctUnpublishedBadge)} disabled={busy} />
            </View>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
              <Button title={STR.ctSubmitForRelease} onPress={() => void run(() => submitExam({ testId }), STR.ctSubmittedForApproval)} loading={busy} disabled={busy || blockEmpty} />
              <Button title={STR.ctRecall} variant="ghost" onPress={() => void run(() => recallExam({ testId }), STR.ctRecall)} disabled={busy} />
            </View>
          )}

          {/* Say WHY the action is unavailable — a disabled button with no reason is
              its own support ticket. */}
          {blockEmpty ? <Muted style={{ marginTop: space(2) }}>{STR.ctNoResultsYet}</Muted> : null}

          {/* Admin send-back reason (D-A: reason required) */}
          {isAdmin && sendBackOpen ? (
            <View style={{ marginTop: space(2) }}>
              <Field label={STR.ctSendBackReason} value={sendBackReason} onChangeText={setSendBackReason} />
              <Button title={STR.ctSendBack} onPress={onSendBack} loading={busy} disabled={busy || !sendBackReason.trim()} />
            </View>
          ) : null}

          {/* Exam-level state hints */}
          <View style={{ marginTop: space(2) }}>
            {anyPublished ? <Badge text={STR.ctPublishedBadge} tone="ok" /> : anySubmitted ? <Badge text={STR.ctPendingApproval} tone="brand" /> : <Badge text={STR.ctUnpublishedBadge} tone="muted" />}
          </View>
          {sentBackReason ? <Notice message={`${STR.ctSentBack}: ${sentBackReason}`} tone="warn" /> : null}
        </Card>

        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {outcome ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>
              {STR.ctPublishedSummary}: {bnNum(outcome.recipients.length)} · {STR.ctUnreachable}: {bnNum(outcome.unreachableCount)}
            </Body>
            {!isAdmin ? <Notice message={STR.ctWaAdminOnly} tone="info" /> : null}
            {outcome.recipients.map((r) => (
              <View key={r.studentId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}>
                <View style={{ flexShrink: 1 }}>
                  <Body>{r.studentName}</Body>
                  <Muted>{r.unreachableByWa ? STR.ctUnreachable : ""}</Muted>
                </View>
                {r.waLink && isAdmin ? <Button title={STR.ctOpenWa} variant="secondary" onPress={() => void Linking.openURL(r.waLink as string)} /> : null}
              </View>
            ))}
          </Card>
        ) : null}

        {resultsQ.fetching ? (
          <Loader label={STR.loading} />
        ) : results.length === 0 ? (
          <Card>
            <Muted>{STR.ctNoEntered}</Muted>
          </Card>
        ) : (
          results.map((r) => {
            const published = !!r.publishedAt;
            const pending = !!r.submittedAt && !published;
            return (
              <Card key={r.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{nameById.get(r.studentId) ?? r.studentId}</Body>
                    <Muted>
                      {r.status === "ABSENT" ? STR.ctAbsent : `${bnNum(r.marks ?? 0)}/${bnNum(r.totalMarks)}`}
                      {published ? ` · ${STR.ctPublishedVersion} ${bnNum(r.publishedVersion)}` : ""}
                    </Muted>
                  </View>
                  <Badge
                    text={published ? STR.ctPublishedBadge : pending ? STR.ctPendingApproval : STR.ctUnpublishedBadge}
                    tone={published ? "ok" : pending ? "brand" : "muted"}
                  />
                </View>
                {/* Admin can retract a single released student (per-student override). */}
                {isAdmin && published ? (
                  <View style={{ marginTop: space(2) }}>
                    <Button
                      title={STR.ctUnpublish}
                      variant="ghost"
                      onPress={() => void run(() => unpublishOne({ testId, studentId: r.studentId }), STR.ctUnpublishedBadge)}
                      disabled={busy}
                    />
                  </View>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

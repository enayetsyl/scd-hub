/**
 * ClassTestPublishScreen (CT-5 / J4, tracker:write) — publish results per-student or
 * for the whole exam, with unpublish. Publishing delivers to guardians (wa.me for all +
 * an in-app notification for login-enabled); the returned recipients carry the wa.me
 * links the staff member taps to send (ADR-003 manual send). A re-publish RE-notifies
 * (server bumps publishedVersion). The publish/unpublish mutations ride tracker:write —
 * the Bangla deny surfaces inline.
 */
import React, { useMemo, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation, type CombinedError } from "urql";
import { STUDENTS_QUERY } from "../../graphql/operations";
import {
  CLASS_TEST_RESULTS_QUERY,
  PUBLISH_CLASS_TEST_RESULT,
  PUBLISH_CLASS_TEST_EXAM,
  UNPUBLISH_CLASS_TEST_RESULT,
  UNPUBLISH_CLASS_TEST_EXAM,
  CLASS_TEST_QUERY,
  type ClassTestPublishOutcomeT,
} from "../../graphql/classTest";
import { Screen, Card, Body, Muted, Button, Badge, Loader, Notice } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ClassTestStackParamList, "ClassTestPublish">;

export default function ClassTestPublishScreen({ route }: Props): React.ReactElement {
  const { testId, title } = route.params;
  const [testQ] = useQuery({ query: CLASS_TEST_QUERY, variables: { id: testId } });
  const test = testQ.data?.classTest ?? null;
  const [studentsQ] = useQuery({ query: STUDENTS_QUERY, variables: { sectionId: test?.sectionId ?? "" }, pause: !test });
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of studentsQ.data?.studentsInSection ?? []) m.set(s.id, s.name);
    return m;
  }, [studentsQ.data]);
  const [resultsQ, refetch] = useQuery({ query: CLASS_TEST_RESULTS_QUERY, variables: { testId } });
  const results = resultsQ.data?.classTestResults ?? [];

  const [, publishOne] = useMutation(PUBLISH_CLASS_TEST_RESULT);
  const [, publishExam] = useMutation(PUBLISH_CLASS_TEST_EXAM);
  const [, unpublishOne] = useMutation(UNPUBLISH_CLASS_TEST_RESULT);
  const [, unpublishExam] = useMutation(UNPUBLISH_CLASS_TEST_EXAM);

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ClassTestPublishOutcomeT | null>(null);

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

  async function onPublishExam(): Promise<void> {
    const data = (await run(() => publishExam({ testId }), STR.ctPublishedSummary)) as
      | { publishClassTestExam: ClassTestPublishOutcomeT }
      | null;
    if (data) setOutcome(data.publishClassTestExam);
  }
  async function onPublishOne(studentId: string): Promise<void> {
    const data = (await run(() => publishOne({ testId, studentId }), STR.ctPublishedSummary)) as
      | { publishClassTestResult: ClassTestPublishOutcomeT }
      | null;
    if (data) setOutcome(data.publishClassTestResult);
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{title}</Body>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
            <Button title={STR.ctPublishAll} onPress={onPublishExam} loading={busy} disabled={busy} />
            <Button title={STR.ctUnpublishAll} variant="ghost" onPress={() => void run(() => unpublishExam({ testId }), STR.ctUnpublishedBadge)} disabled={busy} />
          </View>
        </Card>

        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {outcome ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>
              {STR.ctPublishedSummary}: {bnNum(outcome.recipients.length)} · {STR.ctUnreachable}: {bnNum(outcome.unreachableCount)}
            </Body>
            {outcome.recipients.map((r) => (
              <View key={r.studentId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}>
                <View style={{ flexShrink: 1 }}>
                  <Body>{r.studentName}</Body>
                  <Muted>{r.unreachableByWa ? STR.ctUnreachable : ""}</Muted>
                </View>
                {r.waLink ? <Button title={STR.ctOpenWa} variant="secondary" onPress={() => void Linking.openURL(r.waLink as string)} /> : null}
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
                  <Badge text={published ? STR.ctPublishedBadge : STR.ctUnpublishedBadge} tone={published ? "ok" : "muted"} />
                </View>
                <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                  <Button
                    title={published ? STR.ctRepublish : STR.ctPublish}
                    variant="secondary"
                    onPress={() => onPublishOne(r.studentId)}
                    disabled={busy}
                  />
                  {published ? (
                    <Button
                      title={STR.ctUnpublish}
                      variant="ghost"
                      onPress={() => void run(() => unpublishOne({ testId, studentId: r.studentId }), STR.ctUnpublishedBadge)}
                      disabled={busy}
                    />
                  ) : null}
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

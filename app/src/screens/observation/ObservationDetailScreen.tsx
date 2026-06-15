/**
 * ObservationDetailScreen (CO-1..CO-7, observation:read row-scoped) — view an
 * observation's scores + linked footage. Conditionals:
 *   - The observed teacher, when state is REVIEWED, may Respond (respondToClassroomObservation)
 *     and Rate the review fairness/usefulness 1–5 (rateObservationReview, CO-7).
 *   - Principal/Office (observation:upload) may Re-request a re-review
 *     (reRequestClassroomObservation) and attach session footage (recordSessionFootage, CO-2).
 * Every action is re-gated server-side; the Bangla deny surfaces inline.
 */
import React, { useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation, type CombinedError } from "urql";
import { roleHasPermission } from "@scd/shared";
import {
  CLASSROOM_OBSERVATION_QUERY,
  OBSERVATION_RECORDING_QUERY,
  RESPOND_TO_CLASSROOM_OBSERVATION,
  RATE_OBSERVATION_REVIEW,
  RE_REQUEST_CLASSROOM_OBSERVATION,
  RECORD_SESSION_FOOTAGE,
} from "../../graphql/observation";
import { Screen, Card, Body, Muted, Button, Field, Select, Badge, Row, Loader, Notice, Divider } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import {
  STR,
  obsFormLabel,
  hwSubjectLabel,
  obsStateLabel,
  obsDomainLabel,
  obsLevelLabel,
  obsGateLabel,
  obsGateResultLabel,
  obsQuranCriterionLabel,
  obsQuranComplianceLabel,
  obsGrowthProgressLabel,
  bnNum,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { ObservationStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ObservationStackParamList, "ObservationDetail">;

const RATE_OPTS = [1, 2, 3, 4, 5].map((n) => ({ label: String(n), value: String(n) }));
const YT_WATCH = "https://www.youtube.com/watch?v=";

export default function ObservationDetailScreen({ route }: Props): React.ReactElement {
  const { observationId } = route.params;
  const { user, role } = useAuth();
  const canUpload = !!role && roleHasPermission(role, "observation:upload");

  const [obsQ, refetchObs] = useQuery({ query: CLASSROOM_OBSERVATION_QUERY, variables: { id: observationId } });
  const obs = obsQ.data?.classroomObservation ?? null;
  const [recQ, refetchRec] = useQuery({ query: OBSERVATION_RECORDING_QUERY, variables: { observationId } });
  const recording = recQ.data?.observationRecording ?? null;

  const [, respond] = useMutation(RESPOND_TO_CLASSROOM_OBSERVATION);
  const [, rate] = useMutation(RATE_OBSERVATION_REVIEW);
  const [, reRequest] = useMutation(RE_REQUEST_CLASSROOM_OBSERVATION);
  const [, attachFootage] = useMutation(RECORD_SESSION_FOOTAGE);

  const [responseText, setResponseText] = useState("");
  const [fairness, setFairness] = useState<string | null>(null);
  const [usefulness, setUsefulness] = useState<string | null>(null);
  const [reObserverId, setReObserverId] = useState("");
  const [youtubeId, setYoutubeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isObservedTeacher = !!user && obs?.teacherId === user.id;
  const released = obs?.state === "REVIEWED" || obs?.state === "TEACHER_RESPONDED";

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
    refetchObs({ requestPolicy: "network-only" });
    refetchRec({ requestPolicy: "network-only" });
    return res.data;
  }

  if (obsQ.fetching) return <Screen><Loader label={STR.loading} /></Screen>;
  if (!obs) {
    return (
      <Screen>
        <Card>
          <Muted>{obsQ.error ? friendlyError(obsQ.error) : STR.obsNoAccess}</Muted>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700", flexShrink: 1 }}>
              {obsFormLabel(obs.form)} · {hwSubjectLabel(obs.subject)}
            </Body>
            <Badge text={obsStateLabel(obs.state)} tone={obs.state === "SUPERSEDED" ? "muted" : "brand"} />
          </View>
          <Row label={STR.obsTeacher} value={obs.teacherId} />
          {obs.observerId ? <Row label={STR.obsObserver} value={obs.observerId} /> : null}
          <Row label={STR.obsClassDate} value={new Date(obs.classDate).toLocaleDateString()} />
        </Card>

        {/* REF-11 scores */}
        {obs.domains.length > 0 ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsDomainScores}</Body>
            {obs.domains.map((d) => (
              <View key={d.domain} style={{ marginBottom: space(2) }}>
                <Row label={obsDomainLabel(d.domain)} value={`${bnNum(d.level)} · ${obsLevelLabel(d.level)}`} />
                {d.note ? <Muted>{d.note}</Muted> : null}
              </View>
            ))}
            <Divider />
            {obs.gates.map((g) => (
              <View key={g.gate} style={{ marginBottom: space(1) }}>
                <Row label={obsGateLabel(g.gate)} value={obsGateResultLabel(g.result)} />
                {g.breachNote ? <Muted>{g.breachNote}</Muted> : null}
              </View>
            ))}
            {obs.oneStrength ? (
              <>
                <Divider />
                <Row label={STR.obsOneStrength} value={obs.oneStrength} />
              </>
            ) : null}
            {obs.growthFocus ? <Row label={STR.obsGrowthFocus} value={obs.growthFocus} /> : null}
            {obs.priorFocusProgress ? (
              <Row label={STR.obsPriorFocusProgress} value={obsGrowthProgressLabel(obs.priorFocusProgress)} />
            ) : null}
          </Card>
        ) : null}

        {/* Quran scores */}
        {obs.quran ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsQuranRatings}</Body>
            {obs.quran.ratings.map((r) => (
              <View key={r.criterion} style={{ marginBottom: space(1) }}>
                <Row label={obsQuranCriterionLabel(r.criterion)} value={bnNum(r.score)} />
                {r.note ? <Muted>{r.note}</Muted> : null}
              </View>
            ))}
            <Divider />
            {obs.quran.compliance.map((c) => (
              <Row key={c.item} label={obsQuranComplianceLabel(c.item)} value={c.yesNo ? STR.obsYes : STR.obsNo} />
            ))}
            <Divider />
            <Row label={STR.obsQuranStrengths} value={obs.quran.strengths} />
            <Row label={STR.obsQuranImprovements} value={obs.quran.improvements} />
            <Row label={STR.obsQuranSuggestions} value={obs.quran.suggestions} />
          </Card>
        ) : null}

        {/* Footage */}
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsFootage}</Body>
          {recording ? (
            <Button title={STR.obsOpenVideo} variant="secondary" onPress={() => void Linking.openURL(YT_WATCH + recording.youtubeVideoId)} />
          ) : (
            <Muted>{STR.obsNoFootage}</Muted>
          )}
          {canUpload ? (
            <View style={{ marginTop: space(3) }}>
              <Field label={STR.obsYoutubeId} value={youtubeId} onChangeText={setYoutubeId} helper={STR.obsYoutubeIdHint} />
              <Button
                title={STR.obsAttachFootage}
                onPress={() => {
                  if (!youtubeId.trim()) return setError(STR.errGeneric);
                  void run(() => attachFootage({ observationId, youtubeVideoId: youtubeId.trim() }), STR.obsFootageAttached);
                }}
                disabled={busy}
              />
            </View>
          ) : null}
        </Card>

        {/* Observed-teacher: respond + rate review (state REVIEWED) */}
        {isObservedTeacher && released ? (
          <Card>
            {obs.teacherResponse ? (
              <Row label={STR.obsYourResponse} value={obs.teacherResponse} />
            ) : (
              <>
                <Field label={STR.obsResponseText} value={responseText} onChangeText={setResponseText} multiline />
                <Button
                  title={STR.obsRespond}
                  onPress={() => {
                    if (!responseText.trim()) return setError(STR.errGeneric);
                    void run(() => respond({ observationId, responseText: responseText.trim() }), STR.obsResponded);
                  }}
                  disabled={busy}
                />
              </>
            )}
            <Divider />
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsRateReview}</Body>
            <Select label={STR.obsFairness} value={fairness} options={RATE_OPTS} onChange={setFairness} placeholder="1–5" />
            <Select label={STR.obsUsefulness} value={usefulness} options={RATE_OPTS} onChange={setUsefulness} placeholder="1–5" />
            <Button
              title={STR.obsSubmitRating}
              variant="secondary"
              onPress={() => {
                if (!fairness) return setError(STR.errGeneric);
                void run(
                  () =>
                    rate({
                      observationId,
                      fairnessRating: Number(fairness),
                      usefulnessRating: usefulness ? Number(usefulness) : null,
                    }),
                  STR.obsRated,
                );
              }}
              disabled={busy}
            />
          </Card>
        ) : null}

        {/* Principal/Office: re-request a re-review */}
        {canUpload && released ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsReReview}</Body>
            <Field label={STR.obsReReviewObserverId} value={reObserverId} onChangeText={setReObserverId} helper={STR.obsObserverIdHint} />
            <Button
              title={STR.obsReReview}
              variant="ghost"
              onPress={() => {
                if (!reObserverId.trim()) return setError(STR.errGeneric);
                void run(
                  () => reRequest({ priorObservationId: observationId, observerId: reObserverId.trim() }),
                  STR.obsReReviewed,
                );
              }}
              disabled={busy}
            />
          </Card>
        ) : null}
        <View style={{ height: space(6) }} />
      </ScrollView>
    </Screen>
  );
}

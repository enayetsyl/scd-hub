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
import { ScrollView, View } from "react-native";
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
  PUBLISH_CLASSROOM_OBSERVATION,
  REQUEST_CO_REVIEW_OBSERVATION,
  OBSERVATIONS_FOR_RECORDING_QUERY,
} from "../../graphql/observation";
import { TEACHERS_QUERY } from "../../graphql/operations";
// CO-2 footage rider: in-app YouTube-unlisted upload (web GIS). Native → paste-id fallback below.
import {
  isYouTubeUploadSupported,
  authorizeYouTube,
  pickVideoFile,
  uploadVideoFile,
  YouTubeUploadError,
} from "../../lib/youtubeUpload";
import { YouTubeEmbed } from "../../components/YouTubeEmbed";
import { UploadDropZone } from "../../components/UploadDropZone";
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

export default function ObservationDetailScreen({ route, navigation }: Props): React.ReactElement {
  const { observationId } = route.params;
  const { user, role } = useAuth();
  const canUpload = !!role && roleHasPermission(role, "observation:upload");
  const canManage = !!role && roleHasPermission(role, "observation:manage");

  const [obsQ, refetchObs] = useQuery({ query: CLASSROOM_OBSERVATION_QUERY, variables: { id: observationId } });
  const obs = obsQ.data?.classroomObservation ?? null;
  const [recQ, refetchRec] = useQuery({ query: OBSERVATION_RECORDING_QUERY, variables: { observationId } });
  const recording = recQ.data?.observationRecording ?? null;
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY });
  const nameById = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of teachersQ.data?.teachers ?? []) map[t.id] = t.name;
    return map;
  }, [teachersQ.data]);

  const [, respond] = useMutation(RESPOND_TO_CLASSROOM_OBSERVATION);
  const [, rate] = useMutation(RATE_OBSERVATION_REVIEW);
  const [, reRequest] = useMutation(RE_REQUEST_CLASSROOM_OBSERVATION);
  const [, attachFootage] = useMutation(RECORD_SESSION_FOOTAGE);
  const [, publish] = useMutation(PUBLISH_CLASSROOM_OBSERVATION);
  const [, coReview] = useMutation(REQUEST_CO_REVIEW_OBSERVATION);

  // CO-9 co-review group — every observation on this recording (manager oversight).
  const [groupQ, refetchGroup] = useQuery({
    query: OBSERVATIONS_FOR_RECORDING_QUERY,
    variables: { recordingId: obs?.recordingId ?? "" },
    pause: !canUpload || !obs?.recordingId,
  });
  const group = groupQ.data?.classroomObservationsForRecording ?? [];
  const activeReviewers = group.filter((g) => g.state !== "SUPERSEDED");

  const [responseText, setResponseText] = useState("");
  const [coObserverId, setCoObserverId] = useState<string | null>(null);
  const [fairness, setFairness] = useState<string | null>(null);
  const [usefulness, setUsefulness] = useState<string | null>(null);
  const [reObserverId, setReObserverId] = useState<string | null>(null);
  const [youtubeId, setYoutubeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ratingDone, setRatingDone] = useState(false);
  // CO-2 footage rider — in-app YouTube upload (web GIS only; native falls back to paste-id).
  const uploadSupported = isYouTubeUploadSupported();
  const [ytAuthed, setYtAuthed] = useState(false);
  const [uploading, setUploading] = useState(false);

  const isObservedTeacher = !!user && obs?.teacherId === user.id;
  // released = visible to teacher + Principal (includes SUPERSEDED so historical response shows)
  const released = obs?.state === "REVIEWED" || obs?.state === "TEACHER_RESPONDED" || obs?.state === "SUPERSEDED";
  // teacher may only submit a new response while still in REVIEWED (not yet responded, not superseded)
  const canRespond = obs?.state === "REVIEWED";

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

  // CO-2: authorize YouTube (separate gesture from the upload, so the file dialog keeps its user gesture).
  async function onAuthorizeYt(): Promise<void> {
    setError(null);
    setOk(null);
    try {
      await authorizeYouTube();
      setYtAuthed(true);
    } catch (e) {
      setError(e instanceof YouTubeUploadError ? e.message : STR.errGeneric);
    }
  }

  // CO-2: upload a video File (picked OR web-dropped) to YouTube unlisted → attach the returned id.
  async function uploadObservationVideo(file: File): Promise<void> {
    if (!obs) return;
    setError(null);
    setOk(null);
    try {
      setUploading(true);
      const title = `${obsFormLabel(obs.form)} · ${hwSubjectLabel(obs.subject)} · ${obs.classDate}`;
      const { videoId } = await uploadVideoFile(file, { title });
      setUploading(false);
      await run(() => attachFootage({ observationId, youtubeVideoId: videoId }), STR.obsFootageAttached);
    } catch (e) {
      setUploading(false);
      setError(e instanceof YouTubeUploadError ? e.message : STR.errGeneric);
    }
  }

  // CO-2: pick a video file, then the shared upload path above.
  async function onUploadVideo(): Promise<void> {
    const file = await pickVideoFile();
    if (file) await uploadObservationVideo(file);
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
          <Row label={STR.obsTeacher} value={nameById[obs.teacherId] ?? obs.teacherId} />
          {canUpload && obs.observerId ? (
            <Row label={STR.obsObserver} value={nameById[obs.observerId] ?? obs.observerId} />
          ) : null}
          <Row label={STR.obsClassDate} value={new Date(obs.classDate).toLocaleDateString()} />
        </Card>

        {/* CO-8 (D-#271): Principal/Office publish gate — REVIEWED is not visible to the
            teacher until published. Show status + a Publish action to managers. */}
        {canManage && (obs.state === "REVIEWED" || obs.publishedAt) ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsPublishTitle}</Body>
            {obs.publishedAt ? (
              <Row label={STR.obsPublishedOn} value={new Date(obs.publishedAt).toLocaleString()} />
            ) : (
              <>
                <Muted style={{ marginBottom: space(2) }}>{STR.obsPublishHint}</Muted>
                <Button
                  title={STR.obsPublish}
                  onPress={() => void run(() => publish({ observationId }), STR.obsPublished)}
                  disabled={busy}
                />
              </>
            )}
          </Card>
        ) : null}

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
            <YouTubeEmbed videoId={recording.youtubeVideoId} />
          ) : (
            <Muted>{STR.obsNoFootage}</Muted>
          )}
          {canUpload ? (
            <View style={{ marginTop: space(3) }}>
              {uploadSupported ? (
                <View style={{ marginBottom: space(3) }}>
                  {/* Web drop → same YouTube upload path as the pick button; one video
                      per drop. Inactive until authorized (mirrors the button swap). */}
                  <UploadDropZone
                    onFiles={(files) => void uploadObservationVideo(files[0])}
                    disabled={busy || uploading || !ytAuthed}
                  >
                    {!ytAuthed ? (
                      <Button title={STR.obsAuthorizeYt} variant="secondary" onPress={onAuthorizeYt} disabled={busy || uploading} />
                    ) : (
                      <Button
                        title={uploading ? STR.obsUploadingVideo : STR.obsUploadVideo}
                        onPress={onUploadVideo}
                        loading={uploading}
                        disabled={busy || uploading}
                      />
                    )}
                  </UploadDropZone>
                  <Muted style={{ marginTop: space(1) }}>{STR.obsUploadVideoHint}</Muted>
                </View>
              ) : null}
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

        {/* Principal/Office: teacher response + rating — always visible once observation is released */}
        {canUpload && released ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsTeacherResponseLabel}</Body>
            {obs.teacherResponse ? (
              <Body>{obs.teacherResponse}</Body>
            ) : (
              <Muted>{STR.obsAwaitingResponse}</Muted>
            )}
            {obs.fairnessRating != null ? (
              <>
                <Divider />
                <Row label={STR.obsFairness} value={`${obs.fairnessRating}/5`} />
                {obs.usefulnessRating != null ? (
                  <Row label={STR.obsUsefulness} value={`${obs.usefulnessRating}/5`} />
                ) : null}
              </>
            ) : null}
          </Card>
        ) : null}

        {/* Observed-teacher: write response + rate review */}
        {isObservedTeacher && released ? (
          <Card>
            {obs.teacherResponse ? (
              <Row label={STR.obsYourResponse} value={obs.teacherResponse} />
            ) : canRespond ? (
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
            ) : null}
            <Divider />
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsRateReview}</Body>
            {ratingDone || obs.hasFairnessRating ? (
              <Muted>
                {ratingDone
                  ? `${STR.obsRated} — ${STR.obsFairness}: ${fairness}/5${usefulness ? `, ${STR.obsUsefulness}: ${usefulness}/5` : ""}`
                  : STR.obsRatingAlreadySubmitted}
              </Muted>
            ) : (
              <>
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
                        }).then((res) => { if (!res.error) setRatingDone(true); return res; }),
                      STR.obsRated,
                    );
                  }}
                  disabled={busy}
                />
              </>
            )}
          </Card>
        ) : null}

        {/* Principal/Office: re-request a re-review — observer dropdown excludes observed teacher */}
        {canUpload && released ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsReReview}</Body>
            <Select
              label={STR.obsReReviewObserverId}
              value={reObserverId}
              options={(teachersQ.data?.teachers ?? [])
                .filter((t) => t.id !== obs.teacherId)
                .map((t) => ({ label: t.name, value: t.id }))}
              onChange={setReObserverId}
              placeholder={STR.obsPickObserver}
              searchable
            />
            <Button
              title={STR.obsReReview}
              variant="ghost"
              onPress={() => {
                if (!reObserverId) return setError(STR.errGeneric);
                void run(
                  () => reRequest({ priorObservationId: observationId, observerId: reObserverId }),
                  STR.obsReReviewed,
                );
              }}
              disabled={busy}
            />
          </Card>
        ) : null}
        {/* CO-9 (D-#272): Principal/Office add a PARALLEL co-reviewer to this recording +
            open the side-by-side compare when >1 reviewer exists. */}
        {canUpload && obs.recordingId ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsCoReviewTitle}</Body>
            <Muted style={{ marginBottom: space(2) }}>{STR.obsCoReviewHint}</Muted>
            {activeReviewers.length > 1 ? (
              <Button
                title={`${STR.obsCompareTitle} (${bnNum(activeReviewers.length)})`}
                variant="secondary"
                onPress={() => navigation.navigate("CompareObservations", { recordingId: obs.recordingId as string })}
                style={{ marginBottom: space(2) }}
              />
            ) : null}
            <Select
              label={STR.obsCoReviewObserver}
              value={coObserverId}
              options={(teachersQ.data?.teachers ?? [])
                .filter((t) => t.id !== obs.teacherId && !activeReviewers.some((g) => g.observerId === t.id))
                .map((t) => ({ label: t.name, value: t.id }))}
              onChange={setCoObserverId}
              placeholder={STR.obsPickObserver}
              searchable
            />
            <Button
              title={STR.obsAddCoReviewer}
              variant="ghost"
              onPress={() => {
                if (!coObserverId) return setError(STR.errGeneric);
                void run(
                  () =>
                    coReview({ sourceObservationId: observationId, observerId: coObserverId }).then((res) => {
                      if (!res.error) {
                        setCoObserverId(null);
                        refetchGroup({ requestPolicy: "network-only" });
                      }
                      return res;
                    }),
                  STR.obsCoReviewAdded,
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

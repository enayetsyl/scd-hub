/**
 * ReviewObservationScreen (CO-1 / CO-5, observation:review AND being the assigned
 * observer) — the assigned observer scores + comments. The row's `form` decides the
 * payload:
 *   REF-11: 5 domain levels (1–4) + notes, 2 gate results (PASS/BREACH) + breach notes,
 *           one strength, a growth focus, and — ONLY when the teacher has an earlier
 *           observation (CO-10, D-#363) — the carry-forward pair: prior-focus progress
 *           plus a free-text note on how it moved. The prior focus itself is quoted in
 *           a card above the form (`observationPriorFocusContext`), so the observer is
 *           never asked to recall it across a sitting of several teachers. Last, the
 *           CO-16 (D-#503) optional `overallSuggestion` — a domain-free idea for the
 *           class, deliberately outside the scored block.
 *   QURAN (ClassEcho): 8 ratings (1–5) + 7 yes/no compliance items + strengths /
 *           improvements / suggestions.
 * reviewClassroomObservation → REVIEWED, released to the observed teacher (no Principal
 * sign-off). The server validates the right payload per the row's form + gates the
 * caller to the assigned observerId — the Bangla deny surfaces inline.
 */
import React, { useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  OBSERVATION_DOMAINS,
  OBSERVATION_LEVELS,
  OBSERVATION_GATES,
  GATE_RESULTS,
  GROWTH_PROGRESS,
  QURAN_REVIEW_CRITERIA,
  QURAN_COMPLIANCE_ITEMS,
} from "@scd/shared";
import {
  REVIEW_CLASSROOM_OBSERVATION,
  OBSERVATION_RECORDING_QUERY,
  OBSERVATION_PRIOR_FOCUS_CONTEXT_QUERY,
} from "../../graphql/observation";
import { YouTubeEmbed } from "../../components/YouTubeEmbed";
import { Screen, Card, Body, Muted, Button, Badge, Field, Select, Chip, Notice } from "../../components/ui";
import {
  STR,
  obsDomainLabel,
  obsLevelLabel,
  obsGateLabel,
  obsGateResultLabel,
  obsGrowthProgressLabel,
  obsQuranCriterionLabel,
  obsQuranComplianceLabel,
  hwSubjectLabel,
  isoDateLabel,
  isoDateTimeLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useFormDraft } from "../../lib/useFormDraft";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme/tokens";
import type { ObservationStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ObservationStackParamList, "ReviewObservation">;

const LEVEL_OPTS = (OBSERVATION_LEVELS as readonly number[]).map((l) => ({ label: obsLevelLabel(l), value: String(l) }));
const SCORE_OPTS = [1, 2, 3, 4, 5].map((s) => ({ label: String(s), value: String(s) }));
const GATE_RESULT_OPTS = (GATE_RESULTS as readonly string[]).map((r) => ({ label: obsGateResultLabel(r), value: r }));
const GROWTH_OPTS = (GROWTH_PROGRESS as readonly string[]).map((g) => ({ label: obsGrowthProgressLabel(g), value: g }));

export default function ReviewObservationScreen({ route }: Props): React.ReactElement {
  const nav = useNavigation<Props["navigation"]>();
  const { observationId, form, title } = route.params;
  const isQuran = form === "QURAN";

  // REF-11 state
  const [domainLevels, setDomainLevels] = useState<Record<string, string | null>>({});
  const [domainNotes, setDomainNotes] = useState<Record<string, string>>({});
  const [gateResults, setGateResults] = useState<Record<string, string | null>>({});
  const [breachNotes, setBreachNotes] = useState<Record<string, string>>({});
  const [oneStrength, setOneStrength] = useState("");
  const [growthFocus, setGrowthFocus] = useState("");
  const [priorFocusProgress, setPriorFocusProgress] = useState<string | null>(null);
  const [priorFocusNote, setPriorFocusNote] = useState("");
  const [overallSuggestion, setOverallSuggestion] = useState("");

  // Quran state
  const [quranScores, setQuranScores] = useState<Record<string, string | null>>({});
  const [quranNotes, setQuranNotes] = useState<Record<string, string>>({});
  const [compliance, setCompliance] = useState<Record<string, boolean>>({});
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [suggestions, setSuggestions] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, review] = useMutation(REVIEW_CLASSROOM_OBSERVATION);

  // ---- local draft autosave (owner ask 2026-08-03) -------------------------
  // A review is a lot of typing and it is only ever sent on submit, so a dropped
  // connection or a page reload used to lose all of it. Everything the observer
  // enters is mirrored to this device, restored on the way back in, and dropped
  // once the review is actually submitted. LOCAL only — never a server write; a
  // half-finished review must not become a record other people can see.
  const { user } = useAuth();
  const draftSnapshot = useMemo(
    () => ({
      domainLevels,
      domainNotes,
      gateResults,
      breachNotes,
      oneStrength,
      growthFocus,
      priorFocusProgress,
      priorFocusNote,
      overallSuggestion,
      quranScores,
      quranNotes,
      compliance,
      strengths,
      improvements,
      suggestions,
    }),
    [
      domainLevels,
      domainNotes,
      gateResults,
      breachNotes,
      oneStrength,
      growthFocus,
      priorFocusProgress,
      priorFocusNote,
      overallSuggestion,
      quranScores,
      quranNotes,
      compliance,
      strengths,
      improvements,
      suggestions,
    ],
  );
  const applyDraft = useCallback((d: typeof draftSnapshot) => {
    setDomainLevels(d.domainLevels ?? {});
    setDomainNotes(d.domainNotes ?? {});
    setGateResults(d.gateResults ?? {});
    setBreachNotes(d.breachNotes ?? {});
    setOneStrength(d.oneStrength ?? "");
    setGrowthFocus(d.growthFocus ?? "");
    setPriorFocusProgress(d.priorFocusProgress ?? null);
    setPriorFocusNote(d.priorFocusNote ?? "");
    setOverallSuggestion(d.overallSuggestion ?? "");
    setQuranScores(d.quranScores ?? {});
    setQuranNotes(d.quranNotes ?? {});
    setCompliance(d.compliance ?? {});
    setStrengths(d.strengths ?? "");
    setImprovements(d.improvements ?? "");
    setSuggestions(d.suggestions ?? "");
  }, []);
  // Keyed by observation AND user: a shared device must not show one observer the
  // other's unfinished words.
  const draft = useFormDraft(
    user ? `obs-review:${observationId}:${user.id}` : null,
    draftSnapshot,
    applyDraft,
  );

  const [recQ] = useQuery({ query: OBSERVATION_RECORDING_QUERY, variables: { observationId } });
  const recording = recQ.data?.observationRecording ?? null;

  // CO-10 (D-#363): the growth focus this review carries forward. Null for a first-ever
  // observation — and then the carry-forward fields are not rendered at all, rather than
  // asking the observer to judge progress against nothing. Quran rows never have one.
  const [priorQ] = useQuery({
    query: OBSERVATION_PRIOR_FOCUS_CONTEXT_QUERY,
    variables: { observationId },
    pause: isQuran,
  });
  const prior = priorQ.data?.observationPriorFocusContext ?? null;

  async function onSubmit(): Promise<void> {
    setError(null);
    setOk(null);
    setBusy(true);
    let res;
    if (isQuran) {
      const ratings = (QURAN_REVIEW_CRITERIA as readonly string[]).map((c) => ({
        criterion: c,
        score: Number(quranScores[c] ?? 0),
        note: quranNotes[c]?.trim() || null,
      }));
      if (ratings.some((r) => !r.score)) {
        setBusy(false);
        return setError(STR.errGeneric);
      }
      res = await review({
        observationId,
        quran: {
          ratings,
          compliance: (QURAN_COMPLIANCE_ITEMS as readonly string[]).map((i) => ({ item: i, yesNo: !!compliance[i] })),
          strengths: strengths.trim(),
          improvements: improvements.trim(),
          suggestions: suggestions.trim(),
        },
      });
    } else {
      const domains = (OBSERVATION_DOMAINS as readonly string[]).map((d) => ({
        domain: d,
        level: Number(domainLevels[d] ?? 0),
        note: domainNotes[d]?.trim() ?? "",
      }));
      if (domains.some((d) => !d.level)) {
        setBusy(false);
        return setError(STR.errGeneric);
      }
      const gates = (OBSERVATION_GATES as readonly string[]).map((g) => ({
        gate: g,
        result: gateResults[g] ?? "",
        breachNote: breachNotes[g]?.trim() || null,
      }));
      if (gates.some((g) => !g.result)) {
        setBusy(false);
        return setError(STR.errGeneric);
      }
      res = await review({
        observationId,
        domains,
        gates,
        oneStrength: oneStrength.trim(),
        growthFocus: growthFocus.trim(),
        // Carry-forward is only meaningful against a prior focus (CO-10) — with no
        // prior the fields are hidden, so never send stale state.
        priorFocusProgress: prior ? priorFocusProgress ?? null : null,
        priorFocusNote: prior ? priorFocusNote.trim() || null : null,
        // CO-16: never required — an empty box is sent as null, not "".
        overallSuggestion: overallSuggestion.trim() || null,
      });
    }
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    if (res.data) {
      // Submitted for real — drop the local draft, or coming back here would restore
      // a draft of something already sent.
      draft.clear();
      setOk(STR.obsReviewSaved);
      nav.navigate("ObservationDetail", { observationId, title });
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}
        <Card>
          <Body style={{ fontWeight: "700" }}>{title}</Body>
          {recording ? (
            <YouTubeEmbed videoId={recording.youtubeVideoId} />
          ) : (
            <Muted style={{ marginTop: space(1) }}>{STR.obsNoFootage}</Muted>
          )}
        </Card>

        {isQuran ? (
          <>
            <Card>
              <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsQuranRatings}</Body>
              {(QURAN_REVIEW_CRITERIA as readonly string[]).map((c) => (
                <View key={c} style={{ marginBottom: space(2) }}>
                  <Select
                    label={obsQuranCriterionLabel(c)}
                    value={quranScores[c] ?? null}
                    options={SCORE_OPTS}
                    onChange={(v) => setQuranScores((s) => ({ ...s, [c]: v }))}
                    placeholder="1–5"
                  />
                  <Field
                    label={STR.obsDomainNote}
                    value={quranNotes[c] ?? ""}
                    onChangeText={(v) => setQuranNotes((n) => ({ ...n, [c]: v }))}
                  />
                </View>
              ))}
            </Card>
            <Card>
              <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsQuranCompliance}</Body>
              {(QURAN_COMPLIANCE_ITEMS as readonly string[]).map((i) => (
                <View key={i} style={{ marginBottom: space(2) }}>
                  <Body>{obsQuranComplianceLabel(i)}</Body>
                  <View style={{ flexDirection: "row", gap: space(2), marginTop: space(1) }}>
                    <Chip label={STR.obsYes} selected={compliance[i] === true} onPress={() => setCompliance((c) => ({ ...c, [i]: true }))} />
                    <Chip label={STR.obsNo} selected={compliance[i] === false} onPress={() => setCompliance((c) => ({ ...c, [i]: false }))} />
                  </View>
                </View>
              ))}
            </Card>
            <Card>
              <Field label={STR.obsQuranStrengths} value={strengths} onChangeText={setStrengths} multiline />
              <Field label={STR.obsQuranImprovements} value={improvements} onChangeText={setImprovements} multiline />
              <Field label={STR.obsQuranSuggestions} value={suggestions} onChangeText={setSuggestions} multiline />
            </Card>
          </>
        ) : (
          <>
            {/* CO-10 (D-#363): the prior growth focus, quoted — the observer answers the
                progress question from the screen, not from memory. */}
            {prior ? (
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <Body style={{ fontWeight: "700", flexShrink: 1 }}>{STR.obsPriorFocusCard}</Body>
                  {prior.isReReview ? (
                    <Badge text={STR.obsPriorFocusReReview} tone="brand" />
                  ) : !prior.sameSubject ? (
                    <Badge text={STR.obsPriorFocusOtherSubject} tone="muted" />
                  ) : null}
                </View>
                <Muted style={{ marginTop: space(1) }}>
                  {isoDateLabel(prior.classDate)} · {hwSubjectLabel(prior.subject)}
                </Muted>
                {prior.growthFocus ? (
                  <Body style={{ marginTop: space(2), fontStyle: "italic" }}>“{prior.growthFocus}”</Body>
                ) : null}
                {prior.oneStrength ? (
                  <Muted style={{ marginTop: space(1) }}>
                    {STR.obsOneStrength}: {prior.oneStrength}
                  </Muted>
                ) : null}
                {prior.priorFocusProgress ? (
                  <Muted style={{ marginTop: space(1) }}>
                    {STR.obsPriorFocusPrevVerdict}: {obsGrowthProgressLabel(prior.priorFocusProgress)}
                  </Muted>
                ) : null}
              </Card>
            ) : null}

            <Card>
              <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsDomainScores}</Body>
              {(OBSERVATION_DOMAINS as readonly string[]).map((d) => (
                <View key={d} style={{ marginBottom: space(2) }}>
                  <Select
                    label={obsDomainLabel(d)}
                    value={domainLevels[d] ?? null}
                    options={LEVEL_OPTS}
                    onChange={(v) => setDomainLevels((s) => ({ ...s, [d]: v }))}
                    placeholder="1–4"
                  />
                  <Field
                    label={STR.obsDomainNote}
                    value={domainNotes[d] ?? ""}
                    onChangeText={(v) => setDomainNotes((n) => ({ ...n, [d]: v }))}
                  />
                </View>
              ))}
            </Card>
            <Card>
              <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsGates}</Body>
              {(OBSERVATION_GATES as readonly string[]).map((g) => (
                <View key={g} style={{ marginBottom: space(2) }}>
                  <Select
                    label={obsGateLabel(g)}
                    value={gateResults[g] ?? null}
                    options={GATE_RESULT_OPTS}
                    onChange={(v) => setGateResults((s) => ({ ...s, [g]: v }))}
                    placeholder={STR.obsGates}
                  />
                  {gateResults[g] === "BREACH" ? (
                    <Field
                      label={STR.obsBreachNote}
                      value={breachNotes[g] ?? ""}
                      onChangeText={(v) => setBreachNotes((n) => ({ ...n, [g]: v }))}
                    />
                  ) : null}
                </View>
              ))}
            </Card>
            <Card>
              <Field label={STR.obsOneStrength} value={oneStrength} onChangeText={setOneStrength} multiline />
              <Field label={STR.obsGrowthFocus} value={growthFocus} onChangeText={setGrowthFocus} multiline />
              {/* No prior focus ⇒ no progress question. Rendering the select anyway (as
                  it did before CO-10) invites an answer that means nothing. */}
              {prior ? (
                <>
                  <Select
                    label={STR.obsPriorFocusProgress}
                    value={priorFocusProgress}
                    options={GROWTH_OPTS}
                    onChange={setPriorFocusProgress}
                    placeholder={STR.obsPriorFocusProgress}
                  />
                  <Field
                    label={STR.obsPriorFocusNote}
                    value={priorFocusNote}
                    onChangeText={setPriorFocusNote}
                    multiline
                  />
                </>
              ) : (
                <Muted style={{ marginTop: space(1) }}>{STR.obsPriorFocusNone}</Muted>
              )}
            </Card>

            {/* CO-16 (D-#503): the domain-free box. Its own card, AFTER the scored part,
                so a practical idea for the class ("channel the energy into pair work")
                is written as a suggestion — not squeezed into a domain note, where it
                would read as that domain's weakness. Optional by design. */}
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.obsOverallSuggestion}</Body>
              <Muted style={{ marginTop: space(1), marginBottom: space(2) }}>{STR.obsOverallSuggestionHelp}</Muted>
              <Field
                label={STR.obsOverallSuggestionLabel}
                value={overallSuggestion}
                onChangeText={setOverallSuggestion}
                multiline
              />
            </Card>
          </>
        )}

        {/* Draft state, right above the one button that clears it. */}
        {draft.restored ? (
          <Notice message={STR.obsDraftRestored} tone="info" />
        ) : null}
        <View
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2), marginBottom: space(2) }}
        >
          <Muted style={{ flexShrink: 1 }}>
            {draft.savedAt
              ? `${STR.obsDraftSaved} · ${isoDateTimeLabel(new Date(draft.savedAt).toISOString())}`
              : STR.obsDraftNote}
          </Muted>
          {draft.savedAt ? (
            // Clears the STORED copy only — never what is on screen, so a stray tap
            // cannot destroy work the observer can see.
            <Button title={STR.obsDraftDiscard} variant="ghost" onPress={draft.clear} disabled={busy} />
          ) : null}
        </View>

        <Button title={STR.obsSubmitReview} onPress={onSubmit} loading={busy} disabled={busy} />
        <View style={{ height: space(6) }} />
      </ScrollView>
    </Screen>
  );
}

/**
 * ReviewObservationScreen (CO-1 / CO-5, observation:review AND being the assigned
 * observer) — the assigned observer scores + comments. The row's `form` decides the
 * payload:
 *   REF-11: 5 domain levels (1–4) + notes, 2 gate results (PASS/BREACH) + breach notes,
 *           one strength, a growth focus, optional prior-focus-progress.
 *   QURAN (ClassEcho): 8 ratings (1–5) + 7 yes/no compliance items + strengths /
 *           improvements / suggestions.
 * reviewClassroomObservation → REVIEWED, released to the observed teacher (no Principal
 * sign-off). The server validates the right payload per the row's form + gates the
 * caller to the assigned observerId — the Bangla deny surfaces inline.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation } from "urql";
import {
  OBSERVATION_DOMAINS,
  OBSERVATION_LEVELS,
  OBSERVATION_GATES,
  GATE_RESULTS,
  GROWTH_PROGRESS,
  QURAN_REVIEW_CRITERIA,
  QURAN_COMPLIANCE_ITEMS,
} from "@scd/shared";
import { REVIEW_CLASSROOM_OBSERVATION } from "../../graphql/observation";
import { Screen, Card, Body, Muted, Button, Field, Select, Chip, Notice } from "../../components/ui";
import {
  STR,
  obsDomainLabel,
  obsLevelLabel,
  obsGateLabel,
  obsGateResultLabel,
  obsGrowthProgressLabel,
  obsQuranCriterionLabel,
  obsQuranComplianceLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
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
        priorFocusProgress: priorFocusProgress ?? null,
      });
    }
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    if (res.data) {
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
              <Select
                label={STR.obsPriorFocusProgress}
                value={priorFocusProgress}
                options={GROWTH_OPTS}
                onChange={setPriorFocusProgress}
                placeholder={STR.obsPriorFocusProgress}
              />
            </Card>
          </>
        )}

        <Button title={STR.obsSubmitReview} onPress={onSubmit} loading={busy} disabled={busy} />
        <View style={{ height: space(6) }} />
      </ScrollView>
    </Screen>
  );
}

/**
 * CompareObservationsScreen (CO-9, D-#272) — Principal/Office side-by-side compare of
 * every observer's review of ONE recording (the co-review group). REF-11 rows get a
 * domain×reviewer grid with a within-one-level divergence highlight (REF-11 §1.2);
 * Quran rows get the same over their rating criteria. Each reviewer column shows state
 * + a per-row Publish action (CO-8) and opens the full observation on tap.
 * SUPERSEDED (re-reviewed) rows are excluded. Requires observation:upload.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { OBSERVATION_DOMAINS, OBSERVATION_GATES } from "@scd/shared";
import {
  OBSERVATIONS_FOR_RECORDING_QUERY,
  PUBLISH_CLASSROOM_OBSERVATION,
  type ClassroomObservationT,
} from "../../graphql/observation";
import { TEACHERS_QUERY } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Badge, Loader, EmptyState, Divider, Row } from "../../components/ui";
import {
  STR,
  obsStateLabel,
  obsDomainLabel,
  obsLevelLabel,
  obsGateLabel,
  obsGateResultLabel,
  obsQuranCriterionLabel,
  bnNum,
} from "../../lib/labels";
import { space, useColors } from "../../theme";
import type { ObservationStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ObservationStackParamList, "CompareObservations">;

const LABEL_W = 132;
const CELL_W = 88;

/** True when the reviewers' levels for one row differ by MORE than one (REF-11 §1.2). */
function isDivergent(levels: number[]): boolean {
  if (levels.length < 2) return false;
  return Math.max(...levels) - Math.min(...levels) > 1;
}

interface CmpRow {
  key: string;
  label: string;
  /** One cell per reviewer (index-aligned); null = that reviewer has no score here. */
  cells: (number | null)[];
  divergent: boolean;
}

export default function CompareObservationsScreen({ route, navigation }: Props): React.ReactElement {
  const { recordingId } = route.params;
  const colors = useColors();

  const [obsQ, refetch] = useQuery({ query: OBSERVATIONS_FOR_RECORDING_QUERY, variables: { recordingId } });
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY });
  const [, publish] = useMutation(PUBLISH_CLASSROOM_OBSERVATION);

  const nameById = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of teachersQ.data?.teachers ?? []) m[t.id] = t.name;
    return m;
  }, [teachersQ.data]);

  // The co-review group = every non-superseded row on this recording, oldest first.
  const reviewers: ClassroomObservationT[] = (obsQ.data?.classroomObservationsForRecording ?? []).filter(
    (o) => o.state !== "SUPERSEDED",
  );

  async function onPublish(id: string): Promise<void> {
    await publish({ observationId: id });
    refetch({ requestPolicy: "network-only" });
  }

  // Build the comparison rows. REF-11 → domains (+gates); Quran → rating criteria.
  const isQuran = reviewers.some((r) => r.quran) && reviewers.every((r) => r.domains.length === 0);
  const domainRows: CmpRow[] = OBSERVATION_DOMAINS.map((d) => {
    const cells = reviewers.map((r) => r.domains.find((x) => x.domain === d)?.level ?? null);
    const present = cells.filter((c): c is number => c !== null);
    return { key: d, label: obsDomainLabel(d), cells, divergent: isDivergent(present) };
  });
  const quranCriteria = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of reviewers) for (const rt of r.quran?.ratings ?? []) set.add(rt.criterion);
    return [...set];
  }, [reviewers]);
  const quranRows: CmpRow[] = quranCriteria.map((c) => {
    const cells = reviewers.map((r) => r.quran?.ratings.find((x) => x.criterion === c)?.score ?? null);
    const present = cells.filter((v): v is number => v !== null);
    return { key: c, label: obsQuranCriterionLabel(c), cells, divergent: isDivergent(present) };
  });
  const rows = isQuran ? quranRows : domainRows;
  const divergentCount = rows.filter((r) => r.divergent).length;

  if (obsQ.fetching) return <Screen><Loader label={STR.loading} /></Screen>;
  if (reviewers.length === 0) {
    return (
      <Screen>
        <EmptyState message={STR.obsCompareEmpty} />
      </Screen>
    );
  }

  const cellStyle = { width: CELL_W, paddingVertical: space(1), paddingHorizontal: space(1), alignItems: "center" as const };
  const labelCellStyle = { width: LABEL_W, paddingVertical: space(1), paddingRight: space(2), justifyContent: "center" as const };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.obsCompareTitle}</Body>
          <Muted>
            {bnNum(reviewers.length)} {STR.obsCompareReviewers}
            {divergentCount > 0 ? ` · ${bnNum(divergentCount)} ${STR.obsCompareDivergent}` : ` · ${STR.obsCompareAligned}`}
          </Muted>
        </Card>

        {/* Reviewer column headers: name, state, publish/open */}
        <Card>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={{ flexDirection: "row" }}>
                <View style={labelCellStyle} />
                {reviewers.map((r) => (
                  <View key={r.id} style={cellStyle}>
                    <Body style={{ fontWeight: "700", fontSize: 12, textAlign: "center" }}>
                      {r.observerId ? (nameById[r.observerId] ?? r.observerId) : "—"}
                    </Body>
                    <Badge
                      text={r.publishedAt ? STR.obsPublished : obsStateLabel(r.state)}
                      tone={r.publishedAt ? "ok" : r.state === "REVIEWED" ? "brand" : "muted"}
                    />
                  </View>
                ))}
              </View>

              {/* Score rows */}
              {rows.map((row) => (
                <View
                  key={row.key}
                  style={{
                    flexDirection: "row",
                    backgroundColor: row.divergent ? colors.warningContainer : "transparent",
                    borderRadius: 6,
                  }}
                >
                  <View style={labelCellStyle}>
                    <Muted style={{ fontSize: 12 }}>
                      {row.divergent ? "⚠ " : ""}
                      {row.label}
                    </Muted>
                  </View>
                  {row.cells.map((c, i) => (
                    <View key={reviewers[i].id} style={cellStyle}>
                      <Body style={{ fontWeight: row.divergent ? "700" : "400" }}>{c === null ? "—" : bnNum(c)}</Body>
                    </View>
                  ))}
                </View>
              ))}

              {/* REF-11 gate rows (pass/breach) */}
              {!isQuran
                ? OBSERVATION_GATES.map((g) => (
                    <View key={g} style={{ flexDirection: "row" }}>
                      <View style={labelCellStyle}>
                        <Muted style={{ fontSize: 12 }}>{obsGateLabel(g)}</Muted>
                      </View>
                      {reviewers.map((r) => {
                        const res = r.gates.find((x) => x.gate === g)?.result ?? null;
                        return (
                          <View key={r.id} style={cellStyle}>
                            <Muted style={{ fontSize: 11, textAlign: "center", color: res === "BREACH" ? colors.error : colors.textSecondary }}>
                              {res ? obsGateResultLabel(res) : "—"}
                            </Muted>
                          </View>
                        );
                      })}
                    </View>
                  ))
                : null}
            </View>
          </ScrollView>
          {!isQuran ? <Muted style={{ marginTop: space(2), fontSize: 11 }}>{STR.obsCompareLevelHint}</Muted> : null}
        </Card>

        {/* Per-reviewer comments + actions: publish (CO-8) + open the full review */}
        {reviewers.map((r) => {
          const domainNotes = r.domains.filter((d) => d.note);
          const breaches = r.gates.filter((g) => g.result === "BREACH" && g.breachNote);
          return (
            <Card key={r.id}>
              <Body style={{ fontWeight: "700" }}>{r.observerId ? (nameById[r.observerId] ?? r.observerId) : "—"}</Body>
              <Muted style={{ marginBottom: space(1) }}>{r.publishedAt ? STR.obsPublished : obsStateLabel(r.state)}</Muted>

              {/* REF-11 qualitative comments */}
              {r.oneStrength ? <Row label={STR.obsOneStrength} value={r.oneStrength} /> : null}
              {r.growthFocus ? <Row label={STR.obsGrowthFocus} value={r.growthFocus} /> : null}
              {/* CO-16 (D-#503): domain-free suggestion, per reviewer. */}
              {r.overallSuggestion ? <Row label={STR.obsOverallSuggestion} value={r.overallSuggestion} /> : null}
              {domainNotes.length > 0 ? (
                <>
                  <Muted style={{ fontWeight: "700", marginTop: space(1) }}>{STR.obsDomainNotes}</Muted>
                  {domainNotes.map((d) => (
                    <Muted key={d.domain}>
                      • {obsDomainLabel(d.domain)}: {d.note}
                    </Muted>
                  ))}
                </>
              ) : null}
              {breaches.map((g) => (
                <Muted key={g.gate} style={{ color: colors.error, marginTop: space(1) }}>
                  ⚠ {obsGateLabel(g.gate)}: {g.breachNote}
                </Muted>
              ))}

              {/* Quran narrative */}
              {r.quran ? (
                <>
                  <Row label={STR.obsQuranStrengths} value={r.quran.strengths} />
                  <Row label={STR.obsQuranImprovements} value={r.quran.improvements} />
                  <Row label={STR.obsQuranSuggestions} value={r.quran.suggestions} />
                </>
              ) : null}

              <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                <Button
                  title={STR.obsDetailTitle}
                  variant="secondary"
                  onPress={() => navigation.navigate("ObservationDetail", { observationId: r.id })}
                />
                {r.state === "REVIEWED" && !r.publishedAt ? (
                  <Button title={STR.obsPublish} onPress={() => void onPublish(r.id)} />
                ) : null}
              </View>
            </Card>
          );
        })}
        <Divider />
        <Muted style={{ fontSize: 11 }}>{STR.obsCompareSupersededNote}</Muted>
      </ScrollView>
    </Screen>
  );
}

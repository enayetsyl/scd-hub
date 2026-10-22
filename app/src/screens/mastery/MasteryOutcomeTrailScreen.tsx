/**
 * MasteryOutcomeTrailScreen (M-3, mock I2) — one student × outcome: the state with its date, the
 * numbers behind it, the state path, % per attempt, every evidence row (excluded ones marked,
 * never hidden), bank coverage (a re-check always comes from an unseen question) and the
 * guardian home tip.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { MASTERY_OUTCOME_TRAIL_QUERY, type MasteryTrailData } from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Loader, Notice, H2 } from "../../components/ui";
import { STR, bnNum, masteryReasonLabel, masteryStateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space, useColors } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";
import { fill, stateTone } from "./masteryStateUi";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryOutcomeTrail">;

const sourceLabel = (s: string) => (s === "HW" ? STR.msSourceHW : s === "CT" ? STR.msSourceCT : STR.msSourceRubric);
const day = (iso: string | null) => (iso ? bnNum(iso.slice(0, 10)) : "");

export default function MasteryOutcomeTrailScreen({ route }: Props): React.ReactElement {
  const { studentId, loCode } = route.params;
  const colors = useColors();
  const [{ data, fetching, error }] = useQuery({
    query: MASTERY_OUTCOME_TRAIL_QUERY,
    variables: { studentId, loCode },
    requestPolicy: "cache-and-network",
  });
  const t = data?.masteryOutcomeTrail as MasteryTrailData | undefined;

  if (fetching && !t) {
    return (
      <Screen>
        <Loader />
      </Screen>
    );
  }
  if (error || !t) {
    return (
      <Screen>
        <Notice message={error ? friendlyError(error) : STR.msNoEvidenceYet} tone={error ? "danger" : "info"} />
      </Screen>
    );
  }
  const o = t.outcome;

  // % per attempt: one bar per paper (live rows only), oldest first.
  const perPaper = new Map<string, { date: string; e: number; a: number }>();
  for (const r of [...t.rows].reverse()) {
    if (r.excluded) continue;
    const x = perPaper.get(r.paperId) ?? { date: r.date, e: 0, a: 0 };
    x.e += r.earned;
    x.a += r.available;
    perPaper.set(r.paperId, x);
  }
  const bars = [...perPaper.entries()].map(([paperId, x]) => ({ paperId, date: x.date, pct: x.a > 0 ? Math.round((x.e / x.a) * 100) : 0 }));

  return (
    <Screen scroll>
      <H2>{o.labelBn}</H2>
      <Muted>
        {t.name} · {o.loCode}
      </Muted>

      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
          <Badge text={masteryStateLabel(o.state)} tone={stateTone(o.state)} />
          {o.since ? <Muted>{fill(STR.msSince, { d: day(o.since) })}</Muted> : null}
        </View>
        <View style={{ flexDirection: "row", gap: space(4), flexWrap: "wrap" }}>
          {[
            [STR.msRecent, o.recentPct === null ? "—" : `${bnNum(o.recentPct)}%`],
            [STR.msTotal, o.earnedPct === null ? "—" : `${bnNum(o.earnedPct)}%`],
            [STR.msSectionMean, o.sectionMeanPct === null ? "—" : `${bnNum(o.sectionMeanPct)}%`],
            [STR.msReworkCount, bnNum(o.reworkCount)],
          ].map(([label, value]) => (
            <View key={label}>
              <Body style={{ fontSize: 22, fontWeight: "700" }}>{value}</Body>
              <Muted>{label}</Muted>
            </View>
          ))}
        </View>
        {o.reasons.length > 0 ? <Muted>{o.reasons.map(masteryReasonLabel).join(" · ")}</Muted> : null}
        {t.history.length > 0 ? (
          <Muted>
            {STR.msStatePath}: {t.history.map((h) => `${masteryStateLabel(h.state)} (${day(h.at)})`).join(" → ")}
          </Muted>
        ) : null}
        {o.nextRevisionAt ? <Muted>{fill(STR.msNextRevision, { d: day(o.nextRevisionAt) })}</Muted> : null}
      </Card>

      {bars.length > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.msPerAttempt}</Body>
          <View
            accessibilityRole="image"
            accessibilityLabel={bars.map((b) => `${day(b.date)} ${bnNum(b.pct)}%`).join(", ")}
            style={{ flexDirection: "row", alignItems: "flex-end", gap: space(3), height: 110, borderBottomWidth: 1, borderBottomColor: colors.border, paddingTop: space(4) }}
          >
            {bars.map((b) => (
              <View key={b.paperId} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                <Muted style={{ fontSize: 11 }}>{bnNum(b.pct)}%</Muted>
                <View
                  style={{
                    width: "100%", height: `${Math.max(2, b.pct)}%`, borderTopLeftRadius: 4, borderTopRightRadius: 4,
                    backgroundColor: b.pct >= 70 ? colors.primary : b.pct >= 50 ? colors.warning : colors.error,
                  }}
                />
              </View>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: space(3) }}>
            {bars.map((b) => (
              <Muted key={b.paperId} style={{ flex: 1, textAlign: "center", fontSize: 11 }}>
                {day(b.date)}
              </Muted>
            ))}
          </View>
        </Card>
      ) : null}

      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.msEvidenceEach}</Body>
        {t.rows.map((r, i) => (
          <View
            key={`${r.paperId}-${r.itemNo ?? "w"}-${i}`}
            style={{ flexDirection: "row", gap: space(2), paddingVertical: space(2), borderTopWidth: 1, borderTopColor: colors.surfaceAlt, opacity: r.excluded ? 0.6 : 1 }}
          >
            <Muted style={{ width: 84 }}>{day(r.date)}</Muted>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2) }}>
                <Body style={{ fontWeight: "600", flexShrink: 1 }}>
                  {sourceLabel(r.source)}
                  {r.itemNo !== null ? ` · ${STR.msItems} ${bnNum(r.itemNo)}` : ""}
                </Body>
                <Body style={{ fontWeight: "700" }}>
                  {r.rubricStep !== null ? `${bnNum(r.rubricStep)}/৪` : `${bnNum(r.earned)} / ${bnNum(r.available)}`}
                </Body>
              </View>
              <Muted style={{ fontSize: 11 }}>
                {r.paperId}
                {r.qid ? ` · ${r.qid}` : ""}
                {r.questionTypeCode ? ` · ${r.questionTypeCode}` : ""}
              </Muted>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
                {r.rework ? <Badge text={STR.msReworkCount} tone="danger" /> : null}
                {r.workRework ? <Badge text={STR.msWorkRework} tone="warn" /> : null}
                {r.routed ? <Badge text={STR.msRouted} tone="info" /> : null}
                {r.tags.map((tg) => (
                  <Badge key={tg.code} text={tg.labelBn} tone="gold" />
                ))}
                {r.excluded ? <Badge text={`${STR.msExcludedRow}${r.excludeReason ? ` · ${r.excludeReason}` : ""}`} tone="muted" /> : null}
              </View>
            </View>
          </View>
        ))}
      </Card>

      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.msBank}</Body>
        <Body>
          {fill(STR.msBankLine, { gold: bnNum(t.bankGold), seen: bnNum(t.bankSeen), left: bnNum(Math.max(0, t.bankGold - t.bankSeen)) })}
        </Body>
        <Muted>{STR.msBankNote}</Muted>
      </Card>

      {t.homeTipBn ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.msHomeTip}</Body>
          <Body>{t.homeTipBn}</Body>
        </Card>
      ) : null}
    </Screen>
  );
}

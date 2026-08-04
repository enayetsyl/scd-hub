/**
 * ObservationTrendScreen (CO-4, observation:read row-scoped + observation:manage) —
 * a teacher's per-domain (D1..D5) ↑/↓/→ level trend (teacherObservationTrend), plus, for
 * managers, the school-wide weakest-domain training-need signal (schoolObservationPatterns).
 * The trend is per-domain — there is NO average across domains. Reads are row-scoped:
 * a non-manager may read only their own trend (the server enforces it).
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "urql";
import {
  TEACHER_OBSERVATION_TREND_QUERY,
  SCHOOL_OBSERVATION_PATTERNS_QUERY,
} from "../../graphql/observation";
import { Screen, Card, Body, Muted, Button, Field, Row, Badge, Loader } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR, obsDomainLabel, obsLevelLabel, obsTrendGlyph, bnNum, isoDateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

export default function ObservationTrendScreen(): React.ReactElement {
  const { user, role, can } = useAuth();
  const canManage = can("observation:manage");

  // Default to the caller's own id; a manager may type any teacher id.
  const [teacherId, setTeacherId] = useState(user?.id ?? "");
  const [active, setActive] = useState(user?.id ?? "");

  const [trendQ] = useQuery({
    query: TEACHER_OBSERVATION_TREND_QUERY,
    variables: { teacherId: active },
    pause: !active,
  });
  const trend = trendQ.data?.teacherObservationTrend ?? null;

  const [patternsQ] = useQuery({
    query: SCHOOL_OBSERVATION_PATTERNS_QUERY,
    variables: {},
    pause: !canManage,
  });
  const patterns = patternsQ.data?.schoolObservationPatterns ?? null;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        {canManage ? (
          <Card>
            <Field label={STR.obsTrendTeacherId} value={teacherId} onChangeText={setTeacherId} />
            <Button title={STR.obsTrendNav} variant="secondary" onPress={() => setActive(teacherId.trim())} />
          </Card>
        ) : null}

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.obsTrendTitle}</Body>
          {trendQ.fetching ? (
            <Loader label={STR.loading} />
          ) : trendQ.error ? (
            <Muted style={{ marginTop: space(2) }}>{friendlyError(trendQ.error)}</Muted>
          ) : !trend || trend.observationCount === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.obsNoTrend}</Muted>
          ) : (
            <>
              <Row label={STR.obsObservationCount} value={bnNum(trend.observationCount)} />
              {trend.firstClassDate && trend.lastClassDate ? (
                <Row
                  label={STR.obsDateRange}
                  value={`${isoDateLabel(trend.firstClassDate)} – ${isoDateLabel(trend.lastClassDate)}`}
                />
              ) : null}
              {trend.domains.map((d) => (
                <View key={d.domain} style={{ marginTop: space(2) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Body style={{ fontWeight: "700", flexShrink: 1 }}>{obsDomainLabel(d.domain)}</Body>
                    <Badge text={obsTrendGlyph(d.trend)} tone={d.trend === "up" ? "ok" : d.trend === "down" ? "danger" : "muted"} />
                  </View>
                  <Muted>
                    {STR.obsLatest}: {d.latestLevel != null ? obsLevelLabel(d.latestLevel) : "—"} · {STR.obsPrevious}:{" "}
                    {d.previousLevel != null ? obsLevelLabel(d.previousLevel) : "—"}
                  </Muted>
                </View>
              ))}
            </>
          )}
        </Card>

        {canManage ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.obsSchoolPatterns}</Body>
            {patternsQ.fetching ? (
              <Loader label={STR.loading} />
            ) : !patterns || patterns.observationCount === 0 ? (
              <Muted style={{ marginTop: space(2) }}>{STR.obsNoTrend}</Muted>
            ) : (
              <>
                <Row label={STR.obsObservationCount} value={bnNum(patterns.observationCount)} />
                <Row label={STR.obsWeakestDomains} value={patterns.weakestDomains.map((d) => obsDomainLabel(d)).join(", ") || "—"} />
                {patterns.domains.map((d) => (
                  <Row
                    key={d.domain}
                    label={obsDomainLabel(d.domain)}
                    value={`${STR.obsMeanLevel}: ${d.meanLevel != null ? bnNum(d.meanLevel.toFixed(1)) : "—"} · ${STR.obsSampleCount}: ${bnNum(d.sampleCount)}`}
                  />
                ))}
              </>
            )}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

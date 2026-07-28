/**
 * AllObservationsScreen — Principal/Office oversight view of classroom observations,
 * newest first, with SERVER-SIDE filtering + pagination (WS1). The filter block itself
 * is the shared `ObservationFilters` (CO-11, D-#363) — name search (teacher/observer),
 * form, state, publish status, subject, CLASS/section, teacher, observer and a
 * class-date range — so this screen and the observer's own review history filter
 * identically. Page through the results (20/page); tapping a row opens
 * ObservationDetailScreen. Requires observation:upload permission.
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { ALL_CLASSROOM_OBSERVATIONS_QUERY } from "../../graphql/observation";
import { TEACHERS_QUERY } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Badge } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import {
  ObservationFilters,
  EMPTY_OBSERVATION_FILTERS,
  type ObservationFilterState,
} from "../../components/ObservationFilters";
import { STR, obsFormLabel, hwSubjectLabel, obsStateLabel, obsPublishBadge, bnNum, isoDateLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { ObservationStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ObservationStackParamList>;

const PAGE_SIZE = 20;

function stateTone(state: string): "ok" | "brand" | "muted" | "danger" {
  if (state === "TEACHER_RESPONDED") return "ok";
  if (state === "REVIEWED") return "brand";
  if (state === "SUPERSEDED") return "muted";
  return "muted";
}

export default function AllObservationsScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  // Deep-links (e.g. the admin-Today "awaiting publish" badge) may seed the
  // state/published filters via route params; the user can clear them as usual.
  const route = useRoute<RouteProp<ObservationStackParamList, "AllObservations">>();

  const [filters, setFilters] = useState<ObservationFilterState>({
    ...EMPTY_OBSERVATION_FILTERS,
    state: route.params?.state ?? null,
    published: route.params?.published ?? null,
    withheld: route.params?.withheld ?? null,
  });
  const [page, setPage] = useState(0);

  // Any filter change resets to the first page.
  function patch(p: Partial<ObservationFilterState>): void {
    setFilters((f) => ({ ...f, ...p }));
    setPage(0);
  }
  function clearAll(): void {
    setFilters(EMPTY_OBSERVATION_FILTERS);
    setPage(0);
  }

  const [teachersQ, refetchTeachers] = useQuery({ query: TEACHERS_QUERY });
  const teachers = teachersQ.data?.teachers ?? [];
  const nameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of teachers) map[t.id] = t.name;
    return map;
  }, [teachers]);
  const teacherOptions = useMemo(() => teachers.map((t) => ({ label: t.name, value: t.id })), [teachers]);

  const [obsQ, refetchObs] = useQuery({
    query: ALL_CLASSROOM_OBSERVATIONS_QUERY,
    variables: {
      form: filters.form,
      state: filters.state,
      subject: filters.subject,
      sectionId: filters.sectionId,
      published: filters.published,
      withheld: filters.withheld,
      teacherId: filters.teacherId,
      observerId: filters.observerId,
      dateFrom: filters.dateFrom || null,
      dateTo: filters.dateTo || null,
      search: filters.search.trim() || null,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    },
  });

  const data = obsQ.data?.allClassroomObservations;
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = page * PAGE_SIZE + rows.length;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <ObservationFilters
          value={filters}
          onChange={patch}
          onClear={clearAll}
          teacherOptions={teacherOptions}
        />

        {/* --- Result count + pagination ----------------------------------- */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: space(2) }}>
          <Muted>{`${bnNum(from)}–${bnNum(to)} / ${bnNum(total)}`}</Muted>
          <View style={{ flexDirection: "row", gap: space(2) }}>
            <Button title={STR.obsPrev} variant="secondary" onPress={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} />
            <Button title={STR.obsNext} variant="secondary" onPress={() => setPage((p) => p + 1)} disabled={!hasMore} />
          </View>
        </View>

        {/* --- Results ----------------------------------------------------- */}
        <QueryGate
          result={obsQ}
          onRetry={() => {
            refetchObs({ requestPolicy: "network-only" });
            refetchTeachers({ requestPolicy: "network-only" });
          }}
          loaderLabel={STR.loading}
        >
        {rows.length === 0 ? (
          <Card>
            <Muted>{STR.obsNoAllObservations}</Muted>
          </Card>
        ) : (
          rows.map((o) => {
            const teacherName = nameById[o.teacherId] ?? o.teacherId;
            const reviewerName = o.observerId ? (nameById[o.observerId] ?? o.observerId) : "—";
            const title = `${obsFormLabel(o.form)} · ${hwSubjectLabel(o.subject)}`;
            return (
              <Card key={o.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{title}</Body>
                    <Muted>{isoDateLabel(o.classDate)}</Muted>
                    <Muted>{STR.obsTeacher}: {teacherName}</Muted>
                    <Muted>{STR.obsObserver}: {reviewerName}</Muted>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: space(1) }}>
                    <Badge text={obsStateLabel(o.state)} tone={stateTone(o.state)} />
                    <Badge {...obsPublishBadge(o)} />
                  </View>
                </View>
                <View style={{ marginTop: space(2) }}>
                  <Button
                    title={STR.obsDetailTitle}
                    variant="secondary"
                    onPress={() => nav.navigate("ObservationDetail", { observationId: o.id, title })}
                  />
                </View>
              </Card>
            );
          })
        )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}

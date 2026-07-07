/**
 * AllObservationsScreen — Principal/Office oversight view of classroom observations,
 * newest first, with SERVER-SIDE filtering + pagination (WS1). Filter by name search
 * (teacher/observer), form, state, subject, teacher, observer, and a class-date range;
 * page through the results (20/page). Tapping a row opens ObservationDetailScreen.
 * Requires observation:upload permission.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { HW_SUBJECTS, OBSERVATION_FORMS, OBSERVATION_STATES } from "@scd/shared";
import { ALL_CLASSROOM_OBSERVATIONS_QUERY } from "../../graphql/observation";
import { TEACHERS_QUERY } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Badge, Chip, ChipRow, Field, Select, Loader } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR, obsFormLabel, hwSubjectLabel, obsStateLabel, bnNum } from "../../lib/labels";
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

/** Subject filter label: HW subjects via hwSubjectLabel; QURAN via the Quran-form label. */
function subjectFilterLabel(s: string): string {
  return s === "QURAN" ? obsFormLabel("QURAN") : hwSubjectLabel(s);
}

interface Filters {
  form: string | null;
  state: string | null;
  subject: string | null;
  teacherId: string | null;
  observerId: string | null;
  dateFrom: string;
  dateTo: string;
  search: string;
}
const EMPTY: Filters = {
  form: null,
  state: null,
  subject: null,
  teacherId: null,
  observerId: null,
  dateFrom: "",
  dateTo: "",
  search: "",
};

export default function AllObservationsScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(0);

  // Any filter change resets to the first page.
  function patch(p: Partial<Filters>): void {
    setFilters((f) => ({ ...f, ...p }));
    setPage(0);
  }
  // Debounce the free-text search (it hits a User name lookup server-side).
  useEffect(() => {
    const id = setTimeout(() => {
      setFilters((f) => ({ ...f, search: searchInput }));
      setPage(0);
    }, 400);
    return () => clearTimeout(id);
  }, [searchInput]);

  const [teachersQ] = useQuery({ query: TEACHERS_QUERY });
  const teachers = teachersQ.data?.teachers ?? [];
  const nameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of teachers) map[t.id] = t.name;
    return map;
  }, [teachers]);
  const teacherOptions = useMemo(() => teachers.map((t) => ({ label: t.name, value: t.id })), [teachers]);

  const [obsQ] = useQuery({
    query: ALL_CLASSROOM_OBSERVATIONS_QUERY,
    variables: {
      form: filters.form,
      state: filters.state,
      subject: filters.subject,
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

  const hasActiveFilters =
    filters.form !== null ||
    filters.state !== null ||
    filters.subject !== null ||
    filters.teacherId !== null ||
    filters.observerId !== null ||
    filters.dateFrom !== "" ||
    filters.dateTo !== "" ||
    filters.search !== "";

  function clearAll(): void {
    setFilters(EMPTY);
    setSearchInput("");
    setPage(0);
  }

  const subjectOptions = useMemo(
    () => [...HW_SUBJECTS, "QURAN"].map((s) => ({ label: subjectFilterLabel(s), value: s })),
    [],
  );

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        {/* --- Filters ------------------------------------------------------ */}
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700" }}>{STR.obsFilters}</Body>
            {hasActiveFilters ? (
              <Button title={STR.obsClearFilters} variant="ghost" onPress={clearAll} />
            ) : null}
          </View>

          <Field
            label={undefined}
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder={STR.obsSearchPlaceholder}
          />

          <Muted style={{ marginTop: space(2) }}>{STR.obsFilterForm}</Muted>
          <ChipRow>
            <Chip label={STR.all} selected={filters.form === null} onPress={() => patch({ form: null })} />
            {OBSERVATION_FORMS.map((f) => (
              <Chip
                key={f}
                label={obsFormLabel(f)}
                selected={filters.form === f}
                onPress={() => patch({ form: filters.form === f ? null : f })}
              />
            ))}
          </ChipRow>

          <Muted style={{ marginTop: space(2) }}>{STR.obsState}</Muted>
          <ChipRow>
            <Chip label={STR.all} selected={filters.state === null} onPress={() => patch({ state: null })} />
            {OBSERVATION_STATES.map((s) => (
              <Chip
                key={s}
                label={obsStateLabel(s)}
                selected={filters.state === s}
                onPress={() => patch({ state: filters.state === s ? null : s })}
              />
            ))}
          </ChipRow>

          <Select
            label={STR.obsFilterSubject}
            value={filters.subject ?? ""}
            placeholder={STR.all}
            options={[{ label: STR.all, value: "" }, ...subjectOptions]}
            onChange={(v) => patch({ subject: v || null })}
          />
          <Select
            label={STR.obsTeacher}
            value={filters.teacherId ?? ""}
            placeholder={STR.all}
            searchable
            options={[{ label: STR.all, value: "" }, ...teacherOptions]}
            onChange={(v) => patch({ teacherId: v || null })}
          />
          <Select
            label={STR.obsObserver}
            value={filters.observerId ?? ""}
            placeholder={STR.all}
            searchable
            options={[{ label: STR.all, value: "" }, ...teacherOptions]}
            onChange={(v) => patch({ observerId: v || null })}
          />

          <View style={{ flexDirection: "row", gap: space(2) }}>
            <View style={{ flex: 1 }}>
              <DateField label={STR.obsDateFrom} value={filters.dateFrom} onChange={(v) => patch({ dateFrom: v })} max={filters.dateTo || undefined} />
            </View>
            <View style={{ flex: 1 }}>
              <DateField label={STR.obsDateTo} value={filters.dateTo} onChange={(v) => patch({ dateTo: v })} min={filters.dateFrom || undefined} />
            </View>
          </View>
        </Card>

        {/* --- Result count + pagination ----------------------------------- */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: space(2) }}>
          <Muted>{`${bnNum(from)}–${bnNum(to)} / ${bnNum(total)}`}</Muted>
          <View style={{ flexDirection: "row", gap: space(2) }}>
            <Button title={STR.obsPrev} variant="secondary" onPress={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} />
            <Button title={STR.obsNext} variant="secondary" onPress={() => setPage((p) => p + 1)} disabled={!hasMore} />
          </View>
        </View>

        {/* --- Results ----------------------------------------------------- */}
        {obsQ.fetching && rows.length === 0 ? (
          <Loader label={STR.loading} />
        ) : rows.length === 0 ? (
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
                    <Muted>{new Date(o.classDate).toLocaleDateString()}</Muted>
                    <Muted>{STR.obsTeacher}: {teacherName}</Muted>
                    <Muted>{STR.obsObserver}: {reviewerName}</Muted>
                  </View>
                  <Badge text={obsStateLabel(o.state)} tone={stateTone(o.state)} />
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
      </ScrollView>
    </Screen>
  );
}

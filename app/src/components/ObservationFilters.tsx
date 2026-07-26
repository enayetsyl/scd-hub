/**
 * ObservationFilters (CO-11, D-#363) — the observation filter block, extracted from
 * AllObservationsScreen so the Principal/Office oversight view and an observer's own
 * review history filter IDENTICALLY. One definition; a filter added here appears on
 * both screens.
 *
 * Owns the free-text debounce (the server resolves it through a User name lookup) and
 * the class/section option list; everything else is controlled by the parent, which
 * also owns paging. `showObserver` is false on the history screen — there the observer
 * is the caller and the server forces it, so offering the picker would be a lie.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { HW_SUBJECTS, OBSERVATION_FORMS, OBSERVATION_STATES } from "@scd/shared";
import { ACADEMIC_YEARS_QUERY, CLASSES_QUERY } from "../graphql/operations";
import { Card, Body, Muted, Button, Chip, ChipRow, Field, Select } from "./ui";
import { DateField } from "./DateField";
import { STR, obsFormLabel, hwSubjectLabel, obsStateLabel } from "../lib/labels";
import { space } from "../theme/tokens";

export interface ObservationFilterState {
  form: string | null;
  state: string | null;
  subject: string | null;
  /** The class/section anchor (D-#363). A subjectGroup-anchored row never matches. */
  sectionId: string | null;
  /** CO-8 publish gate (D-#324): true=published, false=unpublished, null=either. */
  published: boolean | null;
  teacherId: string | null;
  observerId: string | null;
  dateFrom: string;
  dateTo: string;
  search: string;
}

export const EMPTY_OBSERVATION_FILTERS: ObservationFilterState = {
  form: null,
  state: null,
  subject: null,
  sectionId: null,
  published: null,
  teacherId: null,
  observerId: null,
  dateFrom: "",
  dateTo: "",
  search: "",
};

export function hasActiveObservationFilters(f: ObservationFilterState): boolean {
  return (
    f.form !== null ||
    f.state !== null ||
    f.subject !== null ||
    f.sectionId !== null ||
    f.published !== null ||
    f.teacherId !== null ||
    f.observerId !== null ||
    f.dateFrom !== "" ||
    f.dateTo !== "" ||
    f.search !== ""
  );
}

/** Subject filter label: HW subjects via hwSubjectLabel; QURAN via the Quran-form label. */
function subjectFilterLabel(s: string): string {
  return s === "QURAN" ? obsFormLabel("QURAN") : hwSubjectLabel(s);
}

interface Props {
  value: ObservationFilterState;
  onChange: (patch: Partial<ObservationFilterState>) => void;
  onClear: () => void;
  /** Teacher pickers ({label,value}); the parent already loads the roster for names. */
  teacherOptions: { label: string; value: string }[];
  /** Show the observer picker (oversight only — the history view forces it server-side). */
  showObserver?: boolean;
}

export function ObservationFilters({
  value,
  onChange,
  onClear,
  teacherOptions,
  showObserver = true,
}: Props): React.ReactElement {
  // Debounced free text. `emitted` tracks what WE last pushed up, so an external reset
  // ("clear all") is adopted while our own emission never bounces back as a new edit.
  const [searchInput, setSearchInput] = useState(value.search);
  const emitted = useRef(value.search);

  useEffect(() => {
    const id = setTimeout(() => {
      if (searchInput !== emitted.current) {
        emitted.current = searchInput;
        onChange({ search: searchInput });
      }
    }, 400);
    return () => clearTimeout(id);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (value.search !== emitted.current) {
      emitted.current = value.search;
      setSearchInput(value.search);
    }
  }, [value.search]);

  // Class/section options — the current academic year's active sections (the
  // UploadObservationScreen pattern).
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const currentYearId = useMemo(() => {
    const years = yearsQ.data?.academicYears ?? [];
    return years.find((y) => y.current)?.id ?? years[0]?.id ?? null;
  }, [yearsQ.data]);
  const [classesQ] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: currentYearId ?? "" },
    pause: !currentYearId,
  });
  const sectionOptions = useMemo(
    () =>
      (classesQ.data?.classes ?? []).flatMap((c) =>
        c.sections
          .filter((s) => s.active)
          .map((s) => ({ label: `${c.nameBn} — ${s.nameBn || s.code}`, value: s.id })),
      ),
    [classesQ.data],
  );

  const subjectOptions = useMemo(
    () => [...HW_SUBJECTS, "QURAN"].map((s) => ({ label: subjectFilterLabel(s), value: s })),
    [],
  );

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Body style={{ fontWeight: "700" }}>{STR.obsFilters}</Body>
        {hasActiveObservationFilters(value) ? (
          <Button title={STR.obsClearFilters} variant="ghost" onPress={onClear} />
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
        <Chip label={STR.all} selected={value.form === null} onPress={() => onChange({ form: null })} />
        {OBSERVATION_FORMS.map((f) => (
          <Chip
            key={f}
            label={obsFormLabel(f)}
            selected={value.form === f}
            onPress={() => onChange({ form: value.form === f ? null : f })}
          />
        ))}
      </ChipRow>

      <Muted style={{ marginTop: space(2) }}>{STR.obsState}</Muted>
      <ChipRow>
        <Chip label={STR.all} selected={value.state === null} onPress={() => onChange({ state: null })} />
        {OBSERVATION_STATES.map((s) => (
          <Chip
            key={s}
            label={obsStateLabel(s)}
            selected={value.state === s}
            onPress={() => onChange({ state: value.state === s ? null : s })}
          />
        ))}
      </ChipRow>

      {/* CO-8 publish gate (D-#324): a released-to-teacher / awaiting-publish split. */}
      <Muted style={{ marginTop: space(2) }}>{STR.obsFilterPublished}</Muted>
      <ChipRow>
        <Chip label={STR.all} selected={value.published === null} onPress={() => onChange({ published: null })} />
        <Chip
          label={STR.obsPublished}
          selected={value.published === true}
          onPress={() => onChange({ published: value.published === true ? null : true })}
        />
        <Chip
          label={STR.obsUnpublished}
          selected={value.published === false}
          onPress={() => onChange({ published: value.published === false ? null : false })}
        />
      </ChipRow>

      <Select
        label={STR.obsFilterSubject}
        value={value.subject ?? ""}
        placeholder={STR.all}
        options={[{ label: STR.all, value: "" }, ...subjectOptions]}
        onChange={(v) => onChange({ subject: v || null })}
      />
      <Select
        label={STR.obsFilterSection}
        value={value.sectionId ?? ""}
        placeholder={STR.all}
        searchable
        options={[{ label: STR.all, value: "" }, ...sectionOptions]}
        onChange={(v) => onChange({ sectionId: v || null })}
      />
      <Select
        label={STR.obsTeacher}
        value={value.teacherId ?? ""}
        placeholder={STR.all}
        searchable
        options={[{ label: STR.all, value: "" }, ...teacherOptions]}
        onChange={(v) => onChange({ teacherId: v || null })}
      />
      {showObserver ? (
        <Select
          label={STR.obsObserver}
          value={value.observerId ?? ""}
          placeholder={STR.all}
          searchable
          options={[{ label: STR.all, value: "" }, ...teacherOptions]}
          onChange={(v) => onChange({ observerId: v || null })}
        />
      ) : null}

      <View style={{ flexDirection: "row", gap: space(2) }}>
        <View style={{ flex: 1 }}>
          <DateField
            label={STR.obsDateFrom}
            value={value.dateFrom}
            onChange={(v) => onChange({ dateFrom: v })}
            max={value.dateTo || undefined}
          />
        </View>
        <View style={{ flex: 1 }}>
          <DateField
            label={STR.obsDateTo}
            value={value.dateTo}
            onChange={(v) => onChange({ dateTo: v })}
            min={value.dateFrom || undefined}
          />
        </View>
      </View>
    </Card>
  );
}

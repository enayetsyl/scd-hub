/**
 * ReportFilters (D-#309) — the shared range + row-filter controls for the
 * Principal/Office report screens (Reconciliation report + the Reports hub).
 *
 *   useReportRange  — Today/7/14/30 chips plus a custom from–to picker; yields
 *                     the [fromKey, toKey] the report query takes.
 *   useRowFilters   — client-side Class / Teacher / Subject selects over the
 *                     ALREADY-FETCHED rows (the report payloads are small);
 *                     options are derived from the rows themselves so the
 *                     selects never offer a value with zero matches.
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { Chip, ChipRow, Select } from "./ui";
import { DateField } from "./DateField";
import { STR, classLevelLabel, hwSubjectLabel } from "../lib/labels";
import { dateKey } from "../lib/dates";
import { space } from "../theme/tokens";

const RANGES = [
  { labelKey: "rrToday", days: 1 },
  { labelKey: "rrLast7", days: 7 },
  { labelKey: "rrLast14", days: 14 },
  { labelKey: "rrLast30", days: 30 },
] as const;

const keyDaysAgo = (days: number): string => {
  const now = new Date();
  return dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)));
};

export function useReportRange(defaultDays = 7): {
  fromKey: string;
  toKey: string;
  node: React.ReactElement;
} {
  const [days, setDays] = useState<number>(defaultDays);
  const [custom, setCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(keyDaysAgo(7));
  const [customTo, setCustomTo] = useState(dateKey());

  const fromKey = custom ? customFrom : keyDaysAgo(days);
  const toKey = custom ? customTo : dateKey();

  const node = (
    <View>
      <ChipRow>
        {RANGES.map((r) => (
          <Chip
            key={r.days}
            label={STR[r.labelKey]}
            selected={!custom && days === r.days}
            onPress={() => {
              setCustom(false);
              setDays(r.days);
            }}
          />
        ))}
        <Chip label={STR.rptCustomRange} selected={custom} onPress={() => setCustom(true)} />
      </ChipRow>
      {custom ? (
        <View style={{ flexDirection: "row", gap: space(2) }}>
          <View style={{ flex: 1 }}>
            <DateField label={STR.rptFrom} value={customFrom} onChange={setCustomFrom} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label={STR.rptTo} value={customTo} onChange={setCustomTo} />
          </View>
        </View>
      ) : null}
    </View>
  );

  return { fromKey, toKey, node };
}

const ALL = "" as const;

export interface FilterOptionSets {
  classLevels: number[];
  teachers: string[];
  /** null = no subject axis on this screen (the select is hidden). */
  subjects: string[] | null;
  /** Label formatter for subject codes (default hwSubjectLabel; routine screens pass routineSubjectLabel). */
  subjectLabel?: (code: string) => string;
}

/**
 * Core filter state: selects fed by the given option sets, plus a `match`
 * predicate the screen applies per section. Multi-section screens (the recon
 * report) derive one combined option set and share the state; single-list
 * screens use the `useRowFilters` convenience below.
 */
export function useReportFilterState(sets: FilterOptionSets): {
  node: React.ReactElement;
  match: (classLevel: number | null, teacherName: string | null, subject?: string) => boolean;
} {
  const [cls, setCls] = useState<string>(ALL);
  const [teacher, setTeacher] = useState<string>(ALL);
  const [subject, setSubject] = useState<string>(ALL);

  const classOptions = useMemo(
    () => [
      { label: STR.all, value: ALL as string },
      ...[...new Set(sets.classLevels)].sort((a, b) => a - b).map((l) => ({ label: classLevelLabel(l), value: String(l) })),
    ],
    [sets.classLevels],
  );
  const teacherOptions = useMemo(
    () => [
      { label: STR.all, value: ALL as string },
      ...[...new Set(sets.teachers)].sort().map((n) => ({ label: n, value: n })),
    ],
    [sets.teachers],
  );
  const subjectOptions = useMemo(
    () =>
      sets.subjects === null
        ? null
        : [
            { label: STR.all, value: ALL as string },
            ...[...new Set(sets.subjects)].sort().map((c) => ({ label: (sets.subjectLabel ?? hwSubjectLabel)(c), value: c })),
          ],
    [sets.subjects],
  );

  const match = (classLevel: number | null, teacherName: string | null, subj?: string): boolean =>
    (cls === ALL || (classLevel != null && String(classLevel) === cls)) &&
    (teacher === ALL || teacherName === teacher) &&
    (subject === ALL || subj === undefined || subj === subject);

  const node = (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
      <View style={{ flexGrow: 1, minWidth: 140 }}>
        <Select label={STR.rptFilterClass} value={cls} options={classOptions} onChange={setCls} />
      </View>
      <View style={{ flexGrow: 1, minWidth: 140 }}>
        <Select label={STR.rptFilterTeacher} value={teacher} options={teacherOptions} onChange={setTeacher} />
      </View>
      {subjectOptions ? (
        <View style={{ flexGrow: 1, minWidth: 140 }}>
          <Select label={STR.rptFilterSubject} value={subject} options={subjectOptions} onChange={setSubject} />
        </View>
      ) : null}
    </View>
  );

  return { node, match };
}

export interface RowFilterConfig<T> {
  /** null = the row has no class (e.g. subject-group notes) — it matches only "All". */
  classOf: (r: T) => number | null;
  teacherOf: (r: T) => string | null;
  /** Omit when the row kind has no subject axis (e.g. homework issue-pending). */
  subjectOf?: (r: T) => string;
  /** Optional subject-code label formatter (default hwSubjectLabel). */
  subjectLabel?: (code: string) => string;
}

/** Single-list convenience over useReportFilterState. */
export function useRowFilters<T>(
  rows: readonly T[],
  cfg: RowFilterConfig<T>,
): { filtered: T[]; node: React.ReactElement } {
  const sets = useMemo<FilterOptionSets>(
    () => ({
      classLevels: rows.map(cfg.classOf).filter((l): l is number => l != null),
      teachers: rows.map(cfg.teacherOf).filter(Boolean) as string[],
      subjects: cfg.subjectOf ? rows.map(cfg.subjectOf) : null,
      subjectLabel: cfg.subjectLabel,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows],
  );
  const { node, match } = useReportFilterState(sets);
  const filtered = rows.filter((r) => match(cfg.classOf(r), cfg.teacherOf(r), cfg.subjectOf?.(r)));
  return { filtered, node };
}

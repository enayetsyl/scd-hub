/**
 * RosterScreen — the whole-school student table (Office/Principal, roster:manage).
 * One row per active student: SL, ID, name (→ student profile), class, Quran
 * group, Arabic group, guardian phone. Replaces the old one-section card list
 * (owner ask 2026-09-30: "make it tabular, default pagination 100").
 *
 * The directory is one batched read (`studentDirectory`); filtering by class,
 * searching and paging all run on the client — the roster is a few hundred rows,
 * so a round-trip per page would only add latency.
 */
import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { DEFAULT_SECTION_CODE } from "@scd/shared";
import {
  STUDENT_DIRECTORY_QUERY,
  type DirectoryGroupT,
  type StudentDirectoryRowT,
} from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Button, Field, Select, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { STR, bnNum, classLevelLabel, getActiveLang, groupGenderLabel, relationLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { space, useColors } from "../../theme";
import { REPORT_PAPER as REPORT } from "../../theme/reportPaper";

type Nav = NativeStackNavigationProp<AdminStackParamList>;

const ALL = "__all__";
const PAGE_SIZES = ["50", "100", "200"] as const;
type PageSize = (typeof PAGE_SIZES)[number];
const DEFAULT_PAGE_SIZE: PageSize = "100";

/** Widths are the columns' minimums AND their share of any spare width, so the
 *  table fills a desktop frame and scrolls sideways on a phone. */
const COLUMNS = [
  { key: "sl", labelKey: "rosterColSl", width: 56 },
  { key: "id", labelKey: "studentId", width: 80 },
  { key: "name", labelKey: "rosterColName", width: 230 },
  { key: "class", labelKey: "rosterColClass", width: 150 },
  { key: "quran", labelKey: "rosterColQuran", width: 160 },
  { key: "arabic", labelKey: "rosterColArabic", width: 160 },
  { key: "phone", labelKey: "rosterColGuardianPhone", width: 190 },
] as const;
const TABLE_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0);

function Cell({ width, children }: { width: number; children: React.ReactNode }): React.ReactElement {
  return <View style={{ flexGrow: width, flexBasis: width, padding: space(2), justifyContent: "center" }}>{children}</View>;
}

function classCell(r: StudentDirectoryRowT, lang: string): string {
  const cls = r.classLevel != null ? classLevelLabel(r.classLevel) : r.classNameBn ?? "—";
  // A class with a single default section needs no section suffix; a split
  // class (বালক / বালিকা) does.
  if (!r.sectionCode || r.sectionCode === DEFAULT_SECTION_CODE) return cls;
  return `${cls} · ${lang === "en" ? r.sectionCode : r.sectionNameBn ?? r.sectionCode}`;
}

function groupCell(g: DirectoryGroupT | null, lang: string): string {
  if (!g) return "—";
  return lang === "en" ? `${g.level} (${groupGenderLabel(g.gender)})` : g.nameBn;
}

function showingLabel(from: number, to: number, total: number): string {
  return STR.rosterShowing.replace("{from}", bnNum(from)).replace("{to}", bnNum(to)).replace("{total}", bnNum(total));
}

export default function RosterScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const lang = getActiveLang();
  const colors = useColors();

  const [{ data, fetching, error }, refetch] = useQuery({ query: STUDENT_DIRECTORY_QUERY });
  const rows = data?.studentDirectory ?? [];
  const { refreshing, onRefresh } = usePullRefresh(fetching, () => refetch({ requestPolicy: "network-only" }));

  const [search, setSearch] = useState("");
  const [classId, setClassId] = useState<string>(ALL);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  // One option per class present in the roster, in roster (class-level) order.
  const classOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (!seen.has(r.classId)) seen.set(r.classId, r.classLevel != null ? classLevelLabel(r.classLevel) : r.classNameBn ?? "—");
    }
    return [{ label: STR.rosterAllClasses, value: ALL }, ...[...seen].map(([value, label]) => ({ label, value }))];
  }, [rows, lang]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (classId === ALL || r.classId === classId) &&
        (!q ||
          r.name.toLowerCase().includes(q) ||
          (r.nameBn ?? "").toLowerCase().includes(q) ||
          r.schoolId.toLowerCase().includes(q) ||
          r.guardians.some((g) => g.phone.includes(q))),
    );
  }, [rows, search, classId]);

  const size = Number(pageSize);
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pageCount);
  const firstIndex = (current - 1) * size;
  const pageRows = filtered.slice(firstIndex, firstIndex + size);

  /** Any filter change resets to page 1 — page 3 of the old result means nothing in the new one. */
  const resetting =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };

  return (
    <Screen
      scroll
      wide
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={{ gap: space(3) }}>
        <View>
          <H2>{STR.roster}</H2>
          {data ? <Muted>{`${bnNum(rows.length)} ${STR.rosterCount}`}</Muted> : null}
        </View>

        {rows.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3), alignItems: "flex-end" }}>
            <View style={{ flexGrow: 2, flexBasis: 260 }}>
              <Field label={undefined} value={search} onChangeText={resetting(setSearch)} placeholder={STR.searchStudents} />
            </View>
            <View style={{ flexGrow: 1, flexBasis: 180 }}>
              <Select value={classId} options={classOptions} onChange={resetting(setClassId)} />
            </View>
            <View style={{ flexGrow: 1, flexBasis: 140 }}>
              <Select
                label={STR.rosterPerPage}
                value={pageSize}
                options={PAGE_SIZES.map((s) => ({ label: bnNum(s), value: s }))}
                onChange={resetting(setPageSize)}
              />
            </View>
          </View>
        ) : null}

        {error ? (
          <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
        ) : fetching && rows.length === 0 ? (
          <Loader label={STR.loading} />
        ) : rows.length === 0 ? (
          <EmptyState message={STR.empty} />
        ) : total === 0 ? (
          <EmptyState message={STR.noMatches} />
        ) : (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexGrow: 1 }}>
              <View style={{ minWidth: TABLE_WIDTH, flexGrow: 1 }}>
                <View style={{ flexDirection: "row", backgroundColor: REPORT.headerBg }}>
                  {COLUMNS.map((col) => (
                    <View
                      key={col.key}
                      style={{
                        flexGrow: col.width,
                        flexBasis: col.width,
                        paddingVertical: space(2),
                        paddingHorizontal: space(2),
                        justifyContent: "center",
                        borderRightWidth: 1,
                        borderRightColor: REPORT.headerDivider,
                      }}
                    >
                      <Text style={{ color: REPORT.headerText, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>
                        {STR[col.labelKey]}
                      </Text>
                    </View>
                  ))}
                </View>

                {pageRows.map((r, i) => (
                  <View
                    key={r.id}
                    style={{
                      flexDirection: "row",
                      backgroundColor: i % 2 === 0 ? REPORT.rowEven : REPORT.rowOdd,
                      borderBottomWidth: 1,
                      borderBottomColor: REPORT.rowBorder,
                    }}
                  >
                    <Cell width={COLUMNS[0].width}>
                      <Body style={{ color: REPORT.text }}>{bnNum(firstIndex + i + 1)}</Body>
                    </Cell>
                    <Cell width={COLUMNS[1].width}>
                      <Body style={{ color: REPORT.text }}>{r.schoolId}</Body>
                    </Cell>
                    <Cell width={COLUMNS[2].width}>
                      {/* SP-3 entry point: the roster is where an admin looks a child up. */}
                      <Pressable
                        accessibilityRole="link"
                        onPress={() => nav.navigate("StudentProfile", { studentId: r.id, studentName: r.nameBn || r.name })}
                      >
                        <Body style={{ color: REPORT.link, fontWeight: "600" }}>{r.nameBn || r.name}</Body>
                        {r.nameBn ? <Muted style={{ color: REPORT.textMuted }}>{r.name}</Muted> : null}
                      </Pressable>
                    </Cell>
                    <Cell width={COLUMNS[3].width}>
                      <Body style={{ color: REPORT.text }}>{classCell(r, lang)}</Body>
                    </Cell>
                    <Cell width={COLUMNS[4].width}>
                      <Body style={{ color: REPORT.text }}>{groupCell(r.quranGroup, lang)}</Body>
                    </Cell>
                    <Cell width={COLUMNS[5].width}>
                      <Body style={{ color: REPORT.text }}>{groupCell(r.arabicGroup, lang)}</Body>
                    </Cell>
                    <Cell width={COLUMNS[6].width}>
                      {r.guardians.length === 0 ? (
                        <Muted style={{ color: REPORT.textMuted }}>—</Muted>
                      ) : (
                        r.guardians.map((g) => (
                          <Body key={g.phone} style={{ color: REPORT.text }}>
                            {g.phone}
                            <Text style={{ color: REPORT.textMuted, fontSize: 12 }}>{` · ${relationLabel(g.relation)}`}</Text>
                          </Body>
                        ))
                      )}
                    </Cell>
                  </View>
                ))}
              </View>
            </ScrollView>
          </Card>
        )}

        {total > 0 ? (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: space(3),
            }}
          >
            <Muted>{showingLabel(firstIndex + 1, firstIndex + pageRows.length, total)}</Muted>
            {pageCount > 1 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
                <Button
                  title={`‹ ${STR.cnPagePrev}`}
                  variant="secondary"
                  disabled={current <= 1}
                  onPress={() => setPage(current - 1)}
                />
                <Muted>
                  {STR.cnPage} {bnNum(current)} / {bnNum(pageCount)}
                </Muted>
                <Button
                  title={`${STR.cnPageNext} ›`}
                  variant="secondary"
                  disabled={current >= pageCount}
                  onPress={() => setPage(current + 1)}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

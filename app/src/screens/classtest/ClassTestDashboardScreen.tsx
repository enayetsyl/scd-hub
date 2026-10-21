/**
 * ClassTestDashboardScreen (CT-5 / J5, Principal/Office) — the school-wide KPIs
 * (logged / complete / in-progress / not-started / overdue + completion rate),
 * a per-test DRILL-DOWN under the tiles (D-#339: tap a tile = state filter; each
 * row shows who/when and taps through to the results), the overdue-by-teacher
 *
 * TWO INDEPENDENT AXES (owner ask 2026-07-28). The tiles are the ENTRY state — "are the
 * marks in?". The chip row under the drill-down is the PUBLISH state — "can the guardian
 * see them?" (`lib/ctPublishStatus`, derived from submittedAt/publishedAt, which the
 * reports-status row already carried). They AND-combine, so Complete + Unpublished is
 * the release backlog — a number this screen previously could not show at all. Each row
 * carries both badges for the same reason.
 * breakdown, and the Office overdue-chase (a rendered wa.me nudge per teacher —
 * message:dispatch). Reads are gated Principal/Office server-side; a teacher
 * reaching here sees the Bangla deny inline.
 */
import React, { useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { CLASS_TEST_OVERDUE_CHASE_QUERY, CLASS_TEST_REPORTS_STATUS_QUERY } from "../../graphql/classTest";
import { ARCHIVE_LOCATIONS_QUERY } from "../../graphql/archive";
import { Screen, Card, Body, Muted, Button, Badge, Chip, ChipRow, Field, Loader, Notice, Select } from "../../components/ui";
import { DateField } from "../../components/DateField";
import {
  EMPTY_CT_SCOPE,
  GROUP_SECTION,
  ctDashboardKpis,
  ctScopeActiveCount,
  inCtScope,
  type CtScope,
} from "../../lib/ctDashboardFilter";
import {
  CT_PUBLISH_FILTERS,
  ctPublishBadge,
  ctPublishFilterLabel,
  matchesCtPublishFilter,
  type CtPublishFilter,
} from "../../lib/ctPublishStatus";
import { CT_PAGE_SIZE, ctOrderRows, ctPageOf } from "../../lib/ctDashboardOrder";
import {
  STR,
  hwSubjectLabel,
  ctReportStateLabel,
  ctScriptStageLabel,
  bnNum,
  isoDateLabel,
  classLevelLabel,
  classSectionLabel,
  dhakaDateKey,
} from "../../lib/labels";
import { CT_SCRIPT_TILE_ORDER, ctScriptStageTone } from "../../lib/ctScriptStage";
import type { CtScriptStage } from "@scd/shared";
import { friendlyError } from "../../lib/errors";
import { useSectionNames } from "../../lib/useSectionNames";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ClassTestStackParamList>;

/** null = all logged tests (the default drill-down scope).
 *  D-#603 adds two OWNER-scoped slices of `overdue`: they are not report states
 *  (the row's state is still "overdue" in both), they answer "whose move is it?" */
type StateFilter =
  | "complete"
  | "in_progress"
  | "not_started"
  | "overdue"
  | "awaiting_submit"
  | "awaiting_publish"
  | null;

/** The two owner slices read the ownership flags; everything else is the state. */
const matchesStateFilter = (
  r: { state: string; teacherOverdue: boolean; publishOverdue: boolean },
  f: StateFilter,
): boolean => {
  if (f === null) return true;
  if (f === "awaiting_submit") return r.teacherOverdue;
  if (f === "awaiting_publish") return r.publishOverdue;
  return r.state === f;
};


const stateTone = (s: string): "ok" | "danger" | "brand" | "muted" =>
  s === "complete" ? "ok" : s === "overdue" ? "danger" : s === "in_progress" ? "brand" : "muted";

function Kpi({
  label,
  value,
  selected,
  onPress,
}: {
  label: string;
  value: string;
  selected?: boolean;
  onPress?: () => void;
}): React.ReactElement {
  return (
    <Pressable style={{ flexGrow: 1, minWidth: 96 }} onPress={onPress} disabled={!onPress}>
      <Card>
        <Body style={{ fontWeight: "700", fontSize: 20 }}>{value}</Body>
        <Muted style={selected ? { fontWeight: "700" } : undefined}>
          {selected ? "▸ " : ""}
          {label}
        </Muted>
      </Card>
    </Pressable>
  );
}

export default function ClassTestDashboardScreen(): React.ReactElement {
  const sectionName = useSectionNames();
  const nav = useNavigation<Nav>();
  // The archive desk path — any-test filing with auto-ack (PM: archive:approve, the
  // lever fileScriptBundle reads for "file any test").
  const canFile = useAuth().can("archive:approve");
  // D-#339: tap a tile → filter the per-test drill-down below (logged = all).
  const [stateFilter, setStateFilter] = useState<StateFilter>(null);
  // Owner ask 2026-07-28: the PUBLISH axis, independent of the entry state above — the
  // tiles only ever answered "are the marks in?", never "can the guardian see them?".
  // The two AND-combine, so "Complete + Unpublished" = the actual release backlog.
  const [publishFilter, setPublishFilter] = useState<CtPublishFilter | null>(null);
  // CS-1 (D-#715): the THIRD axis — where the paper is. AND-combines with both above.
  const [scriptFilter, setScriptFilter] = useState<CtScriptStage | null>(null);
  const pickScript = (s: CtScriptStage | null): void => {
    setScriptFilter(s);
    setPageAt(0);
  };
  // Current page of the drill-down; either filter changing sends you back to page 1,
  // because page 4 of the old list means nothing in the new one.
  const [pageAt, setPageAt] = useState(0);
  const pickState = (s: StateFilter): void => {
    setStateFilter(s);
    setPageAt(0);
  };
  const pickPublish = (f: CtPublishFilter | null): void => {
    setPublishFilter(f);
    setPageAt(0);
  };
  // D-#740: the SCOPE (class / section / subject / teacher / exam dates / search). It
  // narrows everything below it — tiles, list, overdue-by-teacher, chase — because the
  // tiles are a fold over the same rows (lib/ctDashboardFilter), not a second query.
  const [scope, setScope] = useState<CtScope>(EMPTY_CT_SCOPE);
  const patchScope = (patch: Partial<CtScope>): void => {
    setScope((s) => ({ ...s, ...patch }));
    setPageAt(0);
  };
  const [chaseQ] = useQuery({ query: CLASS_TEST_OVERDUE_CHASE_QUERY, variables: {} });
  const [rowsQ] = useQuery({ query: CLASS_TEST_REPORTS_STATUS_QUERY, variables: {} });
  const chase = chaseQ.data?.classTestOverdueChase ?? null;
  const schoolRows = useMemo(() => rowsQ.data?.classTestReportsStatus ?? [], [rowsQ.data]);
  const sectionLabelOf = (r: { classLevel: number | null; sectionId: string | null }): string =>
    r.sectionId === null || r.classLevel === null
      ? STR.ctScopeGroupTests
      : classSectionLabel(r.classLevel, sectionName(r.sectionId));
  const haystackOf = (r: (typeof schoolRows)[number]): string =>
    `${hwSubjectLabel(r.subject)} ${r.subject} ${sectionLabelOf(r)} ${STR.ctTestNumber} ${r.testNumber}`;
  const inScope = (s: CtScope) => (r: (typeof schoolRows)[number]) => inCtScope(r, s, haystackOf(r), dhakaDateKey);
  const allRows = schoolRows.filter(inScope(scope));
  const d = rowsQ.data ? ctDashboardKpis(allRows) : null;
  // Each picker offers what the OTHER filters leave (faceted), so a choice never leads
  // to an empty list; the picked value itself always stays listed.
  const facet = (clear: Partial<CtScope>) => schoolRows.filter(inScope({ ...scope, ...clear }));
  const classOptions = [...new Set(facet({ classLevel: null }).map((r) => r.classLevel))]
    .filter((l): l is number => l !== null)
    .sort((a, b) => a - b)
    .map((l) => ({ label: classLevelLabel(l), value: String(l) }));
  const sectionRows = facet({ section: null });
  const sectionOptions = [
    ...new Map(
      sectionRows
        .filter((r) => r.sectionId !== null && r.classLevel !== null)
        .sort((a, b) => (a.classLevel ?? 0) - (b.classLevel ?? 0))
        .map((r) => [r.sectionId as string, { label: sectionLabelOf(r), value: r.sectionId as string }]),
    ).values(),
    ...(sectionRows.some((r) => r.sectionId === null && r.subjectGroupId)
      ? [{ label: STR.ctScopeGroupTests, value: GROUP_SECTION }]
      : []),
  ];
  const subjectOptions = [...new Set(facet({ subject: null }).map((r) => r.subject))]
    .map((s) => ({ label: hwSubjectLabel(s), value: s }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const teacherOptions = [...new Map(facet({ teacherId: null }).map((r) => [r.teacherId, r.teacherName])).entries()]
    .map(([value, label]) => ({ label, value }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const scopeCount = ctScopeActiveCount(scope);
  // The chase card lists teachers with an in-scope overdue test. Its WhatsApp message
  // is the server's and names ALL of that teacher's overdue tests, so the exams shown
  // under the name stay whole too — the screen must not show less than the message says.
  const scopeTeachers = new Set(allRows.filter((r) => r.teacherOverdue).map((r) => r.teacherId));
  const chaseEntries = (chase?.entries ?? []).filter((e) => scopeCount === 0 || scopeTeachers.has(e.teacherId));
  const stateRows = stateFilter ? allRows.filter((r) => matchesStateFilter(r, stateFilter)) : allRows;
  const publishRows = publishFilter ? stateRows.filter((r) => matchesCtPublishFilter(r, publishFilter)) : stateRows;
  const filtered = scriptFilter ? publishRows.filter((r) => r.scriptStage === scriptFilter) : publishRows;
  // The script tiles count school-wide, like the entry-state tiles beside them.
  const scriptCount = (s: CtScriptStage): number => allRows.filter((r) => r.scriptStage === s).length;
  // Release backlog → overdue → in hand → done (lib/ctDashboardOrder), then 50 a page.
  const rows = ctOrderRows(filtered);
  const { page, pageCount, from, rows: pageRows } = ctPageOf(rows, pageAt);
  // AR-1: one batched "where are the scripts?" lookup for the VISIBLE page only
  // (50 rows), never per row. Every drill-down row is already PRINTED. urql keys
  // on the variables' VALUE, so the rebuilt array is not a refetch per render.
  const pageTestIds = pageRows.map((r) => r.testId);
  const [locsQ] = useQuery({
    query: ARCHIVE_LOCATIONS_QUERY,
    variables: { testIds: pageTestIds },
    pause: pageTestIds.length === 0,
  });
  const locOf = new Map((locsQ.data?.archiveLocationsForTests ?? []).map((l) => [l.testId, l]));
  // Chip counts are computed WITHIN the tile selection so they always add up to what the
  // list below is showing, rather than to a school-wide total the user cannot see.
  const publishCount = (f: CtPublishFilter): number =>
    stateRows.filter((r) => matchesCtPublishFilter(r, f)).length;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        {rowsQ.error ? <Notice message={friendlyError(rowsQ.error)} tone="danger" /> : null}
        {rowsQ.fetching && !rowsQ.data ? (
          <Loader label={STR.loading} />
        ) : d ? (
          <>
            {/* D-#740 — the scope: narrows every tile, list and card below. */}
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>
                  {STR.ctScopeTitle}
                  {scopeCount > 0 ? ` (${bnNum(scopeCount)})` : ""}
                </Body>
                {scopeCount > 0 ? (
                  <Button title={STR.ctScopeClear} variant="ghost" onPress={() => patchScope(EMPTY_CT_SCOPE)} />
                ) : null}
              </View>
              <Muted>{STR.ctScopeHint}</Muted>
              <Field
                label={undefined}
                value={scope.search}
                onChangeText={(t) => patchScope({ search: t })}
                placeholder={STR.ctScopeSearch}
              />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                <View style={{ flexGrow: 1, flexBasis: 160 }}>
                  <Select
                    label={STR.ctScopeClass}
                    value={scope.classLevel === null ? "" : String(scope.classLevel)}
                    placeholder={STR.all}
                    options={[{ label: STR.all, value: "" }, ...classOptions]}
                    // A section belongs to one class — drop it when the class moves away.
                    onChange={(v) => {
                      const level = v === "" ? null : Number(v);
                      const keep =
                        scope.section === null ||
                        level === null ||
                        schoolRows.some((r) => r.classLevel === level && r.sectionId === scope.section);
                      patchScope({ classLevel: level, section: keep ? scope.section : null });
                    }}
                  />
                </View>
                <View style={{ flexGrow: 1, flexBasis: 160 }}>
                  <Select
                    label={STR.ctScopeSection}
                    value={scope.section ?? ""}
                    placeholder={STR.all}
                    options={[{ label: STR.all, value: "" }, ...sectionOptions]}
                    onChange={(v) => patchScope({ section: v || null })}
                  />
                </View>
                <View style={{ flexGrow: 1, flexBasis: 160 }}>
                  <Select
                    label={STR.ctScopeSubject}
                    value={scope.subject ?? ""}
                    placeholder={STR.all}
                    searchable
                    options={[{ label: STR.all, value: "" }, ...subjectOptions]}
                    onChange={(v) => patchScope({ subject: v || null })}
                  />
                </View>
                <View style={{ flexGrow: 1, flexBasis: 160 }}>
                  <Select
                    label={STR.ctScopeTeacher}
                    value={scope.teacherId ?? ""}
                    placeholder={STR.all}
                    searchable
                    options={[{ label: STR.all, value: "" }, ...teacherOptions]}
                    onChange={(v) => patchScope({ teacherId: v || null })}
                  />
                </View>
                <View style={{ flexGrow: 1, flexBasis: 160 }}>
                  <DateField
                    label={STR.ctScopeDateFrom}
                    value={scope.dateFrom}
                    onChange={(v) => patchScope({ dateFrom: v })}
                    max={scope.dateTo || undefined}
                  />
                </View>
                <View style={{ flexGrow: 1, flexBasis: 160 }}>
                  <DateField
                    label={STR.ctScopeDateTo}
                    value={scope.dateTo}
                    onChange={(v) => patchScope({ dateTo: v })}
                    min={scope.dateFrom || undefined}
                  />
                </View>
              </View>
            </Card>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(3) }}>
              <Kpi label={STR.ctLogged} value={bnNum(d.logged)} selected={stateFilter === null} onPress={() => pickState(null)} />
              <Kpi label={STR.ctComplete} value={bnNum(d.complete)} selected={stateFilter === "complete"} onPress={() => pickState("complete")} />
              <Kpi label={STR.ctInProgress} value={bnNum(d.inProgress)} selected={stateFilter === "in_progress"} onPress={() => pickState("in_progress")} />
              <Kpi label={STR.ctNotStarted} value={bnNum(d.notStarted)} selected={stateFilter === "not_started"} onPress={() => pickState("not_started")} />
              <Kpi label={STR.ctOverdue} value={bnNum(d.overdue)} selected={stateFilter === "overdue"} onPress={() => pickState("overdue")} />
              {/* D-#603: the same delay, split by whose move it is. Both drill into
                  the `overdue` list, so the two always add up to the tile above. */}
              <Kpi
                label={STR.ctAwaitingSubmit}
                value={bnNum(d.awaitingSubmit)}
                selected={stateFilter === "awaiting_submit"}
                onPress={() => pickState("awaiting_submit")}
              />
              <Kpi
                label={STR.ctAwaitingPublish}
                value={bnNum(d.awaitingPublish)}
                selected={stateFilter === "awaiting_publish"}
                onPress={() => pickState("awaiting_publish")}
              />
              <Kpi label={STR.ctCompletionRate} value={d.completionRatePct == null ? "—" : `${bnNum(d.completionRatePct)}%`} />
            </View>

            {/* CS-1 (D-#715) — খাতার ধাপ: the paper's journey after the results are out.
                Tap a tile to filter the drill-down; tap again to clear. */}
            <Muted style={{ marginTop: space(3) }}>
              {STR.csDashTitle} · {STR.csDashHint}
            </Muted>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
              {CT_SCRIPT_TILE_ORDER.map((s) => (
                <Kpi
                  key={s}
                  label={ctScriptStageLabel(s)}
                  value={bnNum(scriptCount(s))}
                  selected={scriptFilter === s}
                  onPress={() => pickScript(scriptFilter === s ? null : s)}
                />
              ))}
            </View>

            {/* D-#339: per-test drill-down — who submitted / logged what, filtered by the tapped tile. */}
            <Card>
              <Body style={{ fontWeight: "700" }}>
                {STR.ctDrilldownTitle} · {stateFilter ? ctReportStateLabel(stateFilter) : STR.ctLogged}
                {publishFilter ? ` · ${ctPublishFilterLabel(publishFilter)}` : ""}
                {scriptFilter ? ` · ${ctScriptStageLabel(scriptFilter)}` : ""} ({bnNum(rows.length)})
              </Body>

              {/* The publish axis (owner ask 2026-07-28) — AND-combines with the tile above. */}
              <Muted style={{ marginTop: space(2) }}>{STR.ctFilterPublishTitle}</Muted>
              <ChipRow>
                <Chip
                  label={`${STR.all} (${bnNum(stateRows.length)})`}
                  selected={publishFilter === null}
                  onPress={() => pickPublish(null)}
                />
                {CT_PUBLISH_FILTERS.map((f) => (
                  <Chip
                    key={f}
                    label={`${ctPublishFilterLabel(f)} (${bnNum(publishCount(f))})`}
                    selected={publishFilter === f}
                    onPress={() => pickPublish(publishFilter === f ? null : f)}
                  />
                ))}
              </ChipRow>

              {rowsQ.error ? (
                <Notice message={friendlyError(rowsQ.error)} tone="danger" />
              ) : rowsQ.fetching ? (
                <Loader label={STR.loading} />
              ) : rows.length === 0 ? (
                <Muted style={{ marginTop: space(2) }}>{STR.ctNoReports}</Muted>
              ) : (
                pageRows.map((r) => (
                  <Pressable
                    key={r.testId}
                    onPress={() =>
                      nav.navigate("ClassTestResults", {
                        testId: r.testId,
                        title: `${hwSubjectLabel(r.subject)} · ${STR.ctTestNumber} ${bnNum(r.testNumber)}`,
                      })
                    }
                    style={{ marginTop: space(3) }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ flexShrink: 1 }}>
                        <Body style={{ fontWeight: "700" }}>
                          {hwSubjectLabel(r.subject)} · {STR.ctTestNumber} {bnNum(r.testNumber)}
                          {sectionName(r.sectionId) ? ` · ${sectionName(r.sectionId)}` : ""}
                        </Body>
                        <Muted>
                          {r.ctId} · {isoDateLabel(r.examDate)} · {r.teacherName}
                        </Muted>
                      </View>
                      {/* Two independent axes, two badges: entry state + publish state. */}
                      <View style={{ alignItems: "flex-end", gap: space(1) }}>
                        <Badge text={ctReportStateLabel(r.state)} tone={stateTone(r.state)} />
                        <Badge {...ctPublishBadge(r)} />
                        {/* CS-1: the third axis — only once the test is in the script flow. */}
                        {r.scriptStage ? (
                          <Badge text={ctScriptStageLabel(r.scriptStage)} tone={ctScriptStageTone(r.scriptStage)} />
                        ) : null}
                      </View>
                    </View>
                    <Muted style={{ marginTop: space(1) }}>
                      {STR.ctEntered} {bnNum(r.enteredCount)}/{bnNum(r.rosterCount)} · {STR.ctPending} {bnNum(r.pendingCount)}
                      {/* D-#606: on the deadline day itself the row is due but zero
                          days late — "স্কুল-দিন বিলম্ব ০" reads as a bug, so say আজ শেষ দিন. */}
                      {r.overdue
                        ? r.schoolDaysLate > 0
                          ? ` · ${STR.ctSchoolDaysLate} ${bnNum(r.schoolDaysLate)}`
                          : ` · ${STR.ctDueToday}`
                        : ""}
                      {/* D-#603: a red chip alone no longer says who is holding it up. */}
                      {r.overdue
                        ? ` · ${r.teacherOverdue ? STR.ctAwaitingSubmit : STR.ctAwaitingPublish}`
                        : ""}
                      {r.submittedAt
                        ? ` · ${STR.ctSubmittedBadge} ${isoDateLabel(r.submittedAt)}`
                        : ""}
                      {r.publishedAt
                        ? ` · ${STR.ctPublishedBadge} ${isoDateLabel(r.publishedAt)}`
                        : ""}
                    </Muted>
                    {/* CS-2: straight to the scan & tag screen for a test in the script flow. */}
                    {r.scriptStage ? (
                      <Pressable
                        onPress={() => nav.navigate("CtScriptUpload", { testId: r.testId, title: r.ctId })}
                        style={{ marginTop: space(1) }}
                      >
                        <Muted>
                          {STR.csColumn}: {ctScriptStageLabel(r.scriptStage)} · {STR.csUpload} ›
                        </Muted>
                      </Pressable>
                    ) : null}
                    {/* AR-1 lookup line: box + location (+ holder while out), or not-filed.
                        Not filed → the Office can file ANY teacher's scripts from here
                        (fileScriptBundle accepts roster:manage for every test); before, the
                        only file action was on the teacher's own "My tests" list. */}
                    {(() => {
                      const loc = locOf.get(r.testId);
                      if (!loc && canFile) {
                        return (
                          <Pressable
                            onPress={() => nav.navigate("ArchiveFileBundle", { testId: r.testId, ctId: r.ctId })}
                            style={{ marginTop: space(1) }}
                          >
                            <Muted>
                              {STR.arWhereScripts} {STR.arNotFiled} · {STR.arFileNow} ›
                            </Muted>
                          </Pressable>
                        );
                      }
                      return (
                        <Muted style={{ marginTop: space(1) }}>
                          {STR.arWhereScripts}{" "}
                          {loc
                            ? `${loc.boxCode} · ${loc.locationNote}${loc.holderName ? ` · ${loc.holderName}-${STR.arHeldBy}` : ""}`
                            : STR.arNotFiled}
                        </Muted>
                      );
                    })()}
                  </Pressable>
                ))
              )}

              {/* Pager — 50 rows a page. Hidden when everything fits on one, so the
                  common case is unchanged. */}
              {rows.length > CT_PAGE_SIZE ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: space(2),
                    marginTop: space(4),
                  }}
                >
                  <Button
                    title={`◀ ${STR.pagePrev}`}
                    variant="secondary"
                    disabled={page === 0}
                    onPress={() => setPageAt(page - 1)}
                  />
                  <Muted>
                    {STR.pageLabel} {bnNum(page + 1)} / {bnNum(pageCount)} · {bnNum(from + 1)}–
                    {bnNum(from + pageRows.length)} / {bnNum(rows.length)}
                  </Muted>
                  <Button
                    title={`${STR.pageNext} ▶`}
                    variant="secondary"
                    disabled={page >= pageCount - 1}
                    onPress={() => setPageAt(page + 1)}
                  />
                </View>
              ) : null}
            </Card>

            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.ctOverdueByTeacher}</Body>
              {d.overdueByTeacher.length === 0 ? (
                <Muted style={{ marginTop: space(2) }}>{STR.ctNoOverdue}</Muted>
              ) : (
                d.overdueByTeacher.map((r) => (
                  <View
                    key={r.teacherId}
                    style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}
                  >
                    <Body>{r.teacherName}</Body>
                    <Badge text={bnNum(r.overdueCount)} tone="danger" />
                  </View>
                ))
              )}
            </Card>
          </>
        ) : null}

        {/* Office overdue-chase — a wa.me nudge per overdue teacher (message:dispatch) */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.ctChaseTitle}</Body>
          {chaseQ.error ? (
            <Notice message={friendlyError(chaseQ.error)} tone="danger" />
          ) : chaseQ.fetching ? (
            <Loader label={STR.loading} />
          ) : chaseEntries.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.ctNoOverdue}</Muted>
          ) : (
            chaseEntries.map((e) => (
              <View
                key={e.teacherId}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(3) }}
              >
                <View style={{ flexShrink: 1 }}>
                  <Body style={{ fontWeight: "700" }}>{e.teacherName}</Body>
                  <Muted>
                    {e.exams
                      .map((x) => `${hwSubjectLabel(x.subject)} ${STR.ctTestNumber} ${bnNum(x.testNumber)}`)
                      .join(", ")}
                  </Muted>
                </View>
                {e.waLink ? (
                  <Button title={STR.ctSendWa} variant="secondary" onPress={() => void Linking.openURL(e.waLink as string)} />
                ) : (
                  <Badge text={STR.ctUnreachable} tone="muted" />
                )}
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

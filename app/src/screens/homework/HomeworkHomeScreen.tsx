/**
 * HomeworkHomeScreen (§8.1/§8.3) — the per-class daily homework dashboard.
 *
 * Class buttons (the teacher's assigned classes; Principal/Office see all) each carry a
 * cumulative badge (pending-checking count; red when chases are open) so a teacher sees
 * where the work is at a glance. Tapping a class loads that class+date's detail inline —
 * if the class has one accessible section it auto-selects; with several, a section row
 * appears. The selection flows through SectionContext so Declare/Reconcile/Records/
 * Checking keep working unchanged. The date is a real calendar (DateField, web + phone).
 */
import React, { useMemo, useState, useRef, useCallback } from "react";
import { View, Pressable, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery } from "urql";
import { roleHasPermission, HW_DAILY_CEILING_MIN } from "@scd/shared";
import {
  HOMEWORK_DAY_TALLY,
  HOMEWORK_SUMMARY,
  HOMEWORK_CLASS_OVERVIEW,
  CLASSES_QUERY,
  MY_SCOPES_QUERY,
  MY_SECTIONS_AS_CLASS_TEACHER_QUERY,
  type ClassT,
  type HwClassRefInput,
} from "../../graphql/operations";
import type { HomeworkStackParamList } from "../../navigation/types";
import {
  Screen,
  Body,
  Muted,
  Card,
  Badge,
  Button,
  Loader,
  EmptyState,
  ErrorBanner,
} from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR, bnNum, hwSubjectLabel, classLevelLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { useSectionContext } from "../../state/SectionContext";
import { space, useColors } from "../../theme";

type Props = NativeStackScreenProps<HomeworkStackParamList, "HomeworkHome">;

const today = (): string => new Date().toISOString().slice(0, 10);

/** Compact class label for the buttons: N / K / Bengali digit. */
function shortClassLabel(level: number): string {
  if (level === -1) return "N";
  if (level === 0) return "K";
  return bnNum(level);
}

type Section = ClassT["sections"][number];
interface MyClass {
  cls: ClassT;
  sections: Section[];
}

export default function HomeworkHomeScreen({ navigation }: Props): React.ReactElement {
  const colors = useColors();
  const { role, user } = useAuth();
  const { selection, setSection } = useSectionContext();
  const ayId = selection.academicYearId;
  // Principal/Office (roster:manage) AND school-wide homework supervisors see ALL classes —
  // a supervisor must be able to reach (and reconcile) any class, not just their own.
  const isAdmin = (!!role && roleHasPermission(role, "roster:manage")) || !!user?.homeworkSupervisor;

  const [date, setDate] = useState(today());
  // The class whose buttons are in focus (so a multi-section class can show its section
  // row before a section is chosen). Falls back to the persisted selection.
  const [activeClassId, setActiveClassId] = useState<string | null>(selection.classId);

  // Sources for "which classes" — mirrors SectionPickerScreen's recipe.
  const [{ data: classesData, fetching: classesFetching, error: classesError }] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: ayId ?? "" },
    pause: !ayId,
  });
  const [{ data: scopeData }] = useQuery({ query: MY_SCOPES_QUERY, pause: isAdmin });
  const [{ data: ctData }] = useQuery({ query: MY_SECTIONS_AS_CLASS_TEACHER_QUERY, pause: isAdmin });

  const classes = classesData?.classes ?? [];

  // The caller's accessible classes (grouped with their accessible sections).
  const myClasses = useMemo<MyClass[]>(() => {
    if (isAdmin) {
      return classes
        .map((cls) => ({ cls, sections: cls.sections.filter((s) => s.active) }))
        .filter((x) => x.sections.length > 0)
        .sort((a, b) => a.cls.level - b.cls.level);
    }
    const ids = new Set<string>();
    for (const g of scopeData?.myScopes ?? []) if (g.active && g.sectionId) ids.add(g.sectionId);
    for (const s of ctData?.mySectionsAsClassTeacher ?? []) ids.add(s.id);
    return classes
      .map((cls) => ({ cls, sections: cls.sections.filter((s) => ids.has(s.id)) }))
      .filter((x) => x.sections.length > 0)
      .sort((a, b) => a.cls.level - b.cls.level);
  }, [classes, isAdmin, scopeData, ctData]);

  // Per-class cumulative badges (one ref per class, any accessible section authorizes).
  const refs = useMemo<HwClassRefInput[]>(
    () => myClasses.map((m) => ({ classId: m.cls.id, sectionId: m.sections[0].id })),
    [myClasses],
  );
  const [overviewQ, refetchOverview] = useQuery({
    query: HOMEWORK_CLASS_OVERVIEW,
    variables: { refs },
    pause: refs.length === 0,
  });
  const overviewByClass = useMemo(() => {
    const m = new Map<string, NonNullable<typeof overviewQ.data>["homeworkClassOverview"][number]>();
    for (const o of overviewQ.data?.homeworkClassOverview ?? []) m.set(o.classId, o);
    return m;
  }, [overviewQ.data]);

  // The selected class+section detail (existing day-tally + summary).
  const hasSection = !!(selection.classId && selection.sectionId);
  const vars = { sectionId: selection.sectionId ?? "", classId: selection.classId ?? "", date };
  const [tallyQ, refetchTally] = useQuery({ query: HOMEWORK_DAY_TALLY, variables: vars, pause: !hasSection });
  const [sumQ, refetchSum] = useQuery({
    query: HOMEWORK_SUMMARY,
    variables: { sectionId: vars.sectionId, classId: vars.classId },
    pause: !hasSection,
  });

  // Refetch on focus (after declaring / reconciling) so nothing is stale.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      if (refs.length > 0) refetchOverview({ requestPolicy: "network-only" });
      if (hasSection) {
        refetchTally({ requestPolicy: "network-only" });
        refetchSum({ requestPolicy: "network-only" });
      }
    }, [refs.length, hasSection, refetchOverview, refetchTally, refetchSum]),
  );

  function pickSection(m: MyClass, s: Section): void {
    setSection({
      classId: m.cls.id,
      sectionId: s.id,
      classLevel: m.cls.level,
      classNameBn: m.cls.nameBn,
      sectionNameBn: s.nameBn,
    });
  }

  function onClassPress(m: MyClass): void {
    setActiveClassId(m.cls.id);
    if (m.sections.length === 1) {
      pickSection(m, m.sections[0]); // single section → auto-select, no section row
    } else {
      // multi-section → require a section pick; clear any stale section so the detail hides
      setSection({
        classId: m.cls.id,
        sectionId: null,
        classLevel: m.cls.level,
        classNameBn: m.cls.nameBn,
        sectionNameBn: null,
      });
    }
  }

  const activeClass = myClasses.find((m) => m.cls.id === activeClassId) ?? null;
  const showSectionRow = !!activeClass && activeClass.sections.length > 1;

  const tally = tallyQ.data?.homeworkDayTally;
  const summary = sumQ.data?.homeworkSummary;
  const over = tally ? !tally.withinCeiling : false;
  const selectedOverview = selection.classId ? overviewByClass.get(selection.classId) : undefined;

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <DateField label={STR.hwDate} value={date} onChange={setDate} />

        {/* Class buttons (the caller's assigned classes) with cumulative badges */}
        <Muted>{STR.hwClassLabel}</Muted>
        {classesError ? (
          <ErrorBanner message={friendlyError(classesError)} />
        ) : classesFetching && classes.length === 0 ? (
          <Loader label={STR.loading} />
        ) : myClasses.length === 0 ? (
          <EmptyState message={STR.empty} />
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: space(1) }}>
            {myClasses.map((m) => {
              const ov = overviewByClass.get(m.cls.id);
              const selected = selection.classId === m.cls.id || activeClassId === m.cls.id;
              const tone = ov && ov.activeChases > 0 ? "danger" : ov && ov.openResubmissions > 0 ? "warn" : "muted";
              return (
                <Pressable
                  key={m.cls.id}
                  onPress={() => onClassPress(m)}
                  accessibilityRole="button"
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingVertical: space(2),
                    paddingHorizontal: space(3),
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? colors.primaryContainer : colors.surface,
                    marginRight: space(2),
                    marginBottom: space(2),
                  }}
                >
                  <Body style={{ fontWeight: "700", color: selected ? colors.onPrimaryContainer : colors.textPrimary }}>
                    {shortClassLabel(m.cls.level)}
                  </Body>
                  {ov && ov.pendingChecking > 0 ? <Badge text={bnNum(ov.pendingChecking)} tone={tone} /> : null}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Section row — only when the active class has more than one accessible section */}
        {showSectionRow ? (
          <>
            <Muted style={{ marginTop: space(1) }}>{STR.hwSectionLabel}</Muted>
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: space(1) }}>
              {activeClass!.sections.map((s) => {
                const selected = selection.sectionId === s.id;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => pickSection(activeClass!, s)}
                    accessibilityRole="button"
                    style={{
                      paddingVertical: space(2),
                      paddingHorizontal: space(3),
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primaryContainer : colors.surface,
                      marginRight: space(2),
                      marginBottom: space(2),
                    }}
                  >
                    <Body style={{ color: selected ? colors.onPrimaryContainer : colors.textPrimary }}>
                      {s.nameBn} ({s.code})
                    </Body>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4), paddingTop: space(2) }}>
        {!hasSection ? (
          <EmptyState message={STR.hwPickClass} />
        ) : tallyQ.error ? (
          <ErrorBanner message={friendlyError(tallyQ.error)} onRetry={() => refetchTally({ requestPolicy: "network-only" })} />
        ) : tallyQ.fetching && !tally ? (
          <Loader label={STR.loading} />
        ) : (
          <>
            {/* Day total vs ceiling */}
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>{STR.hwDayTotal}</Body>
                <Badge
                  text={`${bnNum(tally?.dayTotal ?? 0)} / ${bnNum(tally?.ceiling ?? HW_DAILY_CEILING_MIN)} ${STR.hwMinutes}`}
                  tone={over ? "danger" : "ok"}
                />
              </View>
              <Muted style={{ marginTop: 4 }}>
                {over ? `${STR.hwOverCeiling} · ${STR.hwOverBy} ${bnNum(tally?.overBy ?? 0)} ${STR.hwMinutes}` : STR.hwWithinCeiling}
              </Muted>
            </Card>

            {/* Declarations */}
            {(tally?.items ?? []).length === 0 ? (
              <EmptyState message={STR.empty} />
            ) : (
              (tally?.items ?? []).map((it) => (
                <Card key={it.itemId}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Body style={{ fontWeight: "700" }}>{hwSubjectLabel(it.subject)}</Body>
                    <Badge text={it.status === "issued" ? STR.hwIssued : STR.hwDeclared} tone={it.status === "issued" ? "ok" : "muted"} />
                  </View>
                  <Muted style={{ marginTop: 4 }}>
                    {it.hwId} · {bnNum(it.timeDecl)} {STR.hwMinutes} · {bnNum(it.qCount)} {STR.questionsWord}
                  </Muted>
                  {it.topicLabelBn ? <Muted style={{ marginTop: 2 }}>📘 {it.topicLabelBn}</Muted> : null}
                  {it.bandWarning ? <Muted style={{ color: colors.warning, marginTop: 4 }}>{STR.hwBandWarning}</Muted> : null}
                </Card>
              ))
            )}

            {/* Summary roll-ups (cumulative for this class) */}
            {summary ? (
              <Card>
                <Body style={{ fontWeight: "700", marginBottom: 8 }}>{STR.trackerSummary}</Body>
                <SummaryRow label={STR.hwPendingChecking} value={bnNum(summary.pendingChecking)} />
                <SummaryRow label={STR.hwOpenResubmissions} value={bnNum(summary.openResubmissions)} />
                <SummaryRow label={STR.hwActiveChases} value={bnNum(summary.chaseList.length)} />
                {selectedOverview ? (
                  <SummaryRow label={STR.hwOverCeilingDays} value={bnNum(selectedOverview.overCeilingDaysThisWeek)} />
                ) : null}
                <SummaryRow
                  label={STR.hwOnTimePct}
                  value={summary.submittedOnTimePct == null ? "—" : `${bnNum(summary.submittedOnTimePct)}%`}
                />
                <SummaryRow
                  label={STR.hwReturnLatency}
                  value={summary.avgReturnLatencyDays == null ? "—" : bnNum(summary.avgReturnLatencyDays)}
                />
                {summary.chaseList.length > 0 ? (
                  <>
                    <Muted style={{ marginTop: 8, fontWeight: "700" }}>{STR.hwChaseList}</Muted>
                    {summary.chaseList.map((c) => (
                      <View key={c.recordId} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                        <Muted>{c.hwId}</Muted>
                        <View style={{ flexDirection: "row", gap: 6 }}>
                          <Badge text={`${STR.trackerEntry} ${bnNum(c.chaseCount)}`} tone="muted" />
                          {c.commsPrompt ? <Badge text={STR.hwCommsPrompt} tone="danger" /> : c.attention ? <Badge text={STR.hwAttention} tone="warn" /> : null}
                        </View>
                      </View>
                    ))}
                  </>
                ) : null}
                {summary.topicTouches.length > 0 ? (
                  <>
                    <Muted style={{ marginTop: 8, fontWeight: "700" }}>{STR.hwTopicTouches}</Muted>
                    {summary.topicTouches.slice(0, 8).map((tt) => (
                      <View key={tt.topTag} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                        <Muted>{tt.topTag}</Muted>
                        <Muted>{bnNum(tt.count)}</Muted>
                      </View>
                    ))}
                  </>
                ) : null}
              </Card>
            ) : null}

            {/* Actions */}
            <View style={{ gap: space(2), marginTop: space(2) }}>
              <Button title={STR.hwDeclare} onPress={() => navigation.navigate("DeclareHomework")} />
              <Button title={STR.hwReconcile} variant="secondary" onPress={() => navigation.navigate("HomeworkReconcile")} />
              <Button title={STR.hwRecords} variant="secondary" onPress={() => navigation.navigate("HomeworkRecords")} />
              <Button title={STR.hwChecking} variant="secondary" onPress={() => navigation.navigate("CheckingQueue")} />
              <Button title={STR.hwRollups} variant="secondary" onPress={() => navigation.navigate("HomeworkRollups")} />
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
      <Muted>{label}</Muted>
      <Body>{value}</Body>
    </View>
  );
}

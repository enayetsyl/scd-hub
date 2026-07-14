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
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery } from "urql";
import { HW_DAILY_CEILING_MIN } from "@scd/shared";
import {
  HOMEWORK_DAY_TALLY,
  HOMEWORK_SUMMARY,
  HOMEWORK_CLASS_OVERVIEW,
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
import {
  ClassSectionDashboard,
  useAccessibleClasses,
  type ClassBadge,
} from "../../components/ClassSectionDashboard";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { useSectionContext } from "../../state/SectionContext";
import { space, useColors } from "../../theme";
import { dateKey } from "../../lib/dates";

type Props = NativeStackScreenProps<HomeworkStackParamList, "HomeworkHome">;

const today = (): string => dateKey();

export default function HomeworkHomeScreen({ navigation }: Props): React.ReactElement {
  const colors = useColors();
  const { user } = useAuth();
  const { selection } = useSectionContext();

  const [date, setDate] = useState(today());

  // The caller's accessible classes — the shared UX-5 hook (also feeds the badge refs).
  const accessible = useAccessibleClasses();
  const { myClasses, isAdmin } = accessible;

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
  // Per-class badge for the dashboard buttons: pending-checking count; red when
  // chases are open, amber when resubmissions are.
  const badges = useMemo(() => {
    const m = new Map<string, ClassBadge>();
    for (const [classId, ov] of overviewByClass) {
      m.set(classId, {
        count: ov.pendingChecking,
        tone: ov.activeChases > 0 ? "danger" : ov.openResubmissions > 0 ? "warn" : "muted",
      });
    }
    return m;
  }, [overviewByClass]);

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

  const selectedSection =
    myClasses.find((m) => m.cls.id === selection.classId)?.sections.find((s) => s.id === selection.sectionId) ?? null;
  const canReconcileHomework =
    isAdmin || (!!selectedSection && (selectedSection.classTeacherId === user?.id || selectedSection.homeworkConfirmerId === user?.id));

  const tally = tallyQ.data?.homeworkDayTally;
  const summary = sumQ.data?.homeworkSummary;
  const over = tally ? !tally.withinCeiling : false;
  const selectedOverview = selection.classId ? overviewByClass.get(selection.classId) : undefined;

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <DateField label={STR.hwDate} value={date} onChange={setDate} />
        {/* The house class-button dashboard (UX-5) with the homework badge counts. */}
        <ClassSectionDashboard myClasses={accessible} badges={badges} />
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

            {/* Actions — the chosen date rides along (R-Context: never re-ask). */}
            <View style={{ gap: space(2), marginTop: space(2) }}>
              <Button title={STR.hwDeclare} onPress={() => navigation.navigate("DeclareHomework", { date })} />
              {canReconcileHomework ? (
                <Button title={STR.hwReconcile} variant="secondary" onPress={() => navigation.navigate("HomeworkReconcile", { date })} />
              ) : null}
              <Button title={STR.hwRecords} variant="secondary" onPress={() => navigation.navigate("HomeworkRecords")} />
              <Button title={STR.hwChecking} variant="secondary" onPress={() => navigation.navigate("CheckingQueue")} />
              <Button title={STR.hwRollups} variant="secondary" onPress={() => navigation.navigate("HomeworkRollups")} />
              {!canReconcileHomework && hasSection ? <Muted>{STR.hwClassTeacherOnly}</Muted> : null}
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

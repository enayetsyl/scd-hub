/**
 * ReportsHomeScreen (D-#309) — the Principal/Office Reports hub: one launcher
 * for the oversight reports. ALL six open in THIS stack (D-#311): the
 * attendance/class-note report screens are mounted here too, so the back
 * button returns to the hub — the original cross-tab jump popped to the host
 * tab's home (owner report).
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ReportsStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, EmptyState } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { REPORT_LEAF_ACTIONS } from "../../lib/navGates";
import { mostRecentSaturday } from "../revision/RevisionHomeScreen";
import { STR } from "../../lib/labels";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReportsStackParamList, "ReportsHome">;

export default function ReportsHomeScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  // Owner 2026-10-25: a report the viewer cannot open is not listed at all. Each card checks the
  // same actions as its sidebar leaf and its server query (REPORT_LEAF_ACTIONS, D-#846).
  const allowed = (screen: string): boolean => (REPORT_LEAF_ACTIONS[screen] ?? []).some((p) => can(p));
  const all: Array<{ screen: string; icon: string; title: string; sub?: string; onPress: () => void }> = [
    { screen: "TeacherClassLoad", icon: "🧑‍🏫", title: STR.clTitle, sub: STR.clSub, onPress: () => navigation.navigate("TeacherClassLoad") },
    { screen: "AssignmentLoadReport", icon: "📋", title: STR.alReportTitle, sub: STR.alReportSub, onPress: () => navigation.navigate("AssignmentLoadReport") },
    { screen: "ClassTestReport", icon: "🧪", title: STR.ctReportTitle, sub: STR.ctReportSub, onPress: () => navigation.navigate("ClassTestReport") },
    { screen: "MonthlyReportConsole", icon: "🗓️", title: STR.mrConsoleTitle, sub: STR.mrConsoleSub, onPress: () => navigation.navigate("MonthlyReportConsole") },
    { screen: "MonthlyPendingWork", icon: "⏳", title: STR.mpTitle, sub: STR.mpSub, onPress: () => navigation.navigate("MonthlyPendingWork") },
    { screen: "HwWeeklyUnsubmitted", icon: "📅", title: STR.hwwdTitle, sub: STR.hwwdSub, onPress: () => navigation.navigate("HwWeeklyUnsubmitted") },
    { screen: "AttendanceReport", icon: "🙋", title: STR.attReportTitle, onPress: () => navigation.navigate("AttendanceReport") },
    { screen: "ClassNoteReport", icon: "📓", title: STR.rtNoteReportTitle, onPress: () => navigation.navigate("ClassNoteReport") },
    { screen: "HwDeclarePending", icon: "📕", title: STR.rptHwDeclarePending, sub: STR.rrHwNdSub, onPress: () => navigation.navigate("HwDeclarePending") },
    { screen: "HwIssuePending", icon: "📒", title: STR.rptHwIssuePending, sub: STR.admSubReconReport, onPress: () => navigation.navigate("HwIssuePending") },
    { screen: "AsDeclarePending", icon: "📋", title: STR.rptAsDeclarePending, sub: STR.rptAsNdSub, onPress: () => navigation.navigate("AsDeclarePending") },
    { screen: "AsDeliverPending", icon: "📦", title: STR.rptAsDeliverPending, onPress: () => navigation.navigate("AsDeliverPending") },
    { screen: "AsPrintPending", icon: "🖨️", title: STR.rptAsPrintPending, sub: STR.rptAsPrintPendingSub, onPress: () => navigation.navigate("AsPrintPending") },
    // D-#861: the reports that sat elsewhere (Admin hub, module homes), one switch each.
    { screen: "AttendanceRanking", icon: "🏅", title: STR.arTitle, sub: STR.arHint, onPress: () => navigation.navigate("AttendanceRanking") },
    { screen: "WorkClaimQueue", icon: "🏠", title: STR.wcQueueTitle, sub: STR.wcOfficeFooter, onPress: () => navigation.navigate("WorkClaimQueue") },
    { screen: "LiveClassBoard", icon: "🟢", title: STR.lcbBoardTitle, onPress: () => navigation.navigate("LiveClassBoard") },
    { screen: "LoadGrid", icon: "⚖️", title: STR.wbLoad, onPress: () => navigation.navigate("LoadGrid") },
    { screen: "ClassTestDashboard", icon: "🧮", title: STR.ctDashboardTitle, onPress: () => navigation.navigate("ClassTestDashboard") },
    { screen: "StudentProgress", icon: "📈", title: STR.impNavTitle, onPress: () => navigation.navigate("StudentProgress") },
    { screen: "RevisionDashboard", icon: "🕌", title: STR.revDashTitle, onPress: () => navigation.navigate("RevisionDashboard", { date: mostRecentSaturday() }) },
    { screen: "QuestionReviewProgress", icon: "🔍", title: STR.qpTitle, sub: STR.qpSubtitle, onPress: () => navigation.navigate("QuestionReviewProgress") },
    { screen: "ReviewerEffectiveness", icon: "👁️", title: STR.obsReviewerEffTitle, onPress: () => navigation.navigate("ReviewerEffectiveness") },
    { screen: "TeachingNoteOpenComments", icon: "💬", title: STR.tnOpenComments, onPress: () => navigation.navigate("TeachingNoteOpenComments") },
    { screen: "FinanceDashboard", icon: "💰", title: STR.finDashboardTitle, onPress: () => navigation.navigate("FinanceDashboard") },
    { screen: "DailySnapshot", icon: "🧾", title: STR.finSnapshotTitle, onPress: () => navigation.navigate("DailySnapshot") },
    { screen: "GuardianEngagement", icon: "👪", title: STR.geTitle, sub: STR.geSubtitle, onPress: () => navigation.navigate("GuardianEngagement") },
  ];
  const cards = all.filter((c) => allowed(c.screen));

  return (
    <Screen scroll>
      <H2>{STR.tabReports}</H2>
      <Muted style={{ marginBottom: space(2) }}>{STR.rptHomeSub}</Muted>
      {cards.length === 0 ? <EmptyState message={STR.errForbiddenWrite} /> : null}
      {cards.map((c) => (
        <Card key={c.title} onPress={c.onPress}>
          <Body style={{ fontWeight: "700" }}>
            {c.icon} {c.title}
          </Body>
          {c.sub ? <Muted style={{ marginTop: 2 }}>{c.sub}</Muted> : null}
        </Card>
      ))}
    </Screen>
  );
}

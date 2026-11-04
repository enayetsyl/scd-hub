/**
 * HrHomeScreen — the staff/HR hub. Self-service entries (My leave, My record)
 * show for every logged-in staff member; the management entries are gated by the
 * caller's permission and the server enforces them again (prd-hr §2 row-scope).
 * Later HR slices (payroll / performance / offboarding) add their own gated
 * entries to this same hub.
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { HrStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card } from "../../components/ui";
import { STR } from "../../lib/labels";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "HrHome">;

export default function HrHomeScreen({ navigation }: Props): React.ReactElement {
  const { role, can } = useAuth();
  // PM (D-#790..#801): each card follows its own catalogue action.
  const canLeaveManage = can("leave:view_all");
  const canPayroll = can("payroll:view");
  const canHrPolicy = can("hr_policy:view");
  // PerformanceHome lists staff first (staff_records:view) — owner rule 2026-10-25.
  const canPerformance =
    (can("appraisal:view_all") || can("conduct:view_all") || can("grievance:view_all")) && can("staff_records:view");
  const canOffboarding = can("offboarding:view");
  const canMarkNotes = can("mark_submission:view_notes"); // D-#893: everyone's correction notes
  const canReviewMistakes = can("staff_mistakes:review") || can("staff_mistakes:view_all"); // D-#939
  const canMistakeSummary = can("staff_mistakes:view_all"); // D-#942/#943
  const showAdmin =
    canLeaveManage || canPayroll || canHrPolicy || canPerformance || canOffboarding || canMarkNotes || canReviewMistakes;

  return (
    <Screen scroll>
      <H2>{STR.tabHr}</H2>

      <Muted style={{ marginBottom: space(2) }}>{STR.hrSelfService}</Muted>
      <Card onPress={() => navigation.navigate("MyLeave")}>
        <Body style={{ fontWeight: "700" }}>{STR.hrMyLeave}</Body>
        <Muted>{STR.hrMyLeaveSub}</Muted>
      </Card>
      <Card onPress={() => navigation.navigate("MyRecord")}>
        <Body style={{ fontWeight: "700" }}>{STR.hrMyRecord}</Body>
        <Muted>{STR.hrMyRecordSub}</Muted>
      </Card>
      <Card onPress={() => navigation.navigate("MyLetters")}>
        <Body style={{ fontWeight: "700" }}>{STR.hrMyLetters}</Body>
        <Muted>{STR.hrMyLettersSub}</Muted>
      </Card>
      {can("staff_mistakes:view_own") ? (
        <Card onPress={() => navigation.navigate("MyMistakes")}>
          <Body style={{ fontWeight: "700" }}>{STR.smrMyTitle}</Body>
          <Muted>{STR.smrCardMineHelp}</Muted>
        </Card>
      ) : null}
      {can("mark_submission:view_own") ? (
        <Card onPress={() => navigation.navigate("MarkCorrections")}>
          <Body style={{ fontWeight: "700" }}>{STR.msgNotesTitle}</Body>
          <Muted>{STR.msgNotesHelp}</Muted>
        </Card>
      ) : null}

      {showAdmin ? <Muted style={{ marginTop: space(4), marginBottom: space(2) }}>{STR.hrAdmin}</Muted> : null}
      {canLeaveManage ? (
        <Card onPress={() => navigation.navigate("LeaveAdmin")}>
          <Body style={{ fontWeight: "700" }}>{STR.hrLeaveAdmin}</Body>
          <Muted>{STR.hrLeaveAdminSub}</Muted>
        </Card>
      ) : null}
      {canPayroll ? (
        <Card onPress={() => navigation.navigate("PayrollHome")}>
          <Body style={{ fontWeight: "700" }}>{STR.hrPayroll}</Body>
          <Muted>{STR.hrPayrollSub}</Muted>
        </Card>
      ) : null}
      {canHrPolicy ? (
        <Card onPress={() => navigation.navigate("HrPolicy")}>
          <Body style={{ fontWeight: "700" }}>{STR.stfPolicyTitle}</Body>
          <Muted>{STR.stfPolicySub}</Muted>
        </Card>
      ) : null}
      {canPerformance ? (
        <Card onPress={() => navigation.navigate("PerformanceHome")}>
          <Body style={{ fontWeight: "700" }}>{STR.hrPerformance}</Body>
          <Muted>{STR.hrPerformanceSub}</Muted>
        </Card>
      ) : null}
      {canOffboarding ? (
        <Card onPress={() => navigation.navigate("OffboardingHome")}>
          <Body style={{ fontWeight: "700" }}>{STR.hrOffboarding}</Body>
          <Muted>{STR.hrOffboardingSub}</Muted>
        </Card>
      ) : null}
      {canReviewMistakes ? (
        <Card onPress={() => navigation.navigate("MistakeReview")}>
          <Body style={{ fontWeight: "700" }}>{STR.smrReviewTitle}</Body>
          <Muted>{STR.smrCardReviewHelp}</Muted>
        </Card>
      ) : null}
      {canMistakeSummary ? (
        <Card onPress={() => navigation.navigate("StaffMistakeSummary")}>
          <Body style={{ fontWeight: "700" }}>{STR.smsTitle}</Body>
          <Muted>{STR.smrCardSummaryHelp}</Muted>
        </Card>
      ) : null}
      {canMistakeSummary ? (
        <Card onPress={() => navigation.navigate("StaffMistakeSettings")}>
          <Body style={{ fontWeight: "700" }}>{STR.smxTitle}</Body>
          <Muted>{STR.smrCardSettingsHelp}</Muted>
        </Card>
      ) : null}
      {canMarkNotes ? (
        <Card onPress={() => navigation.navigate("MarkCorrections", { all: true })}>
          <Body style={{ fontWeight: "700" }}>{`${STR.msgNotesTitle} — ${STR.msgNotesAll}`}</Body>
          <Muted>{STR.msgNotesHelp}</Muted>
        </Card>
      ) : null}
    </Screen>
  );
}

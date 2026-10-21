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
  const canPerformance = can("appraisal:view_all") || can("conduct:view_all") || can("grievance:view_all");
  const canOffboarding = can("offboarding:view");
  const showAdmin = canLeaveManage || canPayroll || canHrPolicy || canPerformance || canOffboarding;

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
    </Screen>
  );
}

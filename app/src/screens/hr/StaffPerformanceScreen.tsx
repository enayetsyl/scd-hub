/**
 * StaffPerformanceScreen — one staff member's performance hub (performance:manage):
 * links to observations, appraisals, conduct ladder, and CPD, each scoped to the
 * picked staff member.
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { HrStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card } from "../../components/ui";
import { STR } from "../../lib/labels";
import { useAuth } from "../../auth/AuthContext";

type Props = NativeStackScreenProps<HrStackParamList, "StaffPerformance">;

export default function StaffPerformanceScreen({ route, navigation }: Props): React.ReactElement {
  const { staffProfileId, name } = route.params;
  const go = (screen: "StaffObservations" | "StaffAppraisals" | "StaffConduct" | "StaffCpd") =>
    navigation.navigate(screen, { staffProfileId, name });
  // PM: appraisal:view_all (observations, appraisals, CPD) and conduct:view_all are
  // separate actions now (both were performance:manage).
  const { can } = useAuth();
  const canAppraisal = can("appraisal:view_all");

  return (
    <Screen scroll>
      <H2>{name}</H2>
      {canAppraisal ? (
        <Card onPress={() => go("StaffObservations")}>
          <Body style={{ fontWeight: "700" }}>{STR.hrObservations}</Body>
        </Card>
      ) : null}
      {canAppraisal ? (
        <Card onPress={() => go("StaffAppraisals")}>
          <Body style={{ fontWeight: "700" }}>{STR.hrAppraisals}</Body>
        </Card>
      ) : null}
      {can("conduct:view_all") ? (
        <Card onPress={() => go("StaffConduct")}>
          <Body style={{ fontWeight: "700" }}>{STR.hrConduct}</Body>
          <Muted>{STR.hrConductConfidential}</Muted>
        </Card>
      ) : null}
      {canAppraisal ? (
        <Card onPress={() => go("StaffCpd")}>
          <Body style={{ fontWeight: "700" }}>{STR.hrCpd}</Body>
        </Card>
      ) : null}
    </Screen>
  );
}

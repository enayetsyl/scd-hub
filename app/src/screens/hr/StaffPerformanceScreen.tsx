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

type Props = NativeStackScreenProps<HrStackParamList, "StaffPerformance">;

export default function StaffPerformanceScreen({ route, navigation }: Props): React.ReactElement {
  const { staffProfileId, name } = route.params;
  const go = (screen: "StaffObservations" | "StaffAppraisals" | "StaffConduct" | "StaffCpd") =>
    navigation.navigate(screen, { staffProfileId, name });

  return (
    <Screen scroll>
      <H2>{name}</H2>
      <Card onPress={() => go("StaffObservations")}>
        <Body style={{ fontWeight: "700" }}>{STR.hrObservations}</Body>
      </Card>
      <Card onPress={() => go("StaffAppraisals")}>
        <Body style={{ fontWeight: "700" }}>{STR.hrAppraisals}</Body>
      </Card>
      <Card onPress={() => go("StaffConduct")}>
        <Body style={{ fontWeight: "700" }}>{STR.hrConduct}</Body>
        <Muted>{STR.hrConductConfidential}</Muted>
      </Card>
      <Card onPress={() => go("StaffCpd")}>
        <Body style={{ fontWeight: "700" }}>{STR.hrCpd}</Body>
      </Card>
    </Screen>
  );
}

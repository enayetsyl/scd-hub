/**
 * PerformanceHomeScreen — the performance/conduct/development admin entry
 * (prd-hr §5, performance:manage). Pick a staff member → their performance hub;
 * plus the grievance inbox. Confidential rows (conduct/grievance/appraisal-outcome)
 * are Principal/Office only — this whole surface is gated performance:manage, so
 * supervisors (who hold neither performance perm) never reach it (H5.5).
 *
 * NOTE (flagged, not built): the SUPERVISOR observation-write (H5.2) needs a
 * teacher-readable staff directory to pick the observed staff member; only the
 * manager-gated `staff` roster exists, so in-app a supervisor cannot select the
 * observed staffProfileId. Managers observe here; a supervisor's own authored
 * observations are already readable in My record (PR-1). Adding a teacher-scoped
 * staff-profile directory is a separate server slice.
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { HrStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card } from "../../components/ui";
import { StaffSelect } from "../../components/selects";
import { STAFF_QUERY } from "../../graphql/operations";
import { useQuery } from "urql";
import { STR } from "../../lib/labels";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "PerformanceHome">;

export default function PerformanceHomeScreen({ navigation }: Props): React.ReactElement {
  const [staffId, setStaffId] = React.useState("");
  const [{ data }] = useQuery({ query: STAFF_QUERY, variables: {} });
  const name = (data?.staff ?? []).find((s) => s.id === staffId);

  return (
    <Screen scroll>
      <H2>{STR.hrPerformance}</H2>

      <Muted style={{ marginBottom: space(2) }}>{STR.hrStaffPerformance}</Muted>
      <Card>
        <StaffSelect label={STR.hrStaffMember} value={staffId} onChange={setStaffId} />
      </Card>
      {staffId !== "" ? (
        <Card
          onPress={() => navigation.navigate("StaffPerformance", { staffProfileId: staffId, name: name ? name.nameBn || name.name : STR.hrStaffMember })}
        >
          <Body style={{ fontWeight: "700" }}>{name ? name.nameBn || name.name : STR.hrStaffMember}</Body>
          <Muted>{STR.hrPerformanceSub}</Muted>
        </Card>
      ) : null}

      <Card onPress={() => navigation.navigate("GrievanceInbox")} style={{ marginTop: space(4) }}>
        <Body style={{ fontWeight: "700" }}>{STR.hrGrievances}</Body>
        <Muted>{STR.hrGrievanceConfidential}</Muted>
      </Card>
    </Screen>
  );
}

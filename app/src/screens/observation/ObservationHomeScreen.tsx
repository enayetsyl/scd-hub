/**
 * ObservationHomeScreen (CO app surfaces) — the Classroom Observation tab hub.
 * Role-aware quick links; each sub-screen action is re-gated server-side. Links the
 * caller's permissions don't allow are hidden (the server stays the gate — its Bangla
 * deny still surfaces if a screen is reached).
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen, Card, Body, Button } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { ObservationStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ObservationStackParamList>;

export default function ObservationHomeScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { role, can } = useAuth();
  // PM: one catalogue action per button (classroom_observation:*).
  const canUpload = can("classroom_observation:upload");
  const canViewAll = can("classroom_observation:view_all");
  const canReview = can("classroom_observation:review");
  const canRead = can("classroom_observation:view");
  const canSchedule = can("classroom_observation:schedule");
  const canReports = can("classroom_observation:view_reports");
  const canSettings = can("classroom_observation:settings");

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.obsHomeTitle}</Body>
          <View style={{ marginTop: space(2), gap: space(2) }}>
            {canUpload ? <Button title={STR.obsUploadNav} onPress={() => nav.navigate("UploadObservation")} /> : null}
            {canViewAll ? (
              <Button title={STR.obsAllObservationsNav} variant="secondary" onPress={() => nav.navigate("AllObservations")} />
            ) : null}
            {canRead ? (
              <Button title={STR.obsMyObservationsNav} variant="secondary" onPress={() => nav.navigate("MyObservations")} />
            ) : null}
            {canReview ? (
              <Button title={STR.obsReviewQueueNav} variant="secondary" onPress={() => nav.navigate("ObservationReviewQueue")} />
            ) : null}
            {/* CO-11 (D-#363): the reviews they have already completed — the queue only
                ever shows the open ones. */}
            {canReview ? (
              <Button title={STR.obsMyReviewsNav} variant="secondary" onPress={() => nav.navigate("MyReviewHistory")} />
            ) : null}
            {canRead ? (
              <Button title={STR.obsTrendNav} variant="secondary" onPress={() => nav.navigate("ObservationTrend")} />
            ) : null}
            {canSchedule ? (
              <Button title={STR.obsDueListNav} variant="secondary" onPress={() => nav.navigate("ObservationDueList")} />
            ) : null}
            {/* CO-14 (D-#426): the due list says WHO; this turns that into dated sessions. */}
            {canSchedule ? (
              <Button title={STR.obsRotaTitle} variant="secondary" onPress={() => nav.navigate("ObservationRota")} />
            ) : null}
            {canReports ? (
              <Button title={STR.obsReviewerEffNav} variant="secondary" onPress={() => nav.navigate("ReviewerEffectiveness")} />
            ) : null}
            {canSettings ? (
              <Button title={STR.obsConfigNav} variant="ghost" onPress={() => nav.navigate("ObservationConfig")} />
            ) : null}
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

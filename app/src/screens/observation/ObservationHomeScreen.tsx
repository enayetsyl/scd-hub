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
import { roleHasPermission } from "@scd/shared";
import { Screen, Card, Body, Button } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { ObservationStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ObservationStackParamList>;

export default function ObservationHomeScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { role } = useAuth();
  const canUpload = !!role && roleHasPermission(role, "observation:upload");
  const canReview = !!role && roleHasPermission(role, "observation:review");
  const canRead = !!role && roleHasPermission(role, "observation:read");
  const canManage = !!role && roleHasPermission(role, "observation:manage");

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.obsHomeTitle}</Body>
          <View style={{ marginTop: space(2), gap: space(2) }}>
            {canUpload ? <Button title={STR.obsUploadNav} onPress={() => nav.navigate("UploadObservation")} /> : null}
            {canReview ? (
              <Button title={STR.obsReviewQueueNav} variant="secondary" onPress={() => nav.navigate("ObservationReviewQueue")} />
            ) : null}
            {canRead ? (
              <Button title={STR.obsTrendNav} variant="secondary" onPress={() => nav.navigate("ObservationTrend")} />
            ) : null}
            {canManage ? (
              <Button title={STR.obsDueListNav} variant="secondary" onPress={() => nav.navigate("ObservationDueList")} />
            ) : null}
            {canManage ? (
              <Button title={STR.obsReviewerEffNav} variant="secondary" onPress={() => nav.navigate("ReviewerEffectiveness")} />
            ) : null}
            {canManage ? (
              <Button title={STR.obsConfigNav} variant="ghost" onPress={() => nav.navigate("ObservationConfig")} />
            ) : null}
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

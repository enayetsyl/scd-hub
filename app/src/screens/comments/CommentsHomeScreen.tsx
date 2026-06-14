/**
 * CommentsHomeScreen (CM-6) — the Comments tab hub. Role-aware quick links:
 * "Daily comments" for tracker:read holders (Principal/Teacher), "Parents'
 * meetings" for roster:manage holders (Principal/Office). Both visible to
 * Principal. Every action is re-gated server-side (the server stays the gate).
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { roleHasPermission } from "@scd/shared";
import { Screen, Card, Body, Muted, Button } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { CommentsStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<CommentsStackParamList>;

export default function CommentsHomeScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { role } = useAuth();
  const canComments = !!role && roleHasPermission(role, "tracker:read");
  const canMeetings = !!role && roleHasPermission(role, "roster:manage");

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.cmHomeTitle}</Body>
        </Card>

        {canComments ? (
          <Card onPress={() => nav.navigate("SectionComments")}>
            <Body style={{ fontWeight: "700" }}>{STR.cmDailyComments}</Body>
            <Muted style={{ marginTop: space(1) }}>{STR.cmDailyCommentsSub}</Muted>
            <View style={{ marginTop: space(2) }}>
              <Button title={STR.cmDailyComments} variant="secondary" onPress={() => nav.navigate("SectionComments")} />
            </View>
          </Card>
        ) : null}

        {canMeetings ? (
          <Card onPress={() => nav.navigate("MeetingsList")}>
            <Body style={{ fontWeight: "700" }}>{STR.cmMeetings}</Body>
            <Muted style={{ marginTop: space(1) }}>{STR.cmMeetingsSub}</Muted>
            <View style={{ marginTop: space(2) }}>
              <Button title={STR.cmMeetings} variant="secondary" onPress={() => nav.navigate("MeetingsList")} />
            </View>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

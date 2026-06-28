/**
 * MyObservationsScreen — the observed teacher's own observation history.
 * Shows all observations where the caller is the observed teacher, filtered
 * to REVIEWED / TEACHER_RESPONDED states (the only states visible to the
 * observed teacher server-side). Tapping a row opens ObservationDetailScreen
 * where they can watch the video, read the review, and add their response.
 */
import React, { useMemo } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { TEACHER_CLASSROOM_OBSERVATIONS_QUERY } from "../../graphql/observation";
import { Screen, Card, Body, Muted, Button, Badge, Loader } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR, obsFormLabel, hwSubjectLabel, obsStateLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { ObservationStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ObservationStackParamList>;

export default function MyObservationsScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { user } = useAuth();

  const [obsQ] = useQuery({
    query: TEACHER_CLASSROOM_OBSERVATIONS_QUERY,
    variables: { teacherId: user?.id ?? "" },
    pause: !user?.id,
  });

  // Only show observations that have been reviewed (visible to the teacher)
  const rows = useMemo(
    () =>
      (obsQ.data?.teacherClassroomObservations ?? []).filter(
        (o) => o.state === "REVIEWED" || o.state === "TEACHER_RESPONDED",
      ),
    [obsQ.data],
  );

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        {obsQ.fetching ? (
          <Loader label={STR.loading} />
        ) : rows.length === 0 ? (
          <Card>
            <Muted>{STR.obsNoMyObservations}</Muted>
          </Card>
        ) : (
          rows.map((o) => {
            const title = `${obsFormLabel(o.form)} · ${hwSubjectLabel(o.subject)}`;
            return (
              <Card key={o.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{title}</Body>
                    <Muted>{new Date(o.classDate).toLocaleDateString()}</Muted>
                  </View>
                  <Badge
                    text={obsStateLabel(o.state)}
                    tone={o.state === "TEACHER_RESPONDED" ? "ok" : "brand"}
                  />
                </View>
                <View style={{ marginTop: space(2) }}>
                  <Button
                    title={STR.obsDetailTitle}
                    variant="secondary"
                    onPress={() => nav.navigate("ObservationDetail", { observationId: o.id, title })}
                  />
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * AllObservationsScreen — Principal/Office oversight view of every classroom
 * observation, newest first. Shows teacher name, reviewer name, form, subject,
 * date, and state. Tapping a row opens ObservationDetailScreen where the
 * principal can watch the video, read the reviewer's scores, and see the
 * teacher's response. Requires observation:upload permission.
 */
import React, { useMemo } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { ALL_CLASSROOM_OBSERVATIONS_QUERY } from "../../graphql/observation";
import { TEACHERS_QUERY } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Badge, Loader } from "../../components/ui";
import { STR, obsFormLabel, hwSubjectLabel, obsStateLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { ObservationStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ObservationStackParamList>;

function stateTone(state: string): "ok" | "brand" | "muted" | "danger" {
  if (state === "TEACHER_RESPONDED") return "ok";
  if (state === "REVIEWED") return "brand";
  if (state === "SUPERSEDED") return "muted";
  return "muted";
}

export default function AllObservationsScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();

  const [obsQ] = useQuery({ query: ALL_CLASSROOM_OBSERVATIONS_QUERY, variables: {} });
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY });

  const nameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of teachersQ.data?.teachers ?? []) map[t.id] = t.name;
    return map;
  }, [teachersQ.data]);

  const rows = obsQ.data?.allClassroomObservations ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        {obsQ.fetching ? (
          <Loader label={STR.loading} />
        ) : rows.length === 0 ? (
          <Card>
            <Muted>{STR.obsNoAllObservations}</Muted>
          </Card>
        ) : (
          rows.map((o) => {
            const teacherName = nameById[o.teacherId] ?? o.teacherId;
            const reviewerName = o.observerId ? (nameById[o.observerId] ?? o.observerId) : "—";
            const title = `${obsFormLabel(o.form)} · ${hwSubjectLabel(o.subject)}`;
            return (
              <Card key={o.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{title}</Body>
                    <Muted>{new Date(o.classDate).toLocaleDateString()}</Muted>
                    <Muted>{STR.obsTeacher}: {teacherName}</Muted>
                    <Muted>{STR.obsObserver}: {reviewerName}</Muted>
                  </View>
                  <Badge text={obsStateLabel(o.state)} tone={stateTone(o.state)} />
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

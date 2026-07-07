/**
 * ObservationReviewQueueScreen (CO-1, observation:review) — the signed-in observer's
 * open queue (ASSIGNED observations assigned to them). Each row opens the matching
 * review form (REF-11 or Quran) chosen by the row's `form`.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { MY_OBSERVATION_REVIEW_QUEUE_QUERY } from "../../graphql/observation";
import { TEACHERS_QUERY } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Badge, Loader } from "../../components/ui";
import { STR, obsFormLabel, hwSubjectLabel, obsStateLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { ObservationStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ObservationStackParamList>;

export default function ObservationReviewQueueScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const [q] = useQuery({ query: MY_OBSERVATION_REVIEW_QUEUE_QUERY, variables: {} });
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY });
  const nameById = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of teachersQ.data?.teachers ?? []) m[t.id] = t.name;
    return m;
  }, [teachersQ.data]);
  const rows = q.data?.myObservationReviewQueue ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        {q.fetching ? (
          <Loader label={STR.loading} />
        ) : rows.length === 0 ? (
          <Card>
            <Muted>{STR.obsNoQueue}</Muted>
          </Card>
        ) : (
          rows.map((o) => (
            <Card key={o.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flexShrink: 1 }}>
                  <Body style={{ fontWeight: "700" }}>
                    {obsFormLabel(o.form)} · {hwSubjectLabel(o.subject)}
                  </Body>
                  <Muted>
                    {STR.obsTeacher}: {nameById[o.teacherId] ?? o.teacherId} · {new Date(o.classDate).toLocaleDateString()}
                  </Muted>
                </View>
                <Badge text={obsStateLabel(o.state)} tone="brand" />
              </View>
              <View style={{ marginTop: space(2) }}>
                <Button
                  title={STR.obsReview}
                  variant="secondary"
                  onPress={() =>
                    nav.navigate("ReviewObservation", {
                      observationId: o.id,
                      form: o.form,
                      title: `${obsFormLabel(o.form)} · ${hwSubjectLabel(o.subject)}`,
                    })
                  }
                />
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

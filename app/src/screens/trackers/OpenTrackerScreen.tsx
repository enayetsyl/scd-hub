/**
 * OpenTrackerScreen (S10 / J4.1, J4.3) — pick an assembled set from the selected
 * section, then openTracker (write-scoped) → TrackerEntry. The tracker kind is
 * derived server-side from the set type.
 */
import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { ASSESSMENT_SETS_QUERY, OPEN_TRACKER } from "../../graphql/operations";
import type { TrackersStackParamList } from "../../navigation/types";
import {
  Screen,
  Body,
  Muted,
  Card,
  Badge,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import { ClassSectionDashboard } from "../../components/ClassSectionDashboard";
import { STR, setTypeLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<TrackersStackParamList, "OpenTracker">;

export default function OpenTrackerScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, openTracker] = useMutation(OPEN_TRACKER);

  const [{ data, fetching, error: queryError }, refetch] = useQuery({
    query: ASSESSMENT_SETS_QUERY,
    variables: {
      sectionId: selection.sectionId ?? "",
      classId: selection.classId ?? "",
      status: "assembled",
    },
    pause: !hasSection,
  });

  const sets = data?.assessmentSets ?? [];

  async function onOpen(setId: string): Promise<void> {
    if (busyId) return;
    setBusyId(setId);
    setError(null);
    const res = await openTracker({ setId, sectionId: selection.sectionId! });
    setBusyId(null);
    if (res.error || !res.data?.openTracker) {
      setError(friendlyError(res.error));
      return;
    }
    navigation.replace("TrackerEntry", { trackerId: res.data.openTracker.trackerId });
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <ClassSectionDashboard />
        {hasSection ? <Muted>{STR.pickSet}</Muted> : null}
        {error ? <Notice message={error} tone="danger" /> : null}
      </View>

      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {!hasSection ? (
          <EmptyState message={STR.pickSection} />
        ) : queryError ? (
          <ErrorBanner message={friendlyError(queryError)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
        ) : fetching ? (
          <Loader label={STR.loading} />
        ) : sets.length === 0 ? (
          <EmptyState message={STR.empty} />
        ) : (
          sets.map((s) => (
            <Card key={s.id} onPress={() => onOpen(s.id)}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>{setTypeLabel(s.setType)}</Body>
                <Badge text={busyId === s.id ? STR.saving : STR.open} tone="brand" />
              </View>
              <Muted style={{ marginTop: 4 }}>
                {bnNum(s.basketItems.length)} {STR.questionsWord} · {bnNum(s.totalMarks ?? 0)} {STR.marks}
              </Muted>
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

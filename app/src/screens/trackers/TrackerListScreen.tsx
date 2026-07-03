/**
 * TrackerListScreen (S9 / J4.4) — tracker records for the selected section,
 * filtered by kind (classtest/assignment/homework) and status (open/closed).
 * Open → TrackerEntry; closed → TrackerSummary. "Open tracker" starts a new one.
 */
import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { TRACKER_KINDS } from "@scd/shared";
import { TRACKERS_QUERY } from "../../graphql/operations";
import type { TrackersStackParamList } from "../../navigation/types";
import {
  Screen,
  Body,
  Muted,
  Card,
  Chip,
  ChipRow,
  Badge,
  Button,
  Loader,
  EmptyState,
  ErrorBanner,
} from "../../components/ui";
import { ClassSectionDashboard } from "../../components/ClassSectionDashboard";
import { STR, trackerKindLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<TrackersStackParamList, "TrackerList">;

export default function TrackerListScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const [kind, setKind] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [{ data, fetching, error }, refetch] = useQuery({
    query: TRACKERS_QUERY,
    variables: {
      sectionId: selection.sectionId ?? "",
      classId: selection.classId ?? "",
      trackerKind: kind,
      status,
    },
    pause: !hasSection,
  });

  const trackers = data?.trackers ?? [];

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        {/* The house class-button dashboard (UX-5) replaces the SectionBar→picker flow. */}
        <ClassSectionDashboard />
        {hasSection ? (
          <>
            <Muted>{STR.kind}</Muted>
            <ChipRow>
              <Chip label={STR.all} selected={kind === null} onPress={() => setKind(null)} />
              {TRACKER_KINDS.map((k) => (
                <Chip key={k} label={trackerKindLabel(k)} selected={kind === k} onPress={() => setKind(kind === k ? null : k)} />
              ))}
            </ChipRow>
            <Muted>{STR.status}</Muted>
            <ChipRow>
              <Chip label={STR.all} selected={status === null} onPress={() => setStatus(null)} />
              <Chip label={STR.statusOpen} selected={status === "open"} onPress={() => setStatus(status === "open" ? null : "open")} />
              <Chip label={STR.statusClosed} selected={status === "closed"} onPress={() => setStatus(status === "closed" ? null : "closed")} />
            </ChipRow>
            <Button title={STR.openTracker} onPress={() => navigation.navigate("OpenTracker")} style={{ marginBottom: space(2) }} />
          </>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {!hasSection ? (
          <EmptyState message={STR.pickSection} />
        ) : error ? (
          <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
        ) : fetching ? (
          <Loader label={STR.loading} />
        ) : trackers.length === 0 ? (
          <EmptyState message={STR.empty} />
        ) : (
          trackers.map((t) => {
            const closed = t.status === "closed";
            return (
              <Card
                key={t.id}
                onPress={() =>
                  closed
                    ? navigation.navigate("TrackerSummary", { trackerId: t.id })
                    : navigation.navigate("TrackerEntry", { trackerId: t.id })
                }
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ fontWeight: "700" }}>{trackerKindLabel(t.trackerKind)}</Body>
                  <Badge text={closed ? STR.statusClosed : STR.statusOpen} tone={closed ? "muted" : "ok"} />
                </View>
                <Muted style={{ marginTop: 4 }}>
                  {bnNum(t.entries.length)} {STR.trackerEntry}
                </Muted>
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

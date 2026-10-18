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
import { TRACKERS_PAGE_QUERY } from "../../graphql/operations";
import { Pager } from "../../components/Pager";
import { usePageState, PAGE_SIZE } from "../../lib/paging";
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

  // D-#761: one tracker per set, forever — page them on the server (filters reset to page 1).
  const [page, setPage] = usePageState(`${selection.sectionId ?? ""}|${kind ?? ""}|${status ?? ""}`);
  const [{ data, fetching, error }, refetch] = useQuery({
    query: TRACKERS_PAGE_QUERY,
    variables: {
      sectionId: selection.sectionId ?? "",
      classId: selection.classId ?? "",
      trackerKind: kind,
      status,
      page,
      pageSize: PAGE_SIZE,
    },
    pause: !hasSection,
  });

  const trackers = data?.trackersPage.rows ?? [];

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
        {hasSection && !error && !fetching ? (
          <Pager page={page} pageSize={PAGE_SIZE} total={data?.trackersPage.total ?? 0} onPage={setPage} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

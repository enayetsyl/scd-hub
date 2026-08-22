/**
 * TeachingNoteOpenCommentsScreen (TN-2, prd-teaching-notes) — the Principal's
 * cross-subject "still outstanding" list.
 *
 * This screen is the reason comments carry a status at all. Without it the
 * feedback is only ever visible to whoever happens to open that one file, and
 * a suggestion nobody has to answer is a suggestion that gets skipped in a busy
 * week. Here every open suggestion in the whole library is one list, each row
 * naming the class, subject and note so it can be acted on.
 */
import React from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { OPEN_TEACHING_NOTE_COMMENTS } from "../../graphql/teachingNotes";
import type { TeachingNotesStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { teachingNoteKindLabel } from "../../lib/teachingNotes";
import { STR, bnNum, classLevelLabel, routineSubjectLabel, isoDateLabel } from "../../lib/labels";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<TeachingNotesStackParamList, "TeachingNoteOpenComments">;

export default function TeachingNoteOpenCommentsScreen({
  navigation,
}: Props): React.ReactElement {
  const [q, refetch] = useQuery({ query: OPEN_TEACHING_NOTE_COMMENTS });
  const rows = q.data?.openTeachingNoteComments ?? [];

  const retry = (): void => refetch({ requestPolicy: "network-only" });
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, retry);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <QueryGate
          results={[q]}
          onRetry={retry}
          isEmpty={!q.fetching && rows.length === 0}
          empty={<EmptyState message={STR.tnOpenCommentsEmpty} />}
          loaderLabel={STR.loading}
        >
          {rows.map((c) => (
            <Card key={c.id}>
              <Pressable
                onPress={() =>
                  navigation.navigate("TeachingNoteDoc", { noteId: c.noteId, title: c.noteTitle })
                }
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: space(2),
                    marginBottom: space(1),
                  }}
                >
                  <Badge text={classLevelLabel(c.classLevel)} tone="brand" />
                  <Badge text={routineSubjectLabel(c.subject)} tone="brand" />
                  <Badge text={teachingNoteKindLabel(c.kind)} tone="muted" />
                  {c.staleForCurrentVersion ? (
                    <Badge
                      text={STR.tnWrittenOn.replace("{v}", bnNum(c.versionSeen))}
                      tone="warn"
                    />
                  ) : null}
                </View>
                <Body style={{ fontWeight: "600" }}>{c.noteTitle}</Body>
                {c.anchor ? <Muted>▸ {c.anchor}</Muted> : null}
                <Body style={{ marginTop: space(1) }}>{c.bodyBn}</Body>
                <Muted style={{ marginTop: space(1) }}>
                  {c.authorName ?? "—"} · {isoDateLabel(c.createdAt)}
                </Muted>
              </Pressable>
            </Card>
          ))}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}

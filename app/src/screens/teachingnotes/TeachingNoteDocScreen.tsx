/**
 * TeachingNoteDocScreen (TN-1, prd-teaching-notes) — one note: its markdown
 * rendered inline (or the binary opened through GET /files/:id, server in the
 * middle), the retained version history, and — from TN-2 — the improvement
 * comment thread.
 *
 * The version strip is not decoration. Superseded rows are never deleted, so
 * "what did v1 say before the feedback landed?" stays answerable beside the
 * current text; that is the whole reason replacement keeps history.
 */
import React, { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  TEACHING_NOTE,
  TEACHING_NOTE_VERSIONS,
  SEND_TEACHING_NOTE_TO_PRINT,
} from "../../graphql/teachingNotes";
import type { TeachingNotesStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Badge,
  Button,
  EmptyState,
  Notice,
} from "../../components/ui";
import Markdown from "../../components/Markdown";
import { QueryGate } from "../../components/QueryGate";
import TeachingNoteCommentThread from "./TeachingNoteCommentThread";
import SendToPrintCard from "../../components/SendToPrintCard";
import { useAuth } from "../../auth/AuthContext";
import { openStoredFile, FileUploadError } from "../../lib/files";
import { teachingNoteKindLabel } from "../../lib/teachingNotes";
import { STR, bnNum, classLevelLabel, routineSubjectLabel, isoDateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<TeachingNotesStackParamList, "TeachingNoteDoc">;

export default function TeachingNoteDocScreen({
  route,
  navigation,
}: Props): React.ReactElement {
  const { noteId } = route.params;
  const { can, user } = useAuth();
  const canUpload = can("roster:manage");

  const [noteQ, refetchNote] = useQuery({ query: TEACHING_NOTE, variables: { id: noteId } });
  const note = noteQ.data?.teachingNote ?? null;

  const [versionsQ, refetchVersions] = useQuery({
    query: TEACHING_NOTE_VERSIONS,
    variables: { id: noteId },
  });
  const versions = versionsQ.data?.teachingNoteVersions ?? [];

  const [, sendToPrint] = useMutation(SEND_TEACHING_NOTE_TO_PRINT);
  const [openBusy, setOpenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBinary = note !== null && (note.format ?? "MD") !== "MD";
  // A DOCX previews through its converted PDF; a PDF is already the preview.
  const previewFileId = note ? note.pdfFileId ?? (note.format === "PDF" ? note.fileId : null) : null;

  const onOpenFile = useCallback(
    async (fileId: string | null): Promise<void> => {
      if (openBusy || !fileId) return;
      setOpenBusy(true);
      setError(null);
      try {
        await openStoredFile(fileId);
      } catch (e) {
        setError(e instanceof FileUploadError ? e.message : STR.errGeneric);
      } finally {
        setOpenBusy(false);
      }
    },
    [openBusy],
  );

  const retry = (): void => {
    refetchNote({ requestPolicy: "network-only" });
    refetchVersions({ requestPolicy: "network-only" });
  };
  const { refreshing, onRefresh } = usePullRefresh(noteQ.fetching || versionsQ.fetching, retry);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <QueryGate results={[noteQ]} onRetry={retry} loaderLabel={STR.loading}>
          {note ? (
            <>
              {error ? <Notice message={error} tone="danger" /> : null}

              <H2>{note.title}</H2>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: space(2),
                  marginBottom: space(3),
                }}
              >
                <Badge text={classLevelLabel(note.classLevel)} tone="brand" />
                <Badge text={routineSubjectLabel(note.subject)} tone="brand" />
                <Badge text={teachingNoteKindLabel(note.kind)} tone="muted" />
                <Badge text={`v${bnNum(note.version)}`} tone="ok" />
                {isBinary ? <Badge text={note.format} tone="info" /> : null}
              </View>
              <Muted style={{ marginBottom: space(3) }}>
                {STR.tnUploadedBy}: {note.uploadedByName ?? "—"} ·{" "}
                {note.uploadedAt ? isoDateLabel(note.uploadedAt) : "—"}
              </Muted>

              {canUpload ? (
                <View style={{ marginBottom: space(3) }}>
                  <Button
                    title={`⬆ ${STR.tnNewVersion}`}
                    variant="secondary"
                    onPress={() =>
                      navigation.navigate("TeachingNoteUpload", {
                        classLevel: note.classLevel,
                        subject: note.subject,
                        kind: note.kind,
                        seq: note.seq,
                      })
                    }
                  />
                </View>
              ) : null}

              {isBinary ? (
                <Card>
                  <Body style={{ marginBottom: space(2) }}>{note.fileName ?? note.title}</Body>
                  <Button
                    title={STR.tnOpenFile}
                    variant="secondary"
                    disabled={openBusy}
                    onPress={() => void onOpenFile(previewFileId ?? note.fileId)}
                  />
                </Card>
              ) : (
                <Card>
                  <Markdown source={note.contentMd ?? ""} />
                </Card>
              )}

              <Card>
                <SendToPrintCard
                  successMessage={STR.tnSentToPrint}
                  onSend={async (opts) => {
                    const res = await sendToPrint({ id: note.id, ...opts });
                    return res.error || !res.data?.sendTeachingNoteToPrint
                      ? friendlyError(res.error)
                      : null;
                  }}
                />
              </Card>

              <TeachingNoteCommentThread
                noteId={note.id}
                uploaderIsMe={note.uploadedById === user?.id}
                onCountsChanged={() => refetchNote({ requestPolicy: "network-only" })}
              />

              {versions.length > 1 ? (
                <Card>
                  <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>
                    {STR.tnVersionHistory}
                  </Muted>
                  {versions.map((v) => {
                    const isCurrent = v.id === note.id;
                    return (
                      <Pressable
                        key={v.id}
                        disabled={isCurrent}
                        onPress={() =>
                          navigation.push("TeachingNoteDoc", { noteId: v.id, title: v.title })
                        }
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          paddingVertical: space(2),
                        }}
                      >
                        <View style={{ flex: 1, marginRight: space(2) }}>
                          <Body style={{ fontWeight: isCurrent ? "700" : "400" }}>
                            {STR.tnVersion} v{bnNum(v.version)}
                          </Body>
                          <Muted>
                            {v.uploadedByName ?? "—"} ·{" "}
                            {v.uploadedAt ? isoDateLabel(v.uploadedAt) : "—"}
                          </Muted>
                        </View>
                        <Badge
                          text={isCurrent ? STR.tnCurrent : STR.tnReplaced}
                          tone={isCurrent ? "ok" : "muted"}
                        />
                      </Pressable>
                    );
                  })}
                </Card>
              ) : null}
            </>
          ) : (
            <EmptyState message={STR.tnEmpty} />
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}

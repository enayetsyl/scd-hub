/**
 * CtQuestionQueueScreen (owner ask 2026-07-20) — the Office/Principal work
 * queue for teacher question requests. Work-needed first: upload the produced
 * paper (classtest_question file) + optional note and send it for the teacher's
 * review; a CHANGES_REQUESTED card shows the teacher's comment to answer. After
 * the teacher confirms, the card goes read-only; printing arrives via the
 * standard print queue as usual.
 */
import React, { useState } from "react";
import { ScrollView, View, RefreshControl } from "react-native";
import { useQuery, useMutation } from "urql";
import {
  CT_QUESTION_QUEUE,
  SEND_CT_QUESTION_FOR_REVIEW,
} from "../../graphql/classTest";
import { Screen, Body, Muted, Card, Badge, Button, Field, Notice, Loader, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { pickAndUploadClassTestPaper, openStoredFile, FILE_VIEW_SUPPORTED, FileUploadError } from "../../lib/files";
import { STR, hwSubjectLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";
import { ctQuestionStatusBadge, CtQuestionMeta } from "./MyCtQuestionsScreen";

/** Statuses the office still owes work on. */
const OFFICE_ACTIONABLE = new Set(["REQUESTED", "CHANGES_REQUESTED"]);

export default function CtQuestionQueueScreen(): React.ReactElement {
  const [q, refetch] = useQuery({ query: CT_QUESTION_QUEUE });
  const [, send] = useMutation(SEND_CT_QUESTION_FOR_REVIEW);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<{ fileId: string; name: string } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const rows = q.data?.ctQuestionQueue ?? [];
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, () =>
    refetch({ requestPolicy: "network-only" }),
  );

  async function onPickFile(id: string): Promise<void> {
    setError(null);
    try {
      const up = await pickAndUploadClassTestPaper();
      if (!up) return;
      setUploadFor(id);
      setUploaded({ fileId: up.fileId, name: up.originalName });
    } catch (e) {
      setError(e instanceof FileUploadError ? e.message : STR.errGeneric);
    }
  }

  async function onSend(id: string): Promise<void> {
    if (!uploaded || uploadFor !== id) return;
    setError(null);
    setOk(null);
    setBusyId(id);
    const res = await send({ id, fileId: uploaded.fileId, note: note.trim() === "" ? null : note.trim() });
    setBusyId(null);
    if (res.error || !res.data?.sendCtQuestionForReview) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.cqStatusInReview);
    setUploadFor(null);
    setUploaded(null);
    setNote("");
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          {q.fetching && rows.length === 0 ? (
            <Loader label={STR.loading} />
          ) : rows.length === 0 ? (
            <EmptyState message={STR.cqNoRequests} />
          ) : (
            rows.map((r) => {
              const badge = ctQuestionStatusBadge(r.status);
              const actionable = OFFICE_ACTIONABLE.has(r.status);
              const uploadingHere = uploadFor === r.id && uploaded;
              const lastRound = r.rounds[r.rounds.length - 1];
              return (
                <Card key={r.id}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Body style={{ fontWeight: "700", flexShrink: 1 }}>
                      {hwSubjectLabel(r.subject)} · {STR.class} {bnNum(r.classLevel)}
                      {r.requesterName ? ` — ${r.requesterName}` : ""}
                    </Body>
                    <Badge text={badge.text} tone={badge.tone} />
                  </View>
                  <CtQuestionMeta r={r} />

                  {/* The teacher's change comment is the office's work order. */}
                  {r.status === "CHANGES_REQUESTED" && lastRound?.teacherComment ? (
                    <Notice message={`${STR.cqTeacherComment}: ${lastRound.teacherComment}`} tone="warn" />
                  ) : null}

                  {r.currentFileId && FILE_VIEW_SUPPORTED ? (
                    <Button
                      title={`📄 ${STR.cqViewQuestion}`}
                      variant="ghost"
                      onPress={() => void openStoredFile(r.currentFileId!)}
                      style={{ marginTop: space(1) }}
                    />
                  ) : null}

                  {actionable ? (
                    <View style={{ marginTop: space(2) }}>
                      <Button
                        title={uploadingHere ? `${STR.cqUploaded}: ${uploaded!.name}` : STR.cqUploadPaper}
                        variant="secondary"
                        onPress={() => void onPickFile(r.id)}
                        disabled={busyId !== null}
                      />
                      {uploadingHere ? (
                        <>
                          <Field label={STR.cqOfficeNote} value={note} onChangeText={setNote} />
                          <Button
                            title={STR.cqSendForReview}
                            onPress={() => void onSend(r.id)}
                            loading={busyId === r.id}
                            disabled={busyId !== null}
                            style={{ marginTop: space(1) }}
                          />
                        </>
                      ) : null}
                    </View>
                  ) : null}
                </Card>
              );
            })
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}

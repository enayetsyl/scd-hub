/**
 * CtQuestionQueueScreen (owner ask 2026-07-20) — the Office/Principal work
 * queue for teacher question requests. Work-needed first: upload the produced
 * paper (classtest_question file) + optional note and send it for the teacher's
 * review; a CHANGES_REQUESTED card shows the teacher's comment to answer. After
 * the teacher confirms, the card goes read-only; printing arrives via the
 * standard print queue as usual.
 *
 * Owner ask 2026-09-15 — every card carries a DELETE. It is the office's verb,
 * not the teacher's: a teacher withdraws their own request (status CANCELLED,
 * the row stays and is badged), while the office removes a row that should not
 * exist at all (active:false, it leaves both lists). Refused server-side while a
 * live ClassTest hangs off the request — cancel the print job first.
 */
import React, { useState, useRef, useCallback } from "react";
import { ScrollView, View, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import {
  CT_QUESTION_QUEUE,
  SEND_CT_QUESTION_FOR_REVIEW,
  DELETE_CT_QUESTION_REQUEST,
} from "../../graphql/classTest";
import { useConfirm } from "../../state/ConfirmContext";
import { Screen, Body, Muted, Card, Badge, Button, Field, Notice, Loader, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import {
  pickAndUploadClassTestPaper,
  uploadClassTestPaperWebFile,
  openStoredFile,
  FILE_VIEW_SUPPORTED,
  FileUploadError,
  type UploadedFile,
} from "../../lib/files";
import { UploadDropZone } from "../../components/UploadDropZone";
import { useFileOpen } from "../../lib/useFileOpen";
import { STR, hwSubjectLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";
import { ctQuestionStatusBadge, CtQuestionMeta } from "./MyCtQuestionsScreen";

/** Statuses the office still owes work on. */
const OFFICE_ACTIONABLE = new Set(["REQUESTED", "CHANGES_REQUESTED"]);

export default function CtQuestionQueueScreen(): React.ReactElement {
  const { confirmAction } = useConfirm();
  const [q, refetch] = useQuery({ query: CT_QUESTION_QUEUE });
  const [, send] = useMutation(SEND_CT_QUESTION_FOR_REVIEW);
  const [, deleteRequest] = useMutation(DELETE_CT_QUESTION_REQUEST);

  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<{ fileId: string; name: string } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const rows = q.data?.ctQuestionQueue ?? [];
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, () =>
    refetch({ requestPolicy: "network-only" }),
  );
  const { openingId, runOpen } = useFileOpen();

  // Fresh teacher requests must appear on return to this screen (owner find).
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );

  // One post-upload path for both entry points (pick button + web drop zone):
  // same per-card busy state, same staged-file result, same error notice.
  async function runUpload(id: string, upload: () => Promise<UploadedFile | null>): Promise<void> {
    if (uploadingId) return;
    setError(null);
    setUploadingId(id);
    try {
      const up = await upload();
      if (!up) return;
      setUploadFor(id);
      setUploaded({ fileId: up.fileId, name: up.originalName });
    } catch (e) {
      setError(e instanceof FileUploadError ? e.message : STR.errGeneric);
    } finally {
      setUploadingId(null);
    }
  }
  const onPickFile = (id: string): Promise<void> => runUpload(id, pickAndUploadClassTestPaper);
  // Single-paper flow: a multi-file drop takes the first file, extras are ignored.
  const onDropFile = (id: string, files: File[]): Promise<void> =>
    runUpload(id, () => uploadClassTestPaperWebFile(files[0]));

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

  async function onDelete(id: string): Promise<void> {
    setError(null);
    setOk(null);
    if (
      !(await confirmAction({
        title: STR.cqDeleteConfirmTitle,
        message: STR.cqDeleteConfirmBody,
        confirmLabel: STR.cqDelete,
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusyId(id);
    const res = await deleteRequest({ id, reason: deleteReason.trim() || null });
    setBusyId(null);
    if (res.error || !res.data?.deleteCtQuestionRequest) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.cqDeletedOk);
    setDeleteFor(null);
    setDeleteReason("");
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

                  {/* A withdrawal the office may be mid-way through working on — so it is
                      stated here, not left to be inferred from a card that stopped moving. */}
                  {r.status === "CANCELLED" ? (
                    <Notice
                      message={r.cancelReason ? `${STR.cqCancelledBy} — ${r.cancelReason}` : STR.cqCancelledBy}
                      tone="danger"
                    />
                  ) : null}

                  {r.currentFileId && FILE_VIEW_SUPPORTED ? (
                    <Button
                      title={`📄 ${STR.cqViewQuestion}`}
                      variant="ghost"
                      loading={openingId === r.currentFileId}
                      disabled={!!openingId}
                      onPress={() => void runOpen(r.currentFileId!, () => openStoredFile(r.currentFileId!))}
                      style={{ marginTop: space(1) }}
                    />
                  ) : null}

                  {actionable ? (
                    <View style={{ marginTop: space(2) }}>
                      <UploadDropZone
                        onFiles={(files) => void onDropFile(r.id, files)}
                        disabled={busyId !== null || uploadingId !== null}
                      >
                        <Button
                          title={uploadingHere ? `${STR.cqUploaded}: ${uploaded!.name}` : STR.cqUploadPaper}
                          variant="secondary"
                          loading={uploadingId === r.id}
                          onPress={() => void onPickFile(r.id)}
                          disabled={busyId !== null || uploadingId !== null}
                        />
                      </UploadDropZone>
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

                  {/* Remove a row that should never have existed. Soft: the audit trail
                      and the uploaded papers survive, and the teacher is told. */}
                  {deleteFor === r.id ? (
                    <View style={{ marginTop: space(2) }}>
                      <Field
                        label={STR.cqDeleteReason}
                        value={deleteReason}
                        onChangeText={setDeleteReason}
                        multiline
                      />
                      <View style={{ flexDirection: "row", gap: space(2), marginTop: space(1) }}>
                        <View style={{ flex: 1 }}>
                          <Button
                            title={STR.cqDeleteSubmit}
                            variant="danger"
                            onPress={() => void onDelete(r.id)}
                            loading={busyId === r.id}
                            disabled={busyId !== null}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Button
                            title={STR.cqEditCancel}
                            variant="ghost"
                            onPress={() => {
                              setDeleteFor(null);
                              setDeleteReason("");
                            }}
                            disabled={busyId !== null}
                          />
                        </View>
                      </View>
                    </View>
                  ) : (
                    <Button
                      title={STR.cqDelete}
                      variant="ghost"
                      onPress={() => {
                        setDeleteFor(r.id);
                        setDeleteReason("");
                      }}
                      disabled={busyId !== null || uploadingId !== null}
                      style={{ marginTop: space(2) }}
                    />
                  )}
                </Card>
              );
            })
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}

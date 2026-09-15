/**
 * MyCtQuestionsScreen (owner ask 2026-07-20) — the teacher's question requests:
 * review the office's uploaded paper (view → approve-and-lock, or ask for
 * changes with a mandatory comment), and once CONFIRMED send it to print from
 * the same card (colour/sides/copies → the standard class-test print path).
 *
 * Owner ask 2026-09-15 — the two ways out of a mistake, both on this card:
 * CORRECT the details (chapter / marks / duration / exam date) while the office
 * still owes a paper, or WITHDRAW the request outright before it is confirmed.
 * A withdrawn card stays in the list, badged, with its reason — it is the
 * teacher's own record, and the office sees the same thing on their queue.
 */
import React, { useState, useRef, useCallback } from "react";
import { ScrollView, View, RefreshControl } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  PRINT_COLOURS,
  PRINT_COLOUR_LABELS_EN,
  PRINT_SIDES,
  PRINT_SIDES_LABELS_EN,
} from "@scd/shared";
import {
  MY_CT_QUESTION_REQUESTS,
  REVIEW_CT_QUESTION,
  REQUEST_CT_QUESTION_PRINT,
  EDIT_CT_QUESTION_REQUEST,
  CANCEL_CT_QUESTION_REQUEST,
  type CtQuestionRequestT,
} from "../../graphql/classTest";
import { Screen, Body, Muted, Card, Badge, Button, Field, Chip, Select, Notice, Loader, EmptyState } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { QueryGate } from "../../components/QueryGate";
import { useConfirm } from "../../state/ConfirmContext";
import { openStoredFile, FILE_VIEW_SUPPORTED } from "../../lib/files";
import { useFileOpen } from "../../lib/useFileOpen";
import { STR, hwSubjectLabel, bnNum, isoDateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ClassTestStackParamList>;

export function ctQuestionStatusBadge(
  status: string,
): { text: string; tone: "warn" | "ok" | "info" | "brand" | "muted" | "danger" } {
  switch (status) {
    case "REQUESTED":
      return { text: STR.cqStatusRequested, tone: "muted" };
    case "IN_REVIEW":
      return { text: STR.cqStatusInReview, tone: "warn" };
    case "CHANGES_REQUESTED":
      return { text: STR.cqStatusChanges, tone: "info" };
    case "CONFIRMED":
      return { text: STR.cqStatusConfirmed, tone: "ok" };
    case "PRINT_REQUESTED":
      return { text: STR.cqStatusPrintRequested, tone: "brand" };
    case "CANCELLED":
      return { text: STR.cqStatusCancelled, tone: "danger" };
    default:
      return { text: status, tone: "muted" };
  }
}

/**
 * Which affordance to OFFER. These mirror `CT_QUESTION_EDITABLE` /
 * `CT_QUESTION_CANCELLABLE` in the server model, which cannot be imported here —
 * the statuses are module-local by design (no vocab twin), and promoting them to
 * `/shared` to share two arrays would drag the whole contract-sync procedure
 * along with them. The server stays the authority: if these ever drift, the
 * button is offered and the mutation refuses it with its own Bangla message,
 * which is the safe direction for the drift to run.
 */
/** The office has not started the paper yet, so the details are still the teacher's to fix. */
const EDITABLE = new Set(["REQUESTED", "CHANGES_REQUESTED"]);
/** Nothing is confirmed or at the press yet, so the request is still the teacher's to withdraw. */
const CANCELLABLE = new Set(["REQUESTED", "IN_REVIEW", "CHANGES_REQUESTED"]);

/**
 * Seed the edit form's date picker from the stored ISO value by SLICING, not by
 * reading local calendar parts. The server stores this field at UTC midnight and
 * re-parses whatever string we send back, so the slice round-trips exactly —
 * a local-derived key would shift the exam by a day for any negative UTC offset
 * (the D-#545 failure, in the other direction).
 */
function examDateInput(iso: string): string {
  return iso.slice(0, 10);
}

export function CtQuestionMeta({ r }: { r: CtQuestionRequestT }): React.ReactElement {
  return (
    <Muted style={{ marginTop: 2 }}>
      {STR.cqChapter}: {r.chapter} · {STR.ctTestNumber} {bnNum(r.testNumber)} · {STR.ctTotalMarks}{" "}
      {bnNum(r.totalMarks)} · {bnNum(r.durationMinutes)} {STR.gpMinutes} ·{" "}
      {isoDateLabel(r.examDate)}
    </Muted>
  );
}

export default function MyCtQuestionsScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { confirmAction } = useConfirm();
  const [q, refetch] = useQuery({ query: MY_CT_QUESTION_REQUESTS });
  const [, review] = useMutation(REVIEW_CT_QUESTION);
  const [, sendPrint] = useMutation(REQUEST_CT_QUESTION_PRINT);
  const [, editRequest] = useMutation(EDIT_CT_QUESTION_REQUEST);
  const [, cancelRequest] = useMutation(CANCEL_CT_QUESTION_REQUEST);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [commentFor, setCommentFor] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [printFor, setPrintFor] = useState<string | null>(null);
  // The correction form, seeded from the row it opens on.
  const [editFor, setEditFor] = useState<string | null>(null);
  const [editChapter, setEditChapter] = useState("");
  const [editMarks, setEditMarks] = useState("");
  const [editDuration, setEditDuration] = useState("");
  const [editExamDate, setEditExamDate] = useState("");
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [colour, setColour] = useState<string | null>(null);
  const [sides, setSides] = useState<string | null>(null);
  const [copiesMode, setCopiesMode] = useState<"FIXED" | "CLASS_PRESENT">("CLASS_PRESENT");
  const [copies, setCopies] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const rows = q.data?.myCtQuestionRequests ?? [];
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, () =>
    refetch({ requestPolicy: "network-only" }),
  );
  const { openingId, runOpen } = useFileOpen();

  // A fresh request filed on the form screen must appear on return (owner find).
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

  async function onReview(id: string, approve: boolean, text?: string): Promise<void> {
    setError(null);
    setOk(null);
    if (approve && !(await confirmAction({ title: STR.cqApproveConfirmTitle, message: STR.cqApproveConfirmBody, confirmLabel: STR.cqApprove }))) {
      return;
    }
    setBusyId(id);
    const res = await review({ id, approve, comment: text ?? null });
    setBusyId(null);
    if (res.error || !res.data?.reviewCtQuestion) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(approve ? STR.cqStatusConfirmed : STR.cqStatusChanges);
    setCommentFor(null);
    setComment("");
    refetch({ requestPolicy: "network-only" });
  }

  function openEdit(r: CtQuestionRequestT): void {
    setCancelFor(null);
    setEditFor(r.id);
    setEditChapter(r.chapter);
    setEditMarks(String(r.totalMarks));
    setEditDuration(String(r.durationMinutes));
    setEditExamDate(examDateInput(r.examDate));
  }

  const editValid =
    editChapter.trim() !== "" &&
    /^\d+$/.test(editMarks.trim()) &&
    /^\d+$/.test(editDuration.trim()) &&
    editExamDate.trim() !== "";

  async function onSaveEdit(id: string): Promise<void> {
    if (!editValid) return;
    setError(null);
    setOk(null);
    setBusyId(id);
    const res = await editRequest({
      id,
      chapter: editChapter.trim(),
      totalMarks: parseInt(editMarks, 10),
      durationMinutes: parseInt(editDuration, 10),
      examDate: editExamDate,
    });
    setBusyId(null);
    if (res.error || !res.data?.editCtQuestionRequest) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.cqEditedOk);
    setEditFor(null);
    refetch({ requestPolicy: "network-only" });
  }

  async function onCancelRequest(id: string): Promise<void> {
    setError(null);
    setOk(null);
    if (
      !(await confirmAction({
        title: STR.cqCancelConfirmTitle,
        message: STR.cqCancelConfirmBody,
        confirmLabel: STR.cqCancel,
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusyId(id);
    const res = await cancelRequest({ id, reason: cancelReason.trim() || null });
    setBusyId(null);
    if (res.error || !res.data?.cancelCtQuestionRequest) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.cqCancelledOk);
    setCancelFor(null);
    setCancelReason("");
    refetch({ requestPolicy: "network-only" });
  }

  async function onSendPrint(id: string): Promise<void> {
    if (!colour || !sides) return;
    setError(null);
    setOk(null);
    setBusyId(id);
    const res = await sendPrint({
      id,
      colour,
      sides,
      copiesMode,
      copies: copiesMode === "FIXED" ? parseInt(copies || "1", 10) : null,
    });
    setBusyId(null);
    if (res.error || !res.data?.requestCtQuestionPrint) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(`${STR.cqSentToPrint} · ${res.data.requestCtQuestionPrint.ctId}`);
    setPrintFor(null);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Button title={STR.cqNewRequest} onPress={() => nav.navigate("CtQuestionRequest")} />
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
              const commenting = commentFor === r.id;
              const printing = printFor === r.id;
              const editing = editFor === r.id;
              const cancelling = cancelFor === r.id;
              const lastRound = r.rounds[r.rounds.length - 1];
              return (
                <Card key={r.id}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Body style={{ fontWeight: "700", flexShrink: 1 }}>
                      {hwSubjectLabel(r.subject)} · {STR.class} {bnNum(r.classLevel)}
                    </Body>
                    <Badge text={badge.text} tone={badge.tone} />
                  </View>
                  <CtQuestionMeta r={r} />

                  {/* A withdrawn request keeps its reason on the card — the teacher's
                      own record of why, and what the office was told. */}
                  {r.status === "CANCELLED" ? (
                    <Notice
                      message={r.cancelReason ? `${STR.cqStatusCancelled}: ${r.cancelReason}` : STR.cqCancelledOk}
                      tone="danger"
                    />
                  ) : null}

                  {r.currentFileId && FILE_VIEW_SUPPORTED ? (
                    <Button
                      title={`📄 ${STR.cqViewQuestion}`}
                      variant="secondary"
                      loading={openingId === r.currentFileId}
                      disabled={!!openingId}
                      onPress={() => void runOpen(r.currentFileId!, () => openStoredFile(r.currentFileId!))}
                      style={{ marginTop: space(2) }}
                    />
                  ) : null}
                  {lastRound?.note ? <Muted style={{ marginTop: space(1) }}>💬 {lastRound.note}</Muted> : null}

                  {/* Correct a mistake in the details, while the office still owes a paper. */}
                  {EDITABLE.has(r.status) && editing ? (
                    <View style={{ marginTop: space(2) }}>
                      <Field label={STR.cqChapter} value={editChapter} onChangeText={setEditChapter} />
                      <Field
                        label={STR.ctTotalMarks}
                        value={editMarks}
                        onChangeText={setEditMarks}
                        keyboardType="number-pad"
                      />
                      <Field
                        label={STR.cqDuration}
                        value={editDuration}
                        onChangeText={setEditDuration}
                        keyboardType="number-pad"
                      />
                      <DateField label={STR.ctExamDate} value={editExamDate} onChange={setEditExamDate} />
                      <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                        <View style={{ flex: 1 }}>
                          <Button
                            title={STR.cqEditSave}
                            onPress={() => void onSaveEdit(r.id)}
                            loading={busyId === r.id}
                            disabled={busyId !== null || !editValid}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Button
                            title={STR.cqEditCancel}
                            variant="ghost"
                            onPress={() => setEditFor(null)}
                            disabled={busyId !== null}
                          />
                        </View>
                      </View>
                    </View>
                  ) : null}

                  {/* Withdraw. The reason is optional but reaches the office with the notice. */}
                  {cancelling ? (
                    <View style={{ marginTop: space(2) }}>
                      <Field label={STR.cqCancelReason} value={cancelReason} onChangeText={setCancelReason} multiline />
                      <View style={{ flexDirection: "row", gap: space(2), marginTop: space(1) }}>
                        <View style={{ flex: 1 }}>
                          <Button
                            title={STR.cqCancelSubmit}
                            variant="danger"
                            onPress={() => void onCancelRequest(r.id)}
                            loading={busyId === r.id}
                            disabled={busyId !== null}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Button
                            title={STR.cqEditCancel}
                            variant="ghost"
                            onPress={() => {
                              setCancelFor(null);
                              setCancelReason("");
                            }}
                            disabled={busyId !== null}
                          />
                        </View>
                      </View>
                    </View>
                  ) : null}

                  {r.status === "IN_REVIEW" ? (
                    <>
                      <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                        <View style={{ flex: 1 }}>
                          <Button
                            title={STR.cqApprove}
                            onPress={() => void onReview(r.id, true)}
                            loading={busyId === r.id && !commenting}
                            disabled={busyId !== null}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Button
                            title={STR.cqAskChange}
                            variant="danger"
                            onPress={() => {
                              setCommentFor(commenting ? null : r.id);
                              setComment("");
                            }}
                            disabled={busyId !== null}
                          />
                        </View>
                      </View>
                      {commenting ? (
                        <View style={{ marginTop: space(2) }}>
                          <Field label={STR.cqChangeComment} value={comment} onChangeText={setComment} multiline />
                          <Button
                            title={STR.cqSubmitChange}
                            onPress={() => void onReview(r.id, false, comment)}
                            loading={busyId === r.id}
                            disabled={busyId !== null || comment.trim() === ""}
                            style={{ marginTop: space(1) }}
                          />
                        </View>
                      ) : null}
                    </>
                  ) : null}

                  {r.status === "CONFIRMED" ? (
                    <View style={{ marginTop: space(2) }}>
                      {!printing ? (
                        <Button title={STR.cqSendToPrint} onPress={() => setPrintFor(r.id)} disabled={busyId !== null} />
                      ) : (
                        <>
                          <Select
                            label={STR.prColour}
                            value={colour}
                            options={PRINT_COLOURS.map((c) => ({ label: PRINT_COLOUR_LABELS_EN[c], value: c }))}
                            onChange={setColour}
                            placeholder={STR.prColour}
                          />
                          <Select
                            label={STR.prSides}
                            value={sides}
                            options={PRINT_SIDES.map((s) => ({ label: PRINT_SIDES_LABELS_EN[s], value: s }))}
                            onChange={setSides}
                            placeholder={STR.prSides}
                          />
                          <View style={{ flexDirection: "row", gap: space(2), marginTop: space(1) }}>
                            <Chip
                              label={STR.prCopiesClass}
                              selected={copiesMode === "CLASS_PRESENT"}
                              onPress={() => setCopiesMode("CLASS_PRESENT")}
                            />
                            <Chip
                              label={STR.prCopiesFixed}
                              selected={copiesMode === "FIXED"}
                              onPress={() => setCopiesMode("FIXED")}
                            />
                          </View>
                          {copiesMode === "FIXED" ? (
                            <Field label={STR.prCopies} value={copies} onChangeText={setCopies} keyboardType="number-pad" />
                          ) : null}
                          <Button
                            title={STR.cqSendToPrint}
                            onPress={() => void onSendPrint(r.id)}
                            loading={busyId === r.id}
                            disabled={busyId !== null || !colour || !sides}
                            style={{ marginTop: space(2) }}
                          />
                        </>
                      )}
                    </View>
                  ) : null}

                  {/* The two ways out of a mistake, offered together and kept low-key:
                      correcting is the common case, withdrawing the last resort. */}
                  {(EDITABLE.has(r.status) && !editing) || (CANCELLABLE.has(r.status) && !cancelling) ? (
                    <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                      {EDITABLE.has(r.status) && !editing ? (
                        <View style={{ flex: 1 }}>
                          <Button
                            title={STR.cqEdit}
                            variant="ghost"
                            onPress={() => openEdit(r)}
                            disabled={busyId !== null}
                          />
                        </View>
                      ) : null}
                      {CANCELLABLE.has(r.status) && !cancelling ? (
                        <View style={{ flex: 1 }}>
                          <Button
                            title={STR.cqCancel}
                            variant="ghost"
                            onPress={() => {
                              setEditFor(null);
                              setCancelFor(r.id);
                              setCancelReason("");
                            }}
                            disabled={busyId !== null}
                          />
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {r.rounds.length > 1 ? (
                    <Muted style={{ marginTop: space(1) }}>
                      {STR.cqRoundLabel}: {bnNum(r.rounds.length)}
                    </Muted>
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

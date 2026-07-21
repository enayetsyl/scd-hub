/**
 * MyCtQuestionsScreen (owner ask 2026-07-20) — the teacher's question requests:
 * review the office's uploaded paper (view → approve-and-lock, or ask for
 * changes with a mandatory comment), and once CONFIRMED send it to print from
 * the same card (colour/sides/copies → the standard class-test print path).
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
  type CtQuestionRequestT,
} from "../../graphql/classTest";
import { Screen, Body, Muted, Card, Badge, Button, Field, Chip, Select, Notice, Loader, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useConfirm } from "../../state/ConfirmContext";
import { openStoredFile, FILE_VIEW_SUPPORTED } from "../../lib/files";
import { useFileOpen } from "../../lib/useFileOpen";
import { STR, hwSubjectLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ClassTestStackParamList>;

export function ctQuestionStatusBadge(status: string): { text: string; tone: "warn" | "ok" | "info" | "brand" | "muted" } {
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
    default:
      return { text: status, tone: "muted" };
  }
}

export function CtQuestionMeta({ r }: { r: CtQuestionRequestT }): React.ReactElement {
  return (
    <Muted style={{ marginTop: 2 }}>
      {STR.cqChapter}: {r.chapter} · {STR.ctTestNumber} {bnNum(r.testNumber)} · {STR.ctTotalMarks}{" "}
      {bnNum(r.totalMarks)} · {bnNum(r.durationMinutes)} {STR.gpMinutes} ·{" "}
      {new Date(r.examDate).toLocaleDateString()}
    </Muted>
  );
}

export default function MyCtQuestionsScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { confirmAction } = useConfirm();
  const [q, refetch] = useQuery({ query: MY_CT_QUESTION_REQUESTS });
  const [, review] = useMutation(REVIEW_CT_QUESTION);
  const [, sendPrint] = useMutation(REQUEST_CT_QUESTION_PRINT);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [commentFor, setCommentFor] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [printFor, setPrintFor] = useState<string | null>(null);
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

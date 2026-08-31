/**
 * SyllabusApprovalsScreen (SY-5) — the sign-off surface.
 *
 * ONE screen, two audiences, because the action is the same shape for both:
 *
 *   subject teacher  reads the rows waiting on THEM (`mySyllabusApprovals`) and
 *                    approves or sends back with a reason. They cannot edit —
 *                    the banner says so before they go looking for a pencil.
 *   Principal        additionally sees this exam × class's rows sitting at
 *                    PRINCIPAL_REVIEW and publishes them, with publish blocked
 *                    and the reason NAMED when the distribution does not total 100.
 *
 * A teacher with nothing waiting sees an empty state, never an error.
 */
import React, { useMemo, useState } from "react";
import { RefreshControl, View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  MY_SYLLABUS_APPROVALS,
  EXAM_SYLLABUS_BOARD,
  APPROVE_EXAM_SYLLABUS,
  SEND_BACK_EXAM_SYLLABUS,
  PUBLISH_EXAM_SYLLABUS,
  type SyllabusT,
} from "../../graphql/examSyllabus";
import {
  Screen,
  Body,
  Muted,
  Card,
  Button,
  Field,
  Badge,
  Select,
  EmptyState,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import SyllabusView from "../../components/SyllabusView";
import SyllabusMatrix, { type MatrixRow } from "../../components/SyllabusMatrix";
import { ROUTINE_SUBJECTS } from "@scd/shared";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, routineSubjectLabel, examTermLabel } from "../../lib/labels";
import { useState as useLocalState } from "react";
import { useSyllabusPickers } from "../../lib/useSyllabusPickers";
import { usePullRefresh } from "../../lib/useRefresh";
import { friendlyError } from "../../lib/errors";
import { space, typeScale } from "../../theme/tokens";
import { SYLLABUS_FULL_MARKS } from "@scd/shared";

/** One row with its verdict controls. Used for both audiences. */
function ApprovalCard({
  row,
  mode,
  onDone,
}: {
  row: SyllabusT;
  mode: "teacher" | "principal";
  onDone: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const [, approve] = useMutation(APPROVE_EXAM_SYLLABUS);
  const [, sendBack] = useMutation(SEND_BACK_EXAM_SYLLABUS);
  const [, publish] = useMutation(PUBLISH_EXAM_SYLLABUS);

  const balanced = row.totalMarks === SYLLABUS_FULL_MARKS;

  async function run(fn: () => Promise<{ error?: unknown }>): Promise<void> {
    setErr(null);
    const res = await fn();
    if (res.error) {
      setErr(friendlyError(res.error as never));
      return;
    }
    onDone();
  }

  return (
    <Card>
      {err ? <ErrorBanner message={err} /> : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        {/* Class FIRST, then subject. A teacher holding one subject in three
            classes gets three cards whose only difference is this line, and the
            screen shipped showing the subject alone — three identical "ইংরেজি"
            headings with no way to tell which class was being signed off. */}
        <Body style={{ ...typeScale.bodyStrong, flex: 1 }}>
          {row.classLabel ? `${row.classLabel} — ` : ""}
          {routineSubjectLabel(row.subject)}
        </Body>
        <Badge
          tone={balanced ? "ok" : "warn"}
          text={balanced ? STR.syFullMarks : `${STR.sySumIs} ${bnNum(row.totalMarks)}`}
        />
      </View>

      {row.examDateKey ? <Muted>{row.examDateKey}</Muted> : null}

      <Button
        title={open ? STR.syHideMarks : STR.syOpenMarks}
        variant="ghost"
        onPress={() => setOpen((v) => !v)}
      />
      {open ? <SyllabusView row={row} /> : null}

      {mode === "teacher" ? (
        <>
          <Notice message={STR.syCannotEdit} tone="info" />
          <Field
            label={STR.sySendBackReason}
            value={reason}
            onChangeText={setReason}
            helper={STR.sySendBackReasonHint}
            multiline
          />
          <View style={{ flexDirection: "row", gap: space(2) }}>
            <View style={{ flex: 1 }}>
              <Button
                title={STR.sySendBack}
                variant="danger"
                // Disabled without a reason: a send-back with nothing said is an
                // instruction Office cannot act on.
                disabled={!reason.trim()}
                onPress={() => run(() => sendBack({ id: row.id!, reason }))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={STR.syApprove} onPress={() => run(() => approve({ id: row.id! }))} />
            </View>
          </View>
        </>
      ) : (
        <>
          {/* The matrix opens ANY cell, so this card sees every stage — but the
              actions belong to one stage each. Offering প্রকাশ করুন on a row that is
              still with Office or with the teacher is a button whose only possible
              outcome is the server's refusal. */}
          {row.status === "DRAFT" ? (
            <Notice
              message={`${STR.syWithOffice} — ${STR.syNoActionNeeded}`}
              tone="info"
            />
          ) : row.status === "PUBLISHED" ? (
            <Notice message={STR.syPublished} tone="ok" />
          ) : (
            <>
              {row.status === "TEACHER_REVIEW" ? (
                <Notice message={STR.syAwaitingTeacher} tone="info" />
              ) : null}
              {!balanced ? <Notice message={STR.syBlockedSum} tone="warn" /> : null}
              <Field
                label={STR.sySendBackReason}
                value={reason}
                onChangeText={setReason}
                helper={STR.sySendBackReasonHint}
                multiline
              />
              <View style={{ flexDirection: "row", gap: space(2) }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title={STR.sySendBack}
                    variant="danger"
                    disabled={!reason.trim()}
                    onPress={() => run(() => sendBack({ id: row.id!, reason }))}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    // Publish belongs to PRINCIPAL_REVIEW alone; a row still with
                    // the teacher can only be recalled, not released.
                    title={row.status === "TEACHER_REVIEW" ? STR.syRecall : STR.syPublish}
                    disabled={row.status === "TEACHER_REVIEW" || !balanced}
                    onPress={() => run(() => publish({ id: row.id! }))}
                  />
                </View>
              </View>
            </>
          )}
        </>
      )}
    </Card>
  );
}

export default function SyllabusApprovalsScreen(): React.ReactElement {
  const { isRole } = useAuth();
  const isPrincipal = isRole("PRINCIPAL");

  const [mineQ, refetchMine] = useQuery({ query: MY_SYLLABUS_APPROVALS });
  // `?.` even though this field cannot be refused — the drawer badge reads the
  // same query, and a field read without it is what white-screened the app in
  // 791e5fe.
  const mine = useMemo(
    () => mineQ.data?.mySyllabusApprovals ?? [],
    [mineQ.data?.mySyllabusApprovals],
  );

  const pick = useSyllabusPickers();
  // The Principal reads the WHOLE exam in one query — the board's question is
  // coverage across classes, and a per-class call would be seven round trips.
  const [boardQ, refetchBoard] = useQuery({
    query: EXAM_SYLLABUS_BOARD,
    variables: { examId: pick.examId ?? "" },
    pause: !isPrincipal || !pick.examId,
  });
  const board = useMemo<MatrixRow[]>(
    () =>
      (boardQ.data?.examSyllabusBoard ?? []).map((c) => ({
        classId: c.classId,
        classLabel: c.classLabel,
        subjects: c.subjects,
      })),
    [boardQ.data?.examSyllabusBoard],
  );

  /** The cell the Principal opened, if any. */
  const [openCell, setOpenCell] = useLocalState<SyllabusT | null>(null);

  const refresh = usePullRefresh(mineQ.fetching || boardQ.fetching, () => {
    refetchMine({ requestPolicy: "network-only" });
    refetchBoard({ requestPolicy: "network-only" });
  });
  const reload = (): void => {
    refetchMine({ requestPolicy: "network-only" });
    refetchBoard({ requestPolicy: "network-only" });
    setOpenCell(null);
  };

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />}>
      <Body style={typeScale.sectionTitle}>
        {STR.syWaitingOnYou} — {bnNum(mine.length)}
      </Body>
      {mine.length === 0 ? (
        <EmptyState message={STR.syNoApprovals} />
      ) : (
        <View style={{ gap: space(3) }}>
          {mine.map((row) => (
            <ApprovalCard key={row.id ?? row.subject} row={row} mode="teacher" onDone={reload} />
          ))}
        </View>
      )}

      {isPrincipal ? (
        <View style={{ marginTop: space(5), gap: space(3) }}>
          <Body style={typeScale.sectionTitle}>{STR.syTitle}</Body>
          <Select
            label={STR.syPickExam}
            value={pick.examId}
            options={pick.exams.map((e) => ({
              label: e.name,
              value: e.id,
              hint: examTermLabel(e.term),
            }))}
            onChange={(v) => {
              pick.setExamId(v);
              setOpenCell(null);
            }}
          />

          {board.length === 0 ? (
            <EmptyState message={STR.syNoExam} />
          ) : (
            <Card>
              <SyllabusMatrix
                rows={board}
                subjectOrder={[...ROUTINE_SUBJECTS]}
                onPressCell={(_classId, _subject, row) => setOpenCell(row ?? null)}
              />
            </Card>
          )}

          {/* A cell opens its row in place. Publish and send-back are the SAME
              controls the teacher stage uses — one card, two audiences. */}
          {openCell ? (
            <ApprovalCard key={openCell.id ?? openCell.subject} row={openCell} mode="principal" onDone={reload} />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

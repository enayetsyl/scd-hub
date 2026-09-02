/**
 * SyllabusApprovalsScreen (SY-5) — the sign-off surface.
 *
 * ONE screen, two audiences, because the action is the same shape for both:
 *
 *   subject teacher  reads the rows waiting on THEM (`mySyllabusApprovals`) and
 *                    approves or sends back with a reason. They cannot edit —
 *                    the banner says so before they go looking for a pencil.
 *   Office +         additionally see the whole exam's coverage board, WHO each
 *   Principal        row is with, and can move a row still in TEACHER_REVIEW to a
 *                    different routine holder. Publishing is the Principal's
 *                    alone (§7.4) — Office holds `exam:manage` and is still
 *                    refused server-side, so the button is offered to neither.
 *
 * The board gate is `can("exam:manage")`, not `isRole("PRINCIPAL")`: the server
 * has always allowed admin staff, and gating the screen tighter meant the desk
 * that WRITES every syllabus could not see the coverage of what it had written.
 *
 * A teacher with nothing waiting sees an empty state, never an error.
 */
import React, { useMemo, useState } from "react";
import { RefreshControl, View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  MY_SYLLABUS_APPROVALS,
  EXAM_SYLLABUS_BOARD,
  EXAM_SYLLABUS_APPROVER,
  APPROVE_EXAM_SYLLABUS,
  SEND_BACK_EXAM_SYLLABUS,
  PUBLISH_EXAM_SYLLABUS,
  REASSIGN_EXAM_SYLLABUS,
  type SyllabusT,
} from "../../graphql/examSyllabus";
import { TEACHERS_QUERY } from "../../graphql/operations";
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
import { STR, bnNum, routineSubjectLabel, examTermLabel, isoDateTimeLabel } from "../../lib/labels";
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
  canPublish,
  onDone,
  onStale,
}: {
  row: SyllabusT;
  /** "manage" is Office AND Principal — both hold `exam:manage`. */
  mode: "teacher" | "manage";
  /** Publish rides the PRINCIPAL role alone (§7.4); Office manages but cannot release. */
  canPublish?: boolean;
  onDone: () => void;
  /** Re-read the lists WITHOUT closing the card — used when a call fails. */
  onStale: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState<string | null>(null);

  const [, approve] = useMutation(APPROVE_EXAM_SYLLABUS);
  const [, sendBack] = useMutation(SEND_BACK_EXAM_SYLLABUS);
  const [, publish] = useMutation(PUBLISH_EXAM_SYLLABUS);
  const [, reassign] = useMutation(REASSIGN_EXAM_SYLLABUS);

  // Who the ROUTINE allows, and their names. Both are manage-only reads, and the
  // approver query needs `exam:manage` — so a teacher's card must not fire them.
  const isManage = mode === "manage";
  const [approverQ] = useQuery({
    query: EXAM_SYLLABUS_APPROVER,
    variables: { classId: row.classId, subject: row.subject },
    pause: !isManage,
  });
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY, pause: !isManage });
  const holders = approverQ.data?.examSyllabusApprover.holders ?? [];
  const teacherName = (id: string): string =>
    (teachersQ.data?.teachers ?? []).find((t) => t.id === id)?.name ?? id;

  const balanced = row.totalMarks === SYLLABUS_FULL_MARKS;

  async function run(fn: () => Promise<{ error?: unknown }>): Promise<void> {
    setErr(null);
    const res = await fn();
    if (res.error) {
      setErr(friendlyError(res.error as never));
      // Refresh on failure TOO, not only on success.
      //
      // The queue is filtered to rows that are still TEACHER_REVIEW, so a card
      // whose row has moved on is a card that can no longer be acted on — every
      // further press hits a refusal about a stage the teacher cannot see. That
      // is what turned one phantom error into a teacher pressing অনুমোদন twice
      // 2ms apart and another sending the same row back three times in twelve
      // seconds: the failed call left the stale card sitting there.
      //
      // If the row genuinely is still theirs the card stays, error and all.
      onStale();
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
          {/* WHO, and — the part the first version got backwards — WHETHER they
              have signed yet.

              Showing `approverUserId` under a flat "যার কাছে আছে" made an already
              approved row read as still waiting on the teacher, which is the
              opposite of the truth. Who it was SENT TO and who SIGNED IT are two
              different questions, and only the second is answered by
              teacherApprovedBy. */}
          {row.teacherApprovedBy ? (
            <Muted>
              {row.teacherBypass
                ? STR.syApprovedByBypass
                : `${STR.syApprovedBy}: ${teacherName(row.teacherApprovedBy)}`}
              {row.teacherApprovedAt ? ` · ${isoDateTimeLabel(row.teacherApprovedAt)}` : ""}
            </Muted>
          ) : row.approverUserId ? (
            <Muted>{`${STR.syAwaitingTeacherFrom}: ${teacherName(row.approverUserId)}`}</Muted>
          ) : null}

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

              {/* Moving it to another teacher is offered ONLY while it is still
                  with one. After sign-off the approval is already given, and
                  re-pointing the row would credit it to someone who never read
                  it — so the stage says why rather than hiding the control. */}
              {row.status === "TEACHER_REVIEW" ? (
                <>
                  <Select
                    label={STR.syReassignTo}
                    value={moveTo}
                    options={holders.map((h) => ({
                      label: teacherName(h.userId),
                      value: h.userId,
                      hint: `${bnNum(h.periods)} ${STR.syPeriods}`,
                    }))}
                    onChange={setMoveTo}
                  />
                  <Button
                    title={STR.syReassign}
                    variant="secondary"
                    // Nothing chosen, or the same teacher it is already with:
                    // the server treats that as a no-op, so do not offer it.
                    disabled={!moveTo || moveTo === row.approverUserId}
                    onPress={() =>
                      run(() => reassign({ id: row.id!, approverUserId: moveTo! }))
                    }
                  />
                </>
              ) : (
                <Muted>{STR.syReassignOnlyTeacherStage}</Muted>
              )}
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
                    // the teacher can only be recalled, not released. And it rides
                    // the PRINCIPAL role — Office holds exam:manage and is still
                    // refused server-side (§7.4), so offering it here would be a
                    // button whose only outcome is a refusal.
                    title={row.status === "TEACHER_REVIEW" ? STR.syRecall : STR.syPublish}
                    disabled={row.status === "TEACHER_REVIEW" || !balanced || !canPublish}
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
  const { isRole, can } = useAuth();
  // The BOARD is Office's too — `examSyllabusBoard` has always allowed admin staff,
  // and the screen gated it tighter than the server, so the desk that writes every
  // syllabus could not see the coverage of what it had written.
  const canManage = can("exam:manage");
  // Publishing stays the Principal's alone (§7.4).
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
    pause: !canManage || !pick.examId,
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
  /** Refetch both lists but leave the open card alone. */
  const refetchAll = (): void => {
    refetchMine({ requestPolicy: "network-only" });
    refetchBoard({ requestPolicy: "network-only" });
  };
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
            <ApprovalCard
              key={row.id ?? row.subject}
              row={row}
              mode="teacher"
              onDone={reload}
              onStale={refetchAll}
            />
          ))}
        </View>
      )}

      {canManage ? (
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
            <ApprovalCard
              key={openCell.id ?? openCell.subject}
              row={openCell}
              mode="manage"
              canPublish={isPrincipal}
              onDone={reload}
              onStale={refetchAll}
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

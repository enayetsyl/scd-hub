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
  EXAM_SYLLABUS_CLASS,
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
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, routineSubjectLabel, examTermLabel } from "../../lib/labels";
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
        <Body style={{ ...typeScale.bodyStrong, flex: 1 }}>
          {routineSubjectLabel(row.subject)}
        </Body>
        <Badge
          tone={balanced ? "ok" : "warn"}
          text={balanced ? STR.syFullMarks : `${STR.sySumIs} ${bnNum(row.totalMarks)}`}
        />
      </View>

      {row.examDateKey ? <Muted>{row.examDateKey}</Muted> : null}

      <Button
        title={open ? STR.syOpenMarks : STR.syOpenMarks}
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
                title={STR.syPublish}
                disabled={!balanced}
                onPress={() => run(() => publish({ id: row.id! }))}
              />
            </View>
          </View>
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
  const [classQ, refetchClass] = useQuery({
    query: EXAM_SYLLABUS_CLASS,
    variables: { examId: pick.examId ?? "", classId: pick.classId ?? "" },
    pause: !isPrincipal || !pick.examId || !pick.classId,
  });
  const awaitingPrincipal = useMemo(
    () =>
      (classQ.data?.examSyllabusClass.subjects ?? []).filter(
        (s) => s.status === "PRINCIPAL_REVIEW",
      ),
    [classQ.data?.examSyllabusClass.subjects],
  );

  const refresh = usePullRefresh(mineQ.fetching || classQ.fetching, () => {
    refetchMine({ requestPolicy: "network-only" });
    refetchClass({ requestPolicy: "network-only" });
  });
  const reload = (): void => {
    refetchMine({ requestPolicy: "network-only" });
    refetchClass({ requestPolicy: "network-only" });
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
          <Body style={typeScale.sectionTitle}>{STR.syStatPrincipal}</Body>
          <Select
            label={STR.syPickExam}
            value={pick.examId}
            options={pick.exams.map((e) => ({
              label: e.name,
              value: e.id,
              hint: examTermLabel(e.term),
            }))}
            onChange={pick.setExamId}
          />
          <Select
            label={STR.syPickClass}
            value={pick.classId}
            options={pick.classes.map((c) => ({ label: c.label, value: c.id }))}
            onChange={pick.setClassId}
          />
          {awaitingPrincipal.length === 0 ? (
            <EmptyState message={STR.syNoApprovals} />
          ) : (
            awaitingPrincipal.map((row) => (
              <ApprovalCard
                key={row.id ?? row.subject}
                row={row}
                mode="principal"
                onDone={reload}
              />
            ))
          )}
        </View>
      ) : null}
    </Screen>
  );
}

/**
 * AssignmentWorkspaceScreen (RP-4, D-#356) — the assignment parity of the
 * homework workspace. One card per assignment item (subject × week) for a
 * section, laid out in responsive columns (CardGrid). Same three stages:
 *
 *   ① জমা   — RosterChipPass over GIVEN/DUE/CHASE → assignmentSubmitPass
 *              (uncrossed → SUBMITTED; crossed → CHASE first-cross-only, any date)
 *   ② যাচাই — individual ঠিক/আংশিক/ভুল + marks + feedback (recordAssignmentOutcome)
 *   ③ ফেরত  — RosterChipPass over CHECKED/RESUBMIT → assignmentReturnPass;
 *              a secondary পুনঃজমা list issues the explicit resubmission (D-#87)
 *
 * Section + class arrive as route params (from an AssignmentHome cell). Absent-at-
 * delivery students sit behind the header badge (redeliver → GIVEN); manual re-chase
 * of an already-chased student is the "তাগাদা" secondary control under ①.
 */
import React, { useState, useCallback } from "react";
import { ScrollView, View, RefreshControl, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import { HW_RESULTS } from "@scd/shared";
import {
  AS_OPEN_RECORDS,
  ASSIGNMENT_SUBMIT_PASS,
  ASSIGNMENT_RETURN_PASS,
  RECORD_AS_OUTCOME,
  REDELIVER_AS_RECORD,
  TRANSITION_AS_RECORD,
  ISSUE_AS_RESUBMISSION,
  REVERT_AS_RECORD,
  type AsOpenRecordT,
} from "../../graphql/operations";
import { useConfirm } from "../../state/ConfirmContext";
import { RosterChipPass } from "../../components/RosterChipPass";
import { CardGrid } from "../../components/CardGrid";
import type { AssignmentStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Field, Chip, ChipRow, Notice, Loader, EmptyState } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, hwResultLabel, classLevelLabel, lifecycleStateLabel, dhakaDateKey } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AssignmentStackParamList, "AssignmentWorkspace">;

// RETURNED is queried so a just-returned batch stays a same-day confirmation
// list (with Undo), then clears next Dhaka day (D-#338 posture).
const OPEN_STATES = ["GIVEN", "ABSENT_REDELIVER", "DUE", "SUBMITTED", "CHASE", "CHECKED", "RESUBMIT", "RETURNED"];
const SUBMIT_STATES = new Set(["GIVEN", "DUE", "CHASE"]);
const RETURN_STATES = new Set(["CHECKED", "RESUBMIT"]);

const day = (iso?: string | null): string => (iso ? iso.slice(0, 10) : "—");

/** Calendar day (YYYY-MM-DD) of an ISO instant in Asia/Dhaka. */
function dhakaDayOf(iso: string): string {
  return dhakaDateKey(iso);
}

interface ItemGroup {
  asItemId: string;
  asId: string;
  subject: string;
  classLevel: number;
  deliveryDate: string | null;
  dueDate: string | null;
  rows: AsOpenRecordT[];
}

function groupByItem(records: readonly AsOpenRecordT[]): ItemGroup[] {
  const order: string[] = [];
  const map = new Map<string, ItemGroup>();
  for (const r of records) {
    let g = map.get(r.asItemId);
    if (!g) {
      g = {
        asItemId: r.asItemId,
        asId: r.asId,
        subject: r.subject,
        classLevel: r.classLevel,
        deliveryDate: r.deliveryDate,
        dueDate: r.dueDate,
        rows: [],
      };
      map.set(r.asItemId, g);
      order.push(r.asItemId);
    }
    g.rows.push(r);
  }
  return order
    .map((id) => map.get(id)!)
    .sort((a, b) => {
      const ad = a.deliveryDate ?? "";
      const bd = b.deliveryDate ?? "";
      return ad < bd ? 1 : ad > bd ? -1 : a.subject.localeCompare(b.subject);
    });
}

export default function AssignmentWorkspaceScreen({ route }: Props): React.ReactElement {
  const { sectionId, classId } = route.params;

  const [recsQ, refetchRecs] = useQuery({
    query: AS_OPEN_RECORDS,
    variables: { sectionId, classId, states: OPEN_STATES },
  });
  const today = dhakaDayOf(new Date().toISOString());
  const records = (recsQ.data?.assignmentOpenRecords ?? []).filter(
    (r) => r.state !== "RETURNED" || dhakaDayOf(r.lastStateAt) === today,
  );

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const refresh = useCallback(() => refetchRecs({ requestPolicy: "network-only" }), [refetchRecs]);
  const notify = useCallback((okMsg: string | null, errMsg: string | null) => {
    setOk(okMsg);
    setError(errMsg);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const { refreshing, onRefresh } = usePullRefresh(recsQ.fetching, refresh);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {recsQ.fetching && records.length === 0 ? (
          <Loader label={STR.loading} />
        ) : records.length === 0 ? (
          <EmptyState message={STR.asPassNoOpenItems} />
        ) : (
          <>
            {ok ? <Notice message={ok} tone="ok" /> : null}
            {error ? <Notice message={error} tone="danger" /> : null}
            <CardGrid>
              {groupByItem(records).map((g) => (
                <ItemCard key={g.asItemId} group={g} sectionId={sectionId} onDone={refresh} onNotify={notify} />
              ))}
            </CardGrid>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function ItemCard({
  group,
  sectionId,
  onDone,
  onNotify,
}: {
  group: ItemGroup;
  sectionId: string;
  onDone: () => void;
  onNotify: (ok: string | null, err: string | null) => void;
}): React.ReactElement {
  const [, submitPass] = useMutation(ASSIGNMENT_SUBMIT_PASS);
  const [, returnPass] = useMutation(ASSIGNMENT_RETURN_PASS);
  const [, redeliver] = useMutation(REDELIVER_AS_RECORD);
  const [, transition] = useMutation(TRANSITION_AS_RECORD);
  const [, resub] = useMutation(ISSUE_AS_RESUBMISSION);
  const [, revertRecord] = useMutation(REVERT_AS_RECORD);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [returnBusy, setReturnBusy] = useState(false);
  const [showAbsent, setShowAbsent] = useState(false);
  const [showChase, setShowChase] = useState(false);
  const [showResub, setShowResub] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const submitRows = group.rows.filter((r) => SUBMIT_STATES.has(r.state));
  const checkRows = group.rows.filter((r) => r.state === "SUBMITTED");
  const returnRows = group.rows.filter((r) => RETURN_STATES.has(r.state));
  const returnedRows = group.rows.filter((r) => r.state === "RETURNED");
  const absentRows = group.rows.filter((r) => r.state === "ABSENT_REDELIVER");
  const chaseRows = submitRows.filter((r) => r.state === "CHASE");
  const checkedRows = group.rows.filter((r) => r.state === "CHECKED");

  async function onSubmitCommit(entries: { id: string; on: boolean }[]): Promise<void> {
    setSubmitBusy(true);
    const res = await submitPass({
      sectionId,
      itemId: group.asItemId,
      entries: entries.map((e) => ({ recordId: e.id, submitted: e.on })),
    });
    setSubmitBusy(false);
    const r = res.data?.assignmentSubmitPass;
    if (res.error || !r) return onNotify(null, friendlyError(res.error));
    onNotify(`${STR.asCollectDone} · ${STR.asSubmitted} ${bnNum(r.submittedCount)} · ${STR.asNotSubmitted} ${bnNum(r.chasedCount)}`, null);
    onDone();
  }

  async function onReturnCommit(entries: { id: string; on: boolean }[]): Promise<void> {
    setReturnBusy(true);
    const res = await returnPass({
      sectionId,
      itemId: group.asItemId,
      entries: entries.map((e) => ({ recordId: e.id, returned: e.on })),
    });
    setReturnBusy(false);
    const r = res.data?.assignmentReturnPass;
    if (res.error || !r) return onNotify(null, friendlyError(res.error));
    onNotify(`${STR.asReturn} · ${bnNum(r.returnedCount)}`, null);
    onDone();
  }

  async function onRedeliver(recordId: string): Promise<void> {
    setBusyId(recordId);
    const res = await redeliver({ sectionId, recordId });
    setBusyId(null);
    if (res.error || !res.data?.redeliverAssignmentRecord) return onNotify(null, friendlyError(res.error));
    onNotify(lifecycleStateLabel("GIVEN"), null);
    onDone();
  }

  async function onChaseAgain(recordId: string): Promise<void> {
    setBusyId(recordId);
    const res = await transition({ sectionId, recordId, toState: "CHASE" });
    setBusyId(null);
    if (res.error || !res.data?.transitionAssignmentRecord) return onNotify(null, friendlyError(res.error));
    onNotify(lifecycleStateLabel("CHASE"), null);
    onDone();
  }

  async function onResubmit(recordId: string): Promise<void> {
    setBusyId(recordId);
    const res = await resub({ sectionId, recordId });
    setBusyId(null);
    if (res.error || !res.data?.issueAssignmentResubmission) return onNotify(null, friendlyError(res.error));
    onNotify(STR.asResubIssued, null);
    onDone();
  }

  /** Undo a same-day return (D-#338) — puts the student back into ফেরত. */
  async function onUndoReturn(recordId: string): Promise<void> {
    setBusyId(recordId);
    const res = await revertRecord({ sectionId, recordId });
    setBusyId(null);
    if (res.error || !res.data?.revertAssignmentRecord) return onNotify(null, friendlyError(res.error));
    onNotify(STR.revertDone, null);
    onDone();
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flexShrink: 1 }}>
          <Body style={{ fontWeight: "700" }}>
            {classLevelLabel(group.classLevel)} · {hwSubjectLabel(group.subject)}
          </Body>
          <Muted style={{ marginTop: 2 }}>
            {group.asId} · {STR.asDeliverBy} {day(group.deliveryDate)} · {STR.asDueBy} {day(group.dueDate)}
          </Muted>
        </View>
        {absentRows.length > 0 ? (
          <Button title={`${STR.asRedeliver} · ${bnNum(absentRows.length)}`} variant="ghost" onPress={() => setShowAbsent((v) => !v)} />
        ) : null}
      </View>

      {showAbsent && absentRows.length > 0 ? (
        <Card>
          {absentRows.map((r) => (
            <View key={r.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 }}>
              <Body style={{ flexShrink: 1 }}>{r.studentName}</Body>
              <Button title={STR.asRedeliver} variant="secondary" onPress={() => void onRedeliver(r.id)} loading={busyId === r.id} disabled={busyId !== null} />
            </View>
          ))}
        </Card>
      ) : null}

      {/* ① জমা */}
      {submitRows.length > 0 ? (
        <View style={{ marginTop: space(3) }}>
          <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>── {STR.hwPassSubmit} ──</Muted>
          <RosterChipPass
            students={submitRows.map((r) => ({
              id: r.id,
              name: r.studentName,
              // Badge the redo so it isn't mistaken for a duplicate (owner 2026-07-26).
              badge:
                (r.resubOf ? `🔁 ${STR.hwResubTag}` : "") +
                  (r.chaseCount > 0 ? `${r.resubOf ? " · " : ""}${lifecycleStateLabel("CHASE")} ${bnNum(r.chaseCount)}` : "") ||
                undefined,
            }))}
            onLabel={STR.asSubmitted}
            offLabel={STR.asNotSubmitted}
            commitLabel={STR.hwPassSubmitCommit}
            busy={submitBusy}
            onCommit={onSubmitCommit}
          />
          {chaseRows.length > 0 ? (
            <View style={{ marginTop: space(2) }}>
              <Button title={`${lifecycleStateLabel("CHASE")} (${bnNum(chaseRows.length)})`} variant="ghost" onPress={() => setShowChase((v) => !v)} />
              {showChase
                ? chaseRows.map((r) => (
                    <View key={r.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 }}>
                      <Body style={{ flexShrink: 1 }}>
                        {r.studentName} · {lifecycleStateLabel("CHASE")} {bnNum(r.chaseCount)}
                      </Body>
                      <Button title={lifecycleStateLabel("CHASE")} variant="secondary" onPress={() => void onChaseAgain(r.id)} loading={busyId === r.id} disabled={busyId !== null} />
                    </View>
                  ))
                : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* ② যাচাই */}
      {checkRows.length > 0 ? (
        <View style={{ marginTop: space(3) }}>
          <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>── {STR.asCheck} ──</Muted>
          {checkRows.map((r) => (
            <AsCheckRow key={r.id} record={r} sectionId={sectionId} onDone={onDone} onNotify={onNotify} />
          ))}
        </View>
      ) : null}

      {/* ③ ফেরত */}
      {returnRows.length > 0 ? (
        <View style={{ marginTop: space(3) }}>
          <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>── {STR.asReturn} ──</Muted>
          <RosterChipPass
            students={returnRows.map((r) => ({ id: r.id, name: r.studentName }))}
            onLabel={STR.asReturn}
            offLabel={STR.hwPassKeptBack}
            commitLabel={STR.hwPassReturnCommit}
            busy={returnBusy}
            onCommit={onReturnCommit}
          />
          {checkedRows.length > 0 ? (
            <View style={{ marginTop: space(2) }}>
              <Button title={`${STR.asResubmit} (${bnNum(checkedRows.length)})`} variant="ghost" onPress={() => setShowResub((v) => !v)} />
              {showResub
                ? checkedRows.map((r) => (
                    <View key={r.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 }}>
                      <Body style={{ flexShrink: 1 }}>
                        {r.studentName}
                        {r.result ? ` · ${hwResultLabel(r.result)}` : ""}
                      </Body>
                      <Button title={STR.asResubmit} variant="secondary" onPress={() => void onResubmit(r.id)} loading={busyId === r.id} disabled={busyId !== null} />
                    </View>
                  ))
                : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Same-day confirmation of what was handed back (with Undo); clears next day. */}
      {returnedRows.length > 0 ? (
        <View style={{ marginTop: space(3) }}>
          <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>
            ── {STR.hwReturnedHeading} ({bnNum(returnedRows.length)}) ──
          </Muted>
          {returnedRows.map((r) => (
            <View key={r.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 40 }}>
              <Body style={{ flexShrink: 1 }}>
                ✓ {r.studentName}
                {r.result ? ` · ${hwResultLabel(r.result)}` : ""}
              </Body>
              {r.stampCount > 1 ? (
                <Button title={STR.revertAction} variant="ghost" onPress={() => void onUndoReturn(r.id)} loading={busyId === r.id} disabled={busyId !== null} />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function AsCheckRow({
  record,
  sectionId,
  onDone,
  onNotify,
}: {
  record: AsOpenRecordT;
  sectionId: string;
  onDone: () => void;
  onNotify: (ok: string | null, err: string | null) => void;
}): React.ReactElement {
  const nav = useNavigation<Props["navigation"]>();
  const [, recordOutcome] = useMutation(RECORD_AS_OUTCOME);
  const [, revertRecord] = useMutation(REVERT_AS_RECORD);
  const { confirmAction } = useConfirm();

  const [result, setResult] = useState("");
  const [marks, setMarks] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  async function onCheck(): Promise<void> {
    if (!result) return onNotify(null, STR.hwResult);
    setBusy(true);
    const res = await recordOutcome({
      sectionId,
      recordId: record.id,
      result,
      marks: marks.trim() === "" ? undefined : parseInt(marks, 10),
      feedback: feedback.trim() === "" ? undefined : feedback.trim(),
    });
    setBusy(false);
    if (res.error || !res.data?.recordAssignmentOutcome) return onNotify(null, friendlyError(res.error));
    onNotify(hwResultLabel(result), null);
    onDone();
  }

  async function onRevert(): Promise<void> {
    if (!(await confirmAction({ title: STR.revertConfirmTitle, message: STR.revertConfirmBody, confirmLabel: STR.revertAction }))) return;
    setBusy(true);
    const res = await revertRecord({ sectionId, recordId: record.id });
    setBusy(false);
    if (res.error || !res.data?.revertAssignmentRecord) return onNotify(null, friendlyError(res.error));
    onNotify(STR.revertDone, null);
    onDone();
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        {/* SP-3 entry point: the full profile, opened on the assignment panel. */}
        <Pressable
          style={{ flex: 1 }}
          onPress={() =>
            nav.navigate("StudentProfile", {
              studentId: record.studentId,
              studentName: record.studentName,
              initialPanel: "assignment",
            })
          }
        >
          <Body style={{ fontWeight: "700" }}>{record.studentName}</Body>
        </Pressable>
        {record.resubOf ? <Badge text={STR.hwResubmissions} tone="muted" /> : null}
      </View>
      <ChipRow>
        {HW_RESULTS.map((rv) => (
          <Chip key={rv} label={hwResultLabel(rv)} selected={result === rv} onPress={() => setResult(rv)} />
        ))}
      </ChipRow>
      <Field label={STR.asMarks} value={marks} onChangeText={setMarks} keyboardType="number-pad" />
      <Field label={STR.asFeedback} value={feedback} onChangeText={setFeedback} />
      <View style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flex: 1, marginRight: space(2) }}>
          <Button title={STR.asCheck} onPress={() => void onCheck()} loading={busy} disabled={busy || !result} />
        </View>
        {record.stampCount > 1 ? <Button title={STR.revertAction} variant="ghost" onPress={() => void onRevert()} loading={busy} disabled={busy} /> : null}
      </View>
    </Card>
  );
}

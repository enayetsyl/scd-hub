/**
 * ExamCustodyScreen (EX-6/7/8) — the custody board, the acknowledgement inbox and the
 * new-handover form.
 *
 * The screen's job is to make the two-signature rule obvious:
 *   · "Waiting on you" is first, because an unacknowledged handover blocks tabulation;
 *   · acknowledging asks for YOUR count, not a confirm button — the whole point is that
 *     the receiver counts independently;
 *   · a mismatch demands a reason before it will submit, and the resulting row shows
 *     BOTH numbers forever rather than one replacing the other.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { CUSTODY_STAGES, CUSTODY_ITEM_KINDS } from "@scd/shared";
import {
  EXAM_CUSTODY_EVENTS_QUERY,
  EXAM_CUSTODY_BALANCE_QUERY,
  MY_PENDING_CUSTODY_QUERY,
  EXAM_CUSTODY_EXCEPTIONS_QUERY,
  RECORD_EXAM_CUSTODY_HANDOVER,
  ACKNOWLEDGE_EXAM_CUSTODY,
  CANCEL_EXAM_CUSTODY,
  EXAM_CUSTODY_RECIPIENTS_QUERY,
} from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Badge, Chip, Loader, Notice, Field, Divider, Select } from "../../components/ui";
import {
  STR,
  bnNum,
  custodyStageLabel,
  custodyItemKindLabel,
  custodyStatusLabel,
  isoDateTimeLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { ExamsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ExamsStackParamList, "ExamCustody">;

export default function ExamCustodyScreen({ route }: Props): React.ReactElement {
  const { examId, paperId } = route.params;

  const [pendingQ, refetchPending] = useQuery({ query: MY_PENDING_CUSTODY_QUERY });
  const pending = pendingQ.data?.myPendingCustodyAcknowledgements ?? [];

  const [eventsQ, refetchEvents] = useQuery({
    query: EXAM_CUSTODY_EVENTS_QUERY,
    variables: { examId, paperId: paperId ?? null },
  });
  const events = eventsQ.data?.examCustodyEvents ?? [];

  const [balanceQ, refetchBalance] = useQuery({
    query: EXAM_CUSTODY_BALANCE_QUERY,
    variables: { paperId: paperId ?? "" },
    pause: !paperId,
  });
  const balance = balanceQ.data?.examCustodyBalance ?? null;

  const [exceptionsQ, refetchExceptions] = useQuery({
    query: EXAM_CUSTODY_EXCEPTIONS_QUERY,
    variables: { examId, staleHours: 48 },
  });
  const exceptions = exceptionsQ.data?.examCustodyExceptions ?? [];

  const [staffQ] = useQuery({ query: EXAM_CUSTODY_RECIPIENTS_QUERY, variables: {} });
  const staff = staffQ.data?.examCustodyRecipients ?? [];

  const [, record] = useMutation(RECORD_EXAM_CUSTODY_HANDOVER);
  const [, acknowledge] = useMutation(ACKNOWLEDGE_EXAM_CUSTODY);
  const [, cancel] = useMutation(CANCEL_EXAM_CUSTODY);

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Acknowledgement state, per event.
  const [ackId, setAckId] = useState<string | null>(null);
  const [ackCount, setAckCount] = useState("");
  const [ackNote, setAckNote] = useState("");

  // New-handover form.
  const [formOpen, setFormOpen] = useState(false);
  const [stage, setStage] = useState<string>("CHECK_ISSUE");
  const [itemKind, setItemKind] = useState<string>("ANSWER_SCRIPT");
  const [toUserId, setToUserId] = useState<string>("");
  const [count, setCount] = useState("");

  function refetchAll(): void {
    refetchPending({ requestPolicy: "network-only" });
    refetchEvents({ requestPolicy: "network-only" });
    refetchExceptions({ requestPolicy: "network-only" });
    if (paperId) refetchBalance({ requestPolicy: "network-only" });
  }

  async function onAcknowledge(eventId: string, declared: number): Promise<void> {
    setError(null); setOk(null);
    const counted = Number(ackCount);
    if (!ackCount.trim() || Number.isNaN(counted)) return setError(STR.errGeneric);
    // Mirror the server rule client-side so the user is told BEFORE the round-trip.
    if (counted !== declared && !ackNote.trim()) return setError(STR.exDisputeNoteRequired);

    setBusy(true);
    const res = await acknowledge({
      eventId,
      countedCount: counted,
      discrepancyNote: ackNote.trim() || null,
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.exAcknowledged);
    setAckId(null); setAckCount(""); setAckNote("");
    refetchAll();
  }

  async function onRecord(): Promise<void> {
    setError(null); setOk(null);
    const n = Number(count);
    if (!toUserId) return setError(STR.errGeneric);
    if (!count.trim() || Number.isNaN(n)) return setError(STR.errGeneric);
    setBusy(true);
    const res = await record({
      examId,
      paperId: paperId ?? null,
      stage,
      itemKind,
      toUserId,
      declaredCount: n,
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.exHandoverRecorded);
    setFormOpen(false); setCount(""); setToUserId("");
    refetchAll();
  }

  async function onCancel(eventId: string): Promise<void> {
    setError(null); setOk(null); setBusy(true);
    const res = await cancel({ eventId });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    refetchAll();
  }

  const eventRow = (e: (typeof events)[number], showAck: boolean): React.ReactElement => (
    <View key={e.id} style={{ marginTop: space(2) }}>
      <Divider />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}>
        <View style={{ flexShrink: 1 }}>
          <Body style={{ fontWeight: "700" }}>{custodyStageLabel(e.stage)}</Body>
          <Muted>
            {custodyItemKindLabel(e.itemKind)} · {e.fromName ?? "—"} → {e.toName ?? "—"}
          </Muted>
          <Muted>{isoDateTimeLabel(e.handedOverAt)}</Muted>
        </View>
        <Badge
          text={custodyStatusLabel(e.status)}
          tone={e.status === "DISPUTED" ? "danger" : e.status === "ACKNOWLEDGED" ? "ok" : e.status === "CANCELLED" ? "muted" : "warn"}
        />
      </View>

      {/* BOTH counts, always — a dispute must never look like a single number. */}
      <Muted>
        {STR.exDeclared}: {bnNum(e.declaredCount)}
        {e.countedCount !== null ? ` · ${STR.exCounted}: ${bnNum(e.countedCount)}` : ""}
      </Muted>
      {e.discrepancyNote ? <Muted>{STR.exDisputeNote}: {e.discrepancyNote}</Muted> : null}

      {showAck && e.status === "PENDING_ACK" ? (
        ackId === e.id ? (
          <View style={{ marginTop: space(2) }}>
            <Field
              label={STR.exCountedCount}
              value={ackCount}
              onChangeText={setAckCount}
              keyboardType="numeric"
            />
            {ackCount.trim() && Number(ackCount) !== e.declaredCount ? (
              <Field label={STR.exDisputeNote} value={ackNote} onChangeText={setAckNote} />
            ) : null}
            <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
              <Button
                title={STR.exAcknowledge}
                onPress={() => onAcknowledge(e.id, e.declaredCount)}
                loading={busy}
                disabled={busy}
              />
              <Button title={STR.cancel} variant="ghost" onPress={() => setAckId(null)} />
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
            <Button
              title={STR.exAcknowledge}
              variant="secondary"
              onPress={() => { setAckId(e.id); setAckCount(""); setAckNote(""); }}
            />
            <Button title={STR.exCancelHandover} variant="ghost" onPress={() => onCancel(e.id)} disabled={busy} />
          </View>
        )
      ) : null}
    </View>
  );

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700" }}>{STR.exWaitingOnYou}</Body>
            {pending.length > 0 ? <Badge text={bnNum(pending.length)} tone="warn" /> : null}
          </View>
          {pendingQ.fetching ? (
            <Loader label={STR.loading} />
          ) : pending.length === 0 ? (
            <Muted>{STR.exNoPending}</Muted>
          ) : (
            pending.map((e) => eventRow(e, true))
          )}
        </Card>

        {paperId && balance ? (
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>{STR.exCustodyBoard}</Body>
              <Badge text={balance.balanced ? STR.exBalanced : STR.exNotBalanced} tone={balance.balanced ? "ok" : "danger"} />
            </View>
            <Muted>
              {STR.exStudentsPresent}: {bnNum(balance.studentsPresent)}
            </Muted>
            {balance.blockers.map((b, i) => (
              <Muted key={i}>• {b}</Muted>
            ))}
            <View style={{ marginTop: space(2) }}>
              {balance.tallies
                .filter((t) => t.declared > 0 || t.pending > 0 || t.disputed > 0)
                .map((t) => (
                  <View
                    key={t.stage}
                    style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(1) }}
                  >
                    <Muted>{custodyStageLabel(t.stage)}</Muted>
                    <Muted>
                      {STR.exDeclared} {bnNum(t.declared)} · {STR.exCounted} {bnNum(t.counted)}
                      {t.pending ? ` · ${STR.exPending} ${bnNum(t.pending)}` : ""}
                      {t.disputed ? ` · ${STR.exDisputed} ${bnNum(t.disputed)}` : ""}
                    </Muted>
                  </View>
                ))}
            </View>
          </Card>
        ) : null}

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.exNewHandover}</Body>
          {!formOpen ? (
            <View style={{ marginTop: space(2) }}>
              <Button title={STR.exNewHandover} variant="secondary" onPress={() => setFormOpen(true)} />
            </View>
          ) : (
            <View style={{ marginTop: space(2) }}>
              <Select
                label={STR.exStage}
                value={stage}
                onChange={setStage}
                options={CUSTODY_STAGES.map((s) => ({ value: s, label: custodyStageLabel(s) }))}
              />
              <Select
                label={STR.exCustodyTitle}
                value={itemKind}
                onChange={setItemKind}
                options={CUSTODY_ITEM_KINDS.map((k) => ({ value: k, label: custodyItemKindLabel(k) }))}
              />
              <Select
                label={STR.exHandTo}
                value={toUserId}
                onChange={setToUserId}
                options={staff.map((u) => ({ value: u.id, label: u.name }))}
              />
              <Field label={STR.exDeclaredCount} value={count} onChangeText={setCount} keyboardType="numeric" />
              <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                <Button title={STR.exSave} onPress={onRecord} loading={busy} disabled={busy} />
                <Button title={STR.cancel} variant="ghost" onPress={() => setFormOpen(false)} />
              </View>
            </View>
          )}
        </Card>

        {exceptions.length > 0 ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.exExceptions}</Body>
            {exceptions.map((e) => eventRow(e, false))}
          </Card>
        ) : null}

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.exCustodyTitle}</Body>
          {eventsQ.fetching ? (
            <Loader label={STR.loading} />
          ) : events.length === 0 ? (
            <Muted>{STR.exNoHandovers}</Muted>
          ) : (
            events.map((e) => eventRow(e, false))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

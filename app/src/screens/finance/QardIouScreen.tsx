/**
 * QardIouScreen (FIN-3, finance:manage) — the Qard-e-Hasana / IOU register: list/create
 * non-staff parties, record a register entry (disbursement / repayment / adjustment),
 * read per-party outstanding, and the school-wide overdue list. Every action is re-gated
 * server-side — the Bangla deny surfaces inline.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useMutation } from "urql";
import {
  FINANCE_PARTY_KINDS,
  QARD_IOU_TYPES,
  QARD_IOU_DIRECTIONS,
  FINANCE_PAYMENT_MODES,
} from "@scd/shared";
import {
  FINANCE_PARTIES_QUERY,
  SET_FINANCE_PARTY,
  RECORD_QARD_IOU_ENTRY,
  QARD_IOU_PARTY_OUTSTANDING_QUERY,
  QARD_IOU_OVERDUE_QUERY,
} from "../../graphql/finance";
import { Screen, Card, Body, Muted, Button, Field, Select, Row, Notice, Divider, Loader } from "../../components/ui";
import { DateField } from "../../components/DateField";
import {
  STR,
  financePartyKindLabel,
  qardIouTypeLabel,
  qardIouDirectionLabel,
  financeModeLabel,
  bnNum,
  money,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

export default function QardIouScreen(): React.ReactElement {
  const [partiesQ, refetchParties] = useQuery({ query: FINANCE_PARTIES_QUERY, variables: {} });
  const parties = partiesQ.data?.financeParties ?? [];

  const [, setParty] = useMutation(SET_FINANCE_PARTY);
  const [, recordEntry] = useMutation(RECORD_QARD_IOU_ENTRY);

  // Party create
  const [name, setName] = useState("");
  const [nameBn, setNameBn] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const [contact, setContact] = useState("");

  // Entry
  const [partyId, setPartyId] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [direction, setDirection] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [mode, setMode] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");

  // Outstanding / overdue
  const [outstandingPartyId, setOutstandingPartyId] = useState("");
  const [overdueActive, setOverdueActive] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [outstandingQ] = useQuery({
    query: QARD_IOU_PARTY_OUTSTANDING_QUERY,
    variables: { partyId: outstandingPartyId },
    pause: !outstandingPartyId,
  });
  const outstanding = outstandingQ.data?.qardIouPartyOutstanding ?? [];

  const [overdueQ] = useQuery({
    query: QARD_IOU_OVERDUE_QUERY,
    variables: {},
    pause: !overdueActive,
  });
  const overdue = overdueQ.data?.qardIouOverdue ?? [];

  async function onAddParty(): Promise<void> {
    setError(null);
    setOk(null);
    if (!name.trim() || !kind) return setError(STR.errGeneric);
    setBusy(true);
    const res = await setParty({ name: name.trim(), nameBn: nameBn.trim() || null, kind, contact: contact.trim() || null, note: null });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.finPartyAdded);
    setName("");
    setNameBn("");
    setContact("");
    setKind(null);
    refetchParties({ requestPolicy: "network-only" });
  }

  async function onRecordEntry(): Promise<void> {
    setError(null);
    setOk(null);
    // mode is non-null server-side — it used to go as null and the document was
    // rejected wholesale, so the entry never saved (2026-08-03).
    if (!partyId || !type || !direction || !amount.trim() || !date.trim() || !mode) return setError(STR.errGeneric);
    setBusy(true);
    const res = await recordEntry({
      partyId,
      type,
      direction,
      amount: Number(amount),
      date: date.trim(),
      mode,
      dueDate: dueDate.trim() || null,
      note: note.trim() || null,
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.finEntryRecorded);
    setAmount("");
    setNote("");
  }

  const partyOptions = parties.map((p) => ({ label: `${p.nameBn || p.name} · ${financePartyKindLabel(p.kind)}`, value: p.id }));

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {/* Parties */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finParties}</Body>
          {partiesQ.fetching ? (
            <Loader label={STR.loading} />
          ) : parties.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.finNone}</Muted>
          ) : (
            parties.map((p) => <Row key={p.id} label={p.nameBn || p.name} value={financePartyKindLabel(p.kind)} />)
          )}
          <Divider />
          <Field label={STR.finProviderName} value={name} onChangeText={setName} />
          <Field label={STR.finProviderNameBn} value={nameBn} onChangeText={setNameBn} autoCapitalize="sentences" />
          <Select
            label={STR.finPartyKind}
            value={kind}
            options={(FINANCE_PARTY_KINDS as readonly string[]).map((k) => ({ label: financePartyKindLabel(k), value: k }))}
            onChange={setKind}
          />
          <Field label={STR.finContact} value={contact} onChangeText={setContact} />
          <Button title={STR.finAddParty} onPress={onAddParty} loading={busy} disabled={busy} />
        </Card>

        {/* Register entry */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finRegisterEntry}</Body>
          <Select label={STR.finPartyId} value={partyId} options={partyOptions} onChange={setPartyId} searchable />
          <Select
            label={STR.finType}
            value={type}
            options={(QARD_IOU_TYPES as readonly string[]).map((t) => ({ label: qardIouTypeLabel(t), value: t }))}
            onChange={setType}
          />
          <Select
            label={STR.finDirection}
            value={direction}
            options={(QARD_IOU_DIRECTIONS as readonly string[]).map((d) => ({ label: qardIouDirectionLabel(d), value: d }))}
            onChange={setDirection}
          />
          <Field label={STR.finAmount} value={amount} onChangeText={setAmount} keyboardType="number-pad" />
          <DateField label={STR.finDate} value={date} onChange={setDate} />
          <Select
            label={STR.finMode}
            value={mode}
            options={(FINANCE_PAYMENT_MODES as readonly string[]).map((m) => ({ label: financeModeLabel(m), value: m }))}
            onChange={setMode}
          />
          <DateField label={STR.finDueDate} value={dueDate} onChange={setDueDate} min={date || undefined} />
          <Field label={STR.finNote} value={note} onChangeText={setNote} multiline />
          <Button title={STR.finRegisterEntry} onPress={onRecordEntry} loading={busy} disabled={busy} />
        </Card>

        {/* Party outstanding */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finPartyOutstanding}</Body>
          <Select label={STR.finPartyId} value={outstandingPartyId || null} options={partyOptions} onChange={setOutstandingPartyId} searchable />
          {outstandingQ.fetching ? (
            <Loader label={STR.loading} />
          ) : outstandingPartyId && outstanding.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.finNone}</Muted>
          ) : (
            outstanding.map((o, i) => <Row key={i} label={qardIouTypeLabel(o.type)} value={money(o.outstanding)} />)
          )}
        </Card>

        {/* Overdue */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finOverdue}</Body>
          <Button title={STR.finLoadOverdue} variant="secondary" onPress={() => setOverdueActive(true)} />
          {overdueActive && overdueQ.fetching ? (
            <Loader label={STR.loading} />
          ) : overdueActive && overdue.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.finNone}</Muted>
          ) : (
            overdue.map((o, i) => (
              <Row
                key={i}
                label={`${qardIouTypeLabel(o.type)} · ${bnNum(o.daysLate)} ${STR.finDaysLate}`}
                value={money(o.outstanding)}
              />
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

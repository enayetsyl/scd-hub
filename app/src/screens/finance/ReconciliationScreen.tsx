/**
 * ReconciliationScreen (FIN-4, finance:manage) — reconcile the app's DERIVED balance
 * against the bank statement + the entered Eximus per-ledger control figure. Records a
 * reconciliation, shows the bank/Eximus diffs, and lists recent history. Eximus stays a
 * manual parallel figure (no live link). Every action is re-gated server-side.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useMutation } from "urql";
import { RECORD_RECONCILIATION, RECONCILIATION_HISTORY_QUERY } from "../../graphql/finance";
import { Screen, Card, Body, Muted, Button, Field, Row, Notice, Divider, Loader } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR, money } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

export default function ReconciliationScreen(): React.ReactElement {
  const [, record] = useMutation(RECORD_RECONCILIATION);

  const [date, setDate] = useState("");
  const [bankBal, setBankBal] = useState("");
  const [eximusCash, setEximusCash] = useState("");
  const [eximusBank, setEximusBank] = useState("");
  const [eximusOnline, setEximusOnline] = useState("");
  const [note, setNote] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ bankDiff: number; cash: number; bank: number; online: number } | null>(null);

  const [historyActive, setHistoryActive] = useState(false);
  const [historyQ] = useQuery({
    query: RECONCILIATION_HISTORY_QUERY,
    variables: {},
    pause: !historyActive,
  });
  const history = historyQ.data?.reconciliationHistory ?? [];

  async function onRecord(): Promise<void> {
    setError(null);
    setOk(null);
    if (!date.trim() || !bankBal.trim()) return setError(STR.errGeneric);
    setBusy(true);
    const res = await record({
      date: date.trim(),
      bankStatementBalance: Number(bankBal),
      eximusClosing: {
        CASH: eximusCash.trim() ? Number(eximusCash) : 0,
        BANK: eximusBank.trim() ? Number(eximusBank) : 0,
        ONLINE: eximusOnline.trim() ? Number(eximusOnline) : 0,
      },
      note: note.trim() || null,
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    if (res.data) {
      const r = res.data.recordReconciliation;
      setOk(STR.finReconRecorded);
      setLast({ bankDiff: r.bankDiff, cash: r.eximusDiff.CASH, bank: r.eximusDiff.BANK, online: r.eximusDiff.ONLINE });
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.finReconTitle}</Body>
          <DateField label={STR.finDate} value={date} onChange={setDate} />
          <Field label={STR.finBankStatement} value={bankBal} onChangeText={setBankBal} keyboardType="number-pad" />
          <Field label={STR.finEximusCash} value={eximusCash} onChangeText={setEximusCash} keyboardType="number-pad" />
          <Field label={STR.finEximusBank} value={eximusBank} onChangeText={setEximusBank} keyboardType="number-pad" />
          <Field label={STR.finEximusOnline} value={eximusOnline} onChangeText={setEximusOnline} keyboardType="number-pad" />
          <Field label={STR.finNote} value={note} onChangeText={setNote} multiline />
          <Button title={STR.finSubmit} onPress={onRecord} loading={busy} disabled={busy} />
          {last ? (
            <View style={{ marginTop: space(2) }}>
              <Divider />
              <Row label={STR.finBankDiff} value={money(last.bankDiff)} />
              <Row label={`${STR.finEximusDiff} · ${STR.finEximusCash}`} value={money(last.cash)} />
              <Row label={`${STR.finEximusDiff} · ${STR.finEximusBank}`} value={money(last.bank)} />
              <Row label={`${STR.finEximusDiff} · ${STR.finEximusOnline}`} value={money(last.online)} />
            </View>
          ) : null}
        </Card>

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finReconHistory}</Body>
          <Button title={STR.finLoad} variant="secondary" onPress={() => setHistoryActive(true)} />
          {historyActive && historyQ.fetching ? (
            <Loader label={STR.loading} />
          ) : historyActive && history.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.finNone}</Muted>
          ) : (
            history.map((r) => <Row key={r.id} label={r.date} value={`${STR.finBankDiff}: ${money(r.bankDiff)}`} />)
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

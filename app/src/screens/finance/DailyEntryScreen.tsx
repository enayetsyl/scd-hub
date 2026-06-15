/**
 * DailyEntryScreen (FIN-2A, finance:manage) — record a fee collection / other income /
 * expense / transfer via recordFinancePosting. The kind discriminates the required
 * block: FEE_COLLECTION needs studentId + per-head feeLines; OTHER_INCOME an incomeHead;
 * EXPENSE an expenseHead (SALARY may carry a salary base); TRANSFER a mode + toLedger.
 * Every action is re-gated server-side — the Bangla deny surfaces inline.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useMutation } from "urql";
import {
  FINANCE_POSTING_KINDS,
  FINANCE_PAYMENT_MODES,
  FINANCE_INCOME_HEADS,
  FINANCE_EXPENSE_HEADS,
  FINANCE_STUDENT_FEE_HEADS,
  LEDGER_KINDS,
} from "@scd/shared";
import { RECORD_FINANCE_POSTING, type FeeLineInput } from "../../graphql/finance";
import { Screen, Card, Body, Button, Field, Select, Notice, Divider } from "../../components/ui";
import {
  STR,
  financePostingKindLabel,
  financeModeLabel,
  financeIncomeHeadLabel,
  financeExpenseHeadLabel,
  financeFeeHeadLabel,
  ledgerKindLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type FeeLineRow = { head: string | null; amount: string };

export default function DailyEntryScreen(): React.ReactElement {
  const [, record] = useMutation(RECORD_FINANCE_POSTING);

  const [date, setDate] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [studentId, setStudentId] = useState("");
  const [feeLines, setFeeLines] = useState<FeeLineRow[]>([{ head: null, amount: "" }]);
  const [incomeHead, setIncomeHead] = useState<string | null>(null);
  const [expenseHead, setExpenseHead] = useState<string | null>(null);
  const [toLedger, setToLedger] = useState<string | null>(null);
  const [salaryBase, setSalaryBase] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setFeeRow(i: number, patch: Partial<FeeLineRow>): void {
    setFeeLines((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function onSubmit(): Promise<void> {
    setError(null);
    setOk(null);
    if (!date.trim() || !kind) return setError(STR.errGeneric);
    setBusy(true);
    const lines: FeeLineInput[] = feeLines
      .filter((r) => r.head && r.amount.trim())
      .map((r) => ({ head: r.head as string, amount: Number(r.amount) }));
    const res = await record({
      date: date.trim(),
      kind,
      mode: mode ?? null,
      amount: amount.trim() ? Number(amount) : null,
      note: note.trim() || null,
      studentId: kind === "FEE_COLLECTION" ? studentId.trim() || null : null,
      feeLines: kind === "FEE_COLLECTION" ? lines : null,
      incomeHead: kind === "OTHER_INCOME" ? incomeHead : null,
      expenseHead: kind === "EXPENSE" ? expenseHead : null,
      toLedger: kind === "TRANSFER" ? toLedger : null,
      salaryBaseAmount: kind === "EXPENSE" && salaryBase.trim() ? Number(salaryBase) : null,
      salaryAdjustments: null,
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    if (res.data) setOk(STR.finRecorded);
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.finDailyEntryTitle}</Body>
          <Field label={STR.finDate} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
          <Select
            label={STR.finKind}
            value={kind}
            options={(FINANCE_POSTING_KINDS as readonly string[]).map((k) => ({ label: financePostingKindLabel(k), value: k }))}
            onChange={setKind}
            placeholder={STR.finPickKind}
          />
          <Field label={STR.finAmount} value={amount} onChangeText={setAmount} keyboardType="number-pad" />
          <Select
            label={STR.finMode}
            value={mode}
            options={(FINANCE_PAYMENT_MODES as readonly string[]).map((m) => ({ label: financeModeLabel(m), value: m }))}
            onChange={setMode}
          />

          {kind === "FEE_COLLECTION" ? (
            <>
              <Divider />
              <Field label={STR.finStudentId} value={studentId} onChangeText={setStudentId} />
              <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.finFeeLines}</Body>
              {feeLines.map((r, i) => (
                <View key={i} style={{ marginBottom: space(2) }}>
                  <Select
                    label={STR.finHead}
                    value={r.head}
                    options={(FINANCE_STUDENT_FEE_HEADS as readonly string[]).map((h) => ({ label: financeFeeHeadLabel(h), value: h }))}
                    onChange={(v) => setFeeRow(i, { head: v })}
                  />
                  <Field label={STR.finAmount} value={r.amount} onChangeText={(t) => setFeeRow(i, { amount: t })} keyboardType="number-pad" />
                </View>
              ))}
              <Button title={STR.finAddFeeLine} variant="secondary" onPress={() => setFeeLines((r) => [...r, { head: null, amount: "" }])} />
            </>
          ) : null}

          {kind === "OTHER_INCOME" ? (
            <Select
              label={STR.finIncomeHead}
              value={incomeHead}
              options={(FINANCE_INCOME_HEADS as readonly string[]).map((h) => ({ label: financeIncomeHeadLabel(h), value: h }))}
              onChange={setIncomeHead}
            />
          ) : null}

          {kind === "EXPENSE" ? (
            <>
              <Select
                label={STR.finExpenseHead}
                value={expenseHead}
                options={(FINANCE_EXPENSE_HEADS as readonly string[]).map((h) => ({ label: financeExpenseHeadLabel(h), value: h }))}
                onChange={setExpenseHead}
              />
              {expenseHead === "SALARY" ? (
                <Field label={STR.finSalaryBase} value={salaryBase} onChangeText={setSalaryBase} keyboardType="number-pad" />
              ) : null}
            </>
          ) : null}

          {kind === "TRANSFER" ? (
            <Select
              label={STR.finToLedger}
              value={toLedger}
              options={(LEDGER_KINDS as readonly string[]).map((l) => ({ label: ledgerKindLabel(l), value: l }))}
              onChange={setToLedger}
            />
          ) : null}

          <Field label={STR.finNote} value={note} onChangeText={setNote} multiline />
          <View style={{ marginTop: space(2) }}>
            <Button title={STR.finSubmit} onPress={onSubmit} loading={busy} disabled={busy} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

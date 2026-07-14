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
import { Screen, Card, Body, Button, Field, Select, Divider } from "../../components/ui";
import { DateField } from "../../components/DateField";
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
import { required } from "../../lib/validate";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme/tokens";
import { dateKey } from "../../lib/dates";

type FeeLineRow = { head: string | null; amount: string };

const todayISO = (): string => dateKey();

export default function DailyEntryScreen(): React.ReactElement {
  const [, record] = useMutation(RECORD_FINANCE_POSTING);

  // UX-6 default: the entry date is today (editable) — most postings are same-day.
  const [date, setDate] = useState(todayISO());
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

  // R-Validate (UX-1): per-field errors; the toast names the first offending field.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  function setFeeRow(i: number, patch: Partial<FeeLineRow>): void {
    setFeeLines((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function onSubmit(): Promise<void> {
    setFieldErrors({});
    const { firstErrorKey, errors } = required({
      date: { value: date.trim(), message: `${STR.finDate} — ${STR.fieldRequired}` },
      kind: { value: kind, message: `${STR.finKind} — ${STR.fieldRequired}` },
    });
    if (firstErrorKey) {
      setFieldErrors(errors);
      toast.show(errors[firstErrorKey], "danger");
      return;
    }
    setBusy(true);
    const lines: FeeLineInput[] = feeLines
      .filter((r) => r.head && r.amount.trim())
      .map((r) => ({ head: r.head as string, amount: Number(r.amount) }));
    const res = await record({
      date: date.trim(),
      kind: kind!,
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
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    if (res.data) {
      toast.show(STR.finRecorded, "ok");
      // UX-6 repeat-entry flow: keep the date (and kind/mode/heads) for the next
      // posting of the same batch; clear only the per-entry amount + description.
      setAmount("");
      setNote("");
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.finDailyEntryTitle}</Body>
          <DateField label={STR.finDate} value={date} onChange={setDate} error={fieldErrors.date} />
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

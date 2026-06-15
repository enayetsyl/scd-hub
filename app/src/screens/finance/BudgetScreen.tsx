/**
 * BudgetScreen (FIN-5, finance:manage) — set a per-head annual budget line (expense or
 * income) for an academic year, then read budget-vs-actual (per-head cumulative target/
 * actual/variance) and the month-by-month surplus/deficit. Every action is re-gated
 * server-side — the Bangla deny surfaces inline.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useMutation } from "urql";
import { BUDGET_LINE_KINDS, FINANCE_EXPENSE_HEADS, FINANCE_INCOME_HEADS } from "@scd/shared";
import {
  SET_BUDGET_LINE,
  BUDGET_VS_ACTUAL_QUERY,
  BUDGET_SURPLUS_DEFICIT_QUERY,
} from "../../graphql/finance";
import { Screen, Card, Body, Muted, Button, Field, Select, Row, Notice, Divider, Loader } from "../../components/ui";
import {
  STR,
  budgetLineKindLabel,
  financeExpenseHeadLabel,
  financeIncomeHeadLabel,
  money,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

export default function BudgetScreen(): React.ReactElement {
  const [, setLine] = useMutation(SET_BUDGET_LINE);

  const [academicYearId, setAcademicYearId] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const [head, setHead] = useState<string | null>(null);
  const [annualAmount, setAnnualAmount] = useState("");
  const [note, setNote] = useState("");

  const [reportYearId, setReportYearId] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [vsActualQ] = useQuery({
    query: BUDGET_VS_ACTUAL_QUERY,
    variables: { academicYearId: reportYearId },
    pause: !reportYearId,
  });
  const vsActual = vsActualQ.data?.budgetVsActual ?? null;

  const [surplusQ] = useQuery({
    query: BUDGET_SURPLUS_DEFICIT_QUERY,
    variables: { academicYearId: reportYearId },
    pause: !reportYearId,
  });
  const surplus = surplusQ.data?.budgetSurplusDeficit ?? null;

  const headOptions =
    kind === "INCOME"
      ? (FINANCE_INCOME_HEADS as readonly string[]).map((h) => ({ label: financeIncomeHeadLabel(h), value: h }))
      : (FINANCE_EXPENSE_HEADS as readonly string[]).map((h) => ({ label: financeExpenseHeadLabel(h), value: h }));

  function headLabel(k: string, h: string): string {
    return k === "INCOME" ? financeIncomeHeadLabel(h) : financeExpenseHeadLabel(h);
  }

  async function onSave(): Promise<void> {
    setError(null);
    setOk(null);
    if (!academicYearId.trim() || !kind || !head || !annualAmount.trim()) return setError(STR.errGeneric);
    setBusy(true);
    const res = await setLine({
      academicYearId: academicYearId.trim(),
      head,
      kind,
      annualAmount: Number(annualAmount),
      note: note.trim() || null,
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.finBudgetSaved);
    setAnnualAmount("");
    setNote("");
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.finSetBudgetLine}</Body>
          <Field label={STR.finAcademicYearId} value={academicYearId} onChangeText={setAcademicYearId} />
          <Select
            label={STR.finKind}
            value={kind}
            options={(BUDGET_LINE_KINDS as readonly string[]).map((k) => ({ label: budgetLineKindLabel(k), value: k }))}
            onChange={(v) => {
              setKind(v);
              setHead(null);
            }}
          />
          <Select label={STR.finHead} value={head} options={headOptions} onChange={setHead} />
          <Field label={STR.finAnnualAmount} value={annualAmount} onChangeText={setAnnualAmount} keyboardType="number-pad" />
          <Field label={STR.finNote} value={note} onChangeText={setNote} multiline />
          <Button title={STR.finSave} onPress={onSave} loading={busy} disabled={busy} />
        </Card>

        <Card>
          <Field label={STR.finAcademicYearId} value={reportYearId} onChangeText={setReportYearId} />
        </Card>

        {/* Budget vs actual */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finBudgetVsActual}</Body>
          {vsActualQ.fetching ? (
            <Loader label={STR.loading} />
          ) : vsActualQ.error ? (
            <Muted style={{ marginTop: space(2) }}>{friendlyError(vsActualQ.error)}</Muted>
          ) : !vsActual || vsActual.lines.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.finNone}</Muted>
          ) : (
            vsActual.lines.map((l, i) => (
              <View key={i} style={{ marginTop: space(2) }}>
                <Body style={{ fontWeight: "700" }}>
                  {headLabel(l.kind, l.head)} · {budgetLineKindLabel(l.kind)}
                </Body>
                <Row label={STR.finTarget} value={money(l.cumulativeTarget)} />
                <Row label={STR.finActual} value={money(l.cumulativeActual)} />
                <Row label={STR.finVariance} value={money(l.cumulativeVariance)} />
                <Divider />
              </View>
            ))
          )}
        </Card>

        {/* Surplus / deficit */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finSurplusDeficit}</Body>
          {surplusQ.fetching ? (
            <Loader label={STR.loading} />
          ) : !surplus ? (
            <Muted style={{ marginTop: space(2) }}>{STR.finNone}</Muted>
          ) : (
            <>
              <Row label={STR.finYtdIncome} value={money(surplus.ytdIncome)} />
              <Row label={STR.finYtdExpense} value={money(surplus.ytdExpense)} />
              <Row label={STR.finYtdSurplus} value={money(surplus.ytdSurplus)} />
              <Divider />
              {surplus.months.map((m) => (
                <Row key={m.monthKey} label={m.monthKey} value={`${STR.finSurplus}: ${money(m.surplus)}`} />
              ))}
            </>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

/**
 * FinanceDashboardScreen (FIN-6A, finance:manage) — the year-level finance view:
 * financeYearOverview KPIs (cash position, YTD income/expense/surplus, Qard/IOU/zakat/
 * receivable/fees-due outstandings, last reconciliation), the YTD income statement
 * (financeYtdIncomeStatement), and the per-month income/expense/net trend (financeTrends).
 * Reads only; re-gated server-side.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "urql";
import {
  FINANCE_YEAR_OVERVIEW_QUERY,
  FINANCE_YTD_INCOME_STATEMENT_QUERY,
  FINANCE_TRENDS_QUERY,
} from "../../graphql/finance";
import { Screen, Card, Body, Muted, Button, Field, Row, Divider, Loader } from "../../components/ui";
import {
  STR,
  financeIncomeHeadLabel,
  financeExpenseHeadLabel,
  money,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

export default function FinanceDashboardScreen(): React.ReactElement {
  const [academicYearId, setAcademicYearId] = useState("");
  const [active, setActive] = useState("");

  const [overviewQ] = useQuery({
    query: FINANCE_YEAR_OVERVIEW_QUERY,
    variables: { academicYearId: active },
    pause: !active,
  });
  const overview = overviewQ.data?.financeYearOverview ?? null;

  const [stmtQ] = useQuery({
    query: FINANCE_YTD_INCOME_STATEMENT_QUERY,
    variables: { academicYearId: active },
    pause: !active,
  });
  const statement = stmtQ.data?.financeYtdIncomeStatement ?? null;

  const [trendsQ] = useQuery({
    query: FINANCE_TRENDS_QUERY,
    variables: { academicYearId: active },
    pause: !active,
  });
  const trends = trendsQ.data?.financeTrends ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Field label={STR.finAcademicYearId} value={academicYearId} onChangeText={setAcademicYearId} />
          <Button title={STR.finLoad} variant="secondary" onPress={() => setActive(academicYearId.trim())} />
        </Card>

        {/* Year overview KPIs */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finDashboardTitle}</Body>
          {overviewQ.fetching ? (
            <Loader label={STR.loading} />
          ) : overviewQ.error ? (
            <Muted style={{ marginTop: space(2) }}>{friendlyError(overviewQ.error)}</Muted>
          ) : !overview ? (
            <Muted style={{ marginTop: space(2) }}>{STR.finNone}</Muted>
          ) : (
            <>
              <Row label={STR.finCashPosition} value={money(overview.cashPosition)} />
              <Row label={STR.finYtdIncome} value={money(overview.ytdIncome)} />
              <Row label={STR.finYtdExpense} value={money(overview.ytdExpense)} />
              <Row label={STR.finYtdSurplus} value={money(overview.ytdSurplus)} />
              <Divider />
              <Row label={STR.finQardOutstanding} value={money(overview.qardOutstanding)} />
              <Row label={STR.finIouOutstanding} value={money(overview.iouOutstanding)} />
              <Row label={STR.finZakatApplied} value={money(overview.zakatApplied)} />
              <Row label={STR.finProviderReceivable} value={money(overview.providerReceivableOutstanding)} />
              <Row label={STR.finFeesDue} value={money(overview.feesDueOutstanding)} />
              {overview.lastReconciliation ? (
                <>
                  <Divider />
                  <Row
                    label={STR.finLastRecon}
                    value={`${overview.lastReconciliation.date} · ${STR.finBankDiff}: ${money(overview.lastReconciliation.bankDiff)}`}
                  />
                </>
              ) : null}
            </>
          )}
        </Card>

        {/* YTD income statement */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finIncomeStatement}</Body>
          {stmtQ.fetching ? (
            <Loader label={STR.loading} />
          ) : !statement ? (
            <Muted style={{ marginTop: space(2) }}>{STR.finNone}</Muted>
          ) : (
            <>
              {statement.incomeLines.map((l, i) => (
                <Row key={`i-${i}`} label={financeIncomeHeadLabel(l.head)} value={money(l.amount)} />
              ))}
              <Row label={STR.finTotalIncome} value={money(statement.totalIncome)} />
              <Divider />
              {statement.expenseLines.map((l, i) => (
                <Row key={`e-${i}`} label={financeExpenseHeadLabel(l.head)} value={money(l.amount)} />
              ))}
              <Row label={STR.finTotalExpense} value={money(statement.totalExpense)} />
              <Divider />
              <Row label={STR.finNet} value={money(statement.net)} />
            </>
          )}
        </Card>

        {/* Trends */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finTrends}</Body>
          {trendsQ.fetching ? (
            <Loader label={STR.loading} />
          ) : trends.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.finNone}</Muted>
          ) : (
            trends.map((t) => (
              <View key={t.monthKey} style={{ marginTop: space(1) }}>
                <Row
                  label={t.monthKey}
                  value={`${STR.finIncome}: ${money(t.income)} · ${STR.finExpense}: ${money(t.expense)} · ${STR.finNet}: ${money(t.net)}`}
                />
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

/**
 * FeesZakatScreen (FIN-2B, finance:manage) — third-party fee support (zakat/providers):
 * list/create providers, set a per-head coverage allocation for a student, view a
 * provider statement, chase a student's guardian fee due (showing the wa.me link), and
 * read a child's fee history. Every action is re-gated server-side (Bangla deny inline).
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useMutation } from "urql";
import { FINANCE_STUDENT_FEE_HEADS, FEE_COVERAGE_TYPES } from "@scd/shared";
import {
  FEE_PROVIDERS_QUERY,
  CREATE_FEE_PROVIDER,
  SET_FEE_SUPPORT_ALLOCATION,
  FINANCE_PROVIDER_STATEMENT_QUERY,
  CHASE_FEE_DUE,
  STUDENT_FEE_HISTORY_QUERY,
  type FeeCoverageInput,
} from "../../graphql/finance";
import { Screen, Card, Body, Muted, Button, Field, Select, Row, Notice, Divider, Loader } from "../../components/ui";
import { DateField } from "../../components/DateField";
import {
  STR,
  financeFeeHeadLabel,
  feeCoverageTypeLabel,
  financePostingKindLabel,
  money,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type CoverageRow = { head: string | null; type: string | null; amount: string };

export default function FeesZakatScreen(): React.ReactElement {
  const [providersQ, refetchProviders] = useQuery({ query: FEE_PROVIDERS_QUERY, variables: {} });
  const providers = providersQ.data?.feeProviders ?? [];

  const [, createProvider] = useMutation(CREATE_FEE_PROVIDER);
  const [, setAllocation] = useMutation(SET_FEE_SUPPORT_ALLOCATION);
  const [, chase] = useMutation(CHASE_FEE_DUE);

  // Provider create
  const [name, setName] = useState("");
  const [nameBn, setNameBn] = useState("");
  const [contact, setContact] = useState("");

  // Allocation
  const [allocStudentId, setAllocStudentId] = useState("");
  const [allocProviderId, setAllocProviderId] = useState<string | null>(null);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [coverage, setCoverage] = useState<CoverageRow[]>([{ head: null, type: null, amount: "" }]);

  // Statement
  const [stmtProviderId, setStmtProviderId] = useState("");
  // Chase
  const [chaseStudentId, setChaseStudentId] = useState("");
  const [chaseResult, setChaseResult] = useState<{ guardianDue: number; waLink: string | null; unreachable: boolean } | null>(null);
  // History
  const [historyStudentId, setHistoryStudentId] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [stmtQ] = useQuery({
    query: FINANCE_PROVIDER_STATEMENT_QUERY,
    variables: { providerId: stmtProviderId },
    pause: !stmtProviderId,
  });
  const statement = stmtQ.data?.financeProviderStatement ?? null;

  const [historyQ] = useQuery({
    query: STUDENT_FEE_HISTORY_QUERY,
    variables: { studentId: historyStudentId },
    pause: !historyStudentId,
  });
  const history = historyQ.data?.studentFeeHistory ?? [];

  function setCoverageRow(i: number, patch: Partial<CoverageRow>): void {
    setCoverage((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function onAddProvider(): Promise<void> {
    setError(null);
    setOk(null);
    if (!name.trim()) return setError(STR.errGeneric);
    setBusy(true);
    const res = await createProvider({ name: name.trim(), nameBn: nameBn.trim() || null, contact: contact.trim() || null, note: null });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.finProviderAdded);
    setName("");
    setNameBn("");
    setContact("");
    refetchProviders({ requestPolicy: "network-only" });
  }

  async function onSetAllocation(): Promise<void> {
    setError(null);
    setOk(null);
    if (!allocStudentId.trim() || !allocProviderId || !effectiveDate.trim()) return setError(STR.errGeneric);
    const cov: FeeCoverageInput[] = coverage
      .filter((r) => r.head && r.type)
      .map((r) => ({ head: r.head as string, type: r.type as string, amount: r.amount.trim() ? Number(r.amount) : null }));
    if (cov.length === 0) return setError(STR.errGeneric);
    setBusy(true);
    const res = await setAllocation({
      studentId: allocStudentId.trim(),
      providerId: allocProviderId,
      coverage: cov,
      effectiveDate: effectiveDate.trim(),
      status: "ACTIVE",
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.finAllocationSet);
  }

  async function onChase(): Promise<void> {
    setError(null);
    setOk(null);
    setChaseResult(null);
    if (!chaseStudentId.trim()) return setError(STR.errGeneric);
    setBusy(true);
    const res = await chase({ studentId: chaseStudentId.trim() });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    if (res.data) {
      const o = res.data.chaseFeeDue;
      setChaseResult({ guardianDue: o.guardianDue, waLink: o.waLink, unreachable: o.unreachableByWa });
    }
  }

  const providerOptions = providers.map((p) => ({ label: p.nameBn || p.name, value: p.id }));

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {/* Providers */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finProviders}</Body>
          {providersQ.fetching ? (
            <Loader label={STR.loading} />
          ) : providers.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.finNone}</Muted>
          ) : (
            providers.map((p) => <Row key={p.id} label={p.nameBn || p.name} value={p.contact || "—"} />)
          )}
          <Divider />
          <Field label={STR.finProviderName} value={name} onChangeText={setName} />
          <Field label={STR.finProviderNameBn} value={nameBn} onChangeText={setNameBn} autoCapitalize="sentences" />
          <Field label={STR.finContact} value={contact} onChangeText={setContact} />
          <Button title={STR.finAddProvider} onPress={onAddProvider} loading={busy} disabled={busy} />
        </Card>

        {/* Allocation */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finSetAllocation}</Body>
          <Field label={STR.finStudentId} value={allocStudentId} onChangeText={setAllocStudentId} />
          <Select label={STR.finProviderId} value={allocProviderId} options={providerOptions} onChange={setAllocProviderId} />
          <DateField label={STR.finEffectiveDate} value={effectiveDate} onChange={setEffectiveDate} />
          {coverage.map((r, i) => (
            <View key={i} style={{ marginBottom: space(2) }}>
              <Select
                label={STR.finHead}
                value={r.head}
                options={(FINANCE_STUDENT_FEE_HEADS as readonly string[]).map((h) => ({ label: financeFeeHeadLabel(h), value: h }))}
                onChange={(v) => setCoverageRow(i, { head: v })}
              />
              <Select
                label={STR.finCoverageType}
                value={r.type}
                options={(FEE_COVERAGE_TYPES as readonly string[]).map((t) => ({ label: feeCoverageTypeLabel(t), value: t }))}
                onChange={(v) => setCoverageRow(i, { type: v })}
              />
              {r.type === "AMOUNT" ? (
                <Field label={STR.finAmount} value={r.amount} onChangeText={(t) => setCoverageRow(i, { amount: t })} keyboardType="number-pad" />
              ) : null}
            </View>
          ))}
          <Button title={STR.finAddFeeLine} variant="secondary" onPress={() => setCoverage((c) => [...c, { head: null, type: null, amount: "" }])} />
          <View style={{ marginTop: space(2) }}>
            <Button title={STR.finSetAllocation} onPress={onSetAllocation} loading={busy} disabled={busy} />
          </View>
        </Card>

        {/* Provider statement */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finProviderStatement}</Body>
          <Select label={STR.finProviderId} value={stmtProviderId || null} options={providerOptions} onChange={setStmtProviderId} />
          {stmtQ.fetching ? (
            <Loader label={STR.loading} />
          ) : statement ? (
            <>
              <Row label={STR.finRaised} value={money(statement.raised)} />
              <Row label={STR.finReceived} value={money(statement.received)} />
              <Row label={STR.finOutstanding} value={money(statement.outstanding)} />
            </>
          ) : null}
        </Card>

        {/* Chase fee due */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finChaseFeeDue}</Body>
          <Field label={STR.finStudentId} value={chaseStudentId} onChangeText={setChaseStudentId} />
          <Button title={STR.finChase} onPress={onChase} loading={busy} disabled={busy} />
          {chaseResult ? (
            <View style={{ marginTop: space(2) }}>
              <Row label={STR.finGuardianDue} value={money(chaseResult.guardianDue)} />
              {chaseResult.waLink ? <Row label={STR.finWaLink} value={chaseResult.waLink} /> : null}
              {chaseResult.unreachable ? <Muted>{STR.finUnreachableWa}</Muted> : null}
            </View>
          ) : null}
        </Card>

        {/* Student fee history */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finFeeHistory}</Body>
          <Field label={STR.finStudentId} value={historyStudentId} onChangeText={setHistoryStudentId} />
          {historyQ.fetching ? (
            <Loader label={STR.loading} />
          ) : historyStudentId && history.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.finNone}</Muted>
          ) : (
            history.map((p) => (
              <Row key={p.id} label={`${p.date} · ${financePostingKindLabel(p.kind)}`} value={money(p.amount)} />
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

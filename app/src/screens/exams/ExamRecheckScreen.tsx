/**
 * ExamRecheckScreen (EX-4) — the rechecker's worksheet, the divergence list and the
 * tabulation gate.
 *
 * The independence rule is enforced SERVER-side (`examRecheckWorksheet` returns
 * `checkerRawMark: null` on rows this rechecker has not answered). The screen simply
 * shows what it is given — it must never fetch the checker's figure by another route,
 * because that would reintroduce exactly the side-by-side-columns problem the paper
 * mark sheets have.
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  EXAM_RECHECK_WORKSHEET_QUERY,
  EXAM_DIVERGENCES_QUERY,
  EXAM_TABULATION_READINESS_QUERY,
  EXAM_PAPER_ROSTER_QUERY,
  ENTER_EXAM_RECHECK_MARKS,
  RESOLVE_EXAM_DIVERGENCE,
  TABULATE_EXAM_PAPER,
} from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Badge, Chip, Loader, Notice, Field, Divider } from "../../components/ui";
import { STR, bnNum, examComponentLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { ExamsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ExamsStackParamList, "ExamRecheck">;

export default function ExamRecheckScreen({ route }: Props): React.ReactElement {
  const { paperId } = route.params;

  const [rosterQ] = useQuery({ query: EXAM_PAPER_ROSTER_QUERY, variables: { paperId } });
  const nameById = useMemo(() => {
    const m = new Map<string, { name: string; schoolId: string }>();
    for (const s of rosterQ.data?.examPaperRoster ?? []) m.set(s.id, { name: s.name, schoolId: s.schoolId });
    return m;
  }, [rosterQ.data]);

  const [sheetQ, refetchSheet] = useQuery({ query: EXAM_RECHECK_WORKSHEET_QUERY, variables: { paperId } });
  const rows = sheetQ.data?.examRecheckWorksheet ?? [];

  const [divQ, refetchDiv] = useQuery({ query: EXAM_DIVERGENCES_QUERY, variables: { paperId } });
  const divergences = divQ.data?.examDivergences ?? [];

  const [readyQ, refetchReady] = useQuery({ query: EXAM_TABULATION_READINESS_QUERY, variables: { paperId } });
  const readiness = readyQ.data?.examTabulationReadiness ?? null;

  const [, enterRecheck] = useMutation(ENTER_EXAM_RECHECK_MARKS);
  const [, resolveDiv] = useMutation(RESOLVE_EXAM_DIVERGENCE);
  const [, tabulate] = useMutation(TABULATE_EXAM_PAPER);

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [isAbsent, setIsAbsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const keyOf = (studentId: string, component: string) => `${studentId}|${component}`;

  function refetchAll(): void {
    refetchSheet({ requestPolicy: "network-only" });
    refetchDiv({ requestPolicy: "network-only" });
    refetchReady({ requestPolicy: "network-only" });
  }

  async function onSubmitRecheck(studentId: string, component: string): Promise<void> {
    setError(null); setOk(null);
    if (!isAbsent && !value.trim()) return setError(STR.errGeneric);
    setBusy(true);
    const res = await enterRecheck({
      paperId,
      studentIds: [studentId],
      components: [component],
      statuses: [isAbsent ? "ABSENT" : "PRESENT"],
      rawMarks: isAbsent ? null : [Number(value)],
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.exSaved);
    setOpenKey(null);
    setValue("");
    setIsAbsent(false);
    refetchAll();
  }

  async function onResolve(studentId: string, component: string, agreed: string, absentAgreed: boolean): Promise<void> {
    setError(null); setOk(null);
    if (!absentAgreed && !agreed.trim()) return setError(STR.errGeneric);
    setBusy(true);
    const res = await resolveDiv({
      paperId,
      studentId,
      component,
      status: absentAgreed ? "ABSENT" : "PRESENT",
      rawMark: absentAgreed ? null : Number(agreed),
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.exResolved);
    setOpenKey(null);
    setValue("");
    refetchAll();
  }

  async function onTabulate(): Promise<void> {
    setError(null); setOk(null); setBusy(true);
    const res = await tabulate({ paperId });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.exTabulateDone);
    refetchAll();
  }

  if (sheetQ.fetching) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {/* Readiness first — it names every blocker, so the screen can say WHY rather
            than letting the user discover it by pressing a button that refuses. */}
        {readiness ? (
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>{STR.exReadyToTabulate}</Body>
              <Badge
                text={readiness.ready ? STR.exBalanced : STR.exNotBalanced}
                tone={readiness.ready ? "ok" : "warn"}
              />
            </View>
            {!readiness.ready ? (
              <View style={{ marginTop: space(2) }}>
                <Muted>{STR.exBlockedBy}:</Muted>
                {readiness.missingMarks > 0 ? (
                  <Muted>• {bnNum(readiness.missingMarks)} {STR.exMissingMarks}</Muted>
                ) : null}
                {readiness.unresolvedDivergences > 0 ? (
                  <Muted>• {bnNum(readiness.unresolvedDivergences)} {STR.exUnresolved}</Muted>
                ) : null}
                {readiness.notRechecked > 0 ? (
                  <Muted>• {bnNum(readiness.notRechecked)} {STR.exNotRechecked}</Muted>
                ) : null}
                {readiness.custodyBlockers.map((b, i) => (
                  <Muted key={i}>• {b}</Muted>
                ))}
              </View>
            ) : null}
            <View style={{ marginTop: space(2) }}>
              <Button
                title={STR.exTabulate}
                onPress={onTabulate}
                loading={busy}
                disabled={busy || !readiness.ready}
              />
            </View>
          </Card>
        ) : null}

        {divergences.length > 0 ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.exDivergences}</Body>
            {divergences.map((d) => {
              const k = keyOf(d.studentId, d.component);
              const who = nameById.get(d.studentId);
              const isOpen = openKey === `res:${k}`;
              return (
                <View key={k} style={{ marginTop: space(2) }}>
                  <Divider />
                  <Body style={{ marginTop: space(2) }}>
                    {who?.name ?? d.studentId} · {examComponentLabel(d.component)}
                  </Body>
                  <Muted>
                    {STR.exCheckerMark}: {d.checkerStatus === "ABSENT" ? STR.exAbsent : bnNum(d.checkerRawMark ?? 0)} ·{" "}
                    {STR.exRecheckMark}: {d.recheckStatus === "ABSENT" ? STR.exAbsent : bnNum(d.recheckRawMark ?? 0)}
                  </Muted>
                  {d.resolved ? (
                    <Badge text={STR.exResolved} tone="ok" />
                  ) : !isOpen ? (
                    <View style={{ marginTop: space(1) }}>
                      <Button
                        title={STR.exResolve}
                        variant="secondary"
                        onPress={() => { setOpenKey(`res:${k}`); setValue(""); setIsAbsent(false); }}
                      />
                    </View>
                  ) : (
                    <View style={{ marginTop: space(1) }}>
                      <View style={{ flexDirection: "row", gap: space(2) }}>
                        <Chip label={STR.exPresent} selected={!isAbsent} onPress={() => setIsAbsent(false)} />
                        <Chip label={STR.exAbsent} selected={isAbsent} onPress={() => setIsAbsent(true)} />
                      </View>
                      {!isAbsent ? (
                        <Field label={STR.exAgreedMark} value={value} onChangeText={setValue} keyboardType="numeric" />
                      ) : null}
                      <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                        <Button
                          title={STR.exResolve}
                          onPress={() => onResolve(d.studentId, d.component, value, isAbsent)}
                          loading={busy}
                          disabled={busy}
                        />
                        <Button title={STR.cancel} variant="ghost" onPress={() => setOpenKey(null)} />
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </Card>
        ) : (
          <Card>
            <Muted>{STR.exNoDivergences}</Muted>
          </Card>
        )}

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.exRecheckTitle}</Body>
          <Muted>{STR.exRecheckHidden}</Muted>
        </Card>

        {rows.map((r) => {
          const k = keyOf(r.studentId, r.component);
          const who = nameById.get(r.studentId);
          const isOpen = openKey === k;
          const answered = r.recheckStatus !== null;
          return (
            <Card key={k}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flexShrink: 1 }}>
                  <Body style={{ fontWeight: "700" }}>{who?.name ?? r.studentId}</Body>
                  <Muted>
                    {who?.schoolId ?? ""} · {examComponentLabel(r.component)}
                  </Muted>
                </View>
                {r.divergent ? <Badge text={STR.exDivergent} tone="warn" /> : answered ? <Badge text={STR.exAcknowledged} tone="ok" /> : null}
              </View>

              <Muted style={{ marginTop: space(1) }}>
                {/* Null here is the independence rule doing its job, not missing data. */}
                {STR.exCheckerMark}:{" "}
                {r.checkerRawMark === null && r.checkerStatus === null
                  ? "•••"
                  : r.checkerStatus === "ABSENT"
                    ? STR.exAbsent
                    : bnNum(r.checkerRawMark ?? 0)}
                {answered
                  ? ` · ${STR.exRecheckMark}: ${r.recheckStatus === "ABSENT" ? STR.exAbsent : bnNum(r.recheckRawMark ?? 0)}`
                  : ""}
              </Muted>

              {!isOpen ? (
                <View style={{ marginTop: space(2) }}>
                  <Button
                    title={answered ? STR.exEdit : STR.exRecheckMark}
                    variant="secondary"
                    onPress={() => {
                      setOpenKey(k);
                      setValue(r.recheckRawMark != null ? String(r.recheckRawMark) : "");
                      setIsAbsent(r.recheckStatus === "ABSENT");
                    }}
                  />
                </View>
              ) : (
                <View style={{ marginTop: space(2) }}>
                  <View style={{ flexDirection: "row", gap: space(2) }}>
                    <Chip label={STR.exPresent} selected={!isAbsent} onPress={() => setIsAbsent(false)} />
                    <Chip label={STR.exAbsent} selected={isAbsent} onPress={() => setIsAbsent(true)} />
                  </View>
                  {!isAbsent ? (
                    <Field label={STR.exRecheckMark} value={value} onChangeText={setValue} keyboardType="numeric" />
                  ) : null}
                  <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                    <Button
                      title={STR.exSave}
                      onPress={() => onSubmitRecheck(r.studentId, r.component)}
                      loading={busy}
                      disabled={busy}
                    />
                    <Button title={STR.cancel} variant="ghost" onPress={() => setOpenKey(null)} />
                  </View>
                </View>
              )}
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

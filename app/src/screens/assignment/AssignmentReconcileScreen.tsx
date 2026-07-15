/**
 * AssignmentReconcileScreen (AS-T6, D-#274) — the weekly load ceiling reconcile.
 * Shows a section's week: per-subject estMinutes, the running total vs the 360-min
 * ceiling, and a Confirm that HARD-BLOCKS while over. Trim a DRAFT subject's minutes
 * to get under the cap. Confirm issues every DRAFT item's per-student records.
 * Owner: the section class teacher OR roster:manage (the server gates).
 */
import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { AS_WEEK_LOAD, SET_AS_ITEM_MINUTES, CONFIRM_AS_WEEK } from "../../graphql/operations";
import type { AssignmentStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Field, Chip, Loader, EmptyState, Notice } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AssignmentStackParamList, "AssignmentReconcile">;

export default function AssignmentReconcileScreen({ route, navigation }: Props): React.ReactElement {
  const { academicYearId, sectionId, weekNumber } = route.params;

  const [loadQ, refetch] = useQuery({
    query: AS_WEEK_LOAD,
    variables: { academicYearId, sectionId, weekNumber },
  });
  const load = loadQ.data?.assignmentWeekLoad ?? null;

  const [, setMinutes] = useMutation(SET_AS_ITEM_MINUTES);
  const [, confirm] = useMutation(CONFIRM_AS_WEEK);

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Seed the per-item minute editors from the loaded values.
  useEffect(() => {
    if (load) {
      const next: Record<string, string> = {};
      for (const it of load.items) next[it.itemId] = String(it.estMinutes);
      setEdits(next);
    }
  }, [load]);

  async function onTrim(itemId: string): Promise<void> {
    setError(null);
    setOk(null);
    const v = parseInt(edits[itemId] ?? "", 10);
    if (!Number.isFinite(v) || v < 0) return setError(STR.asMinutesInvalid);
    const res = await setMinutes({ itemId, estMinutes: v });
    if (res.error || !res.data?.setAssignmentItemMinutes) return setError(friendlyError(res.error));
    setOk(STR.asMinutesSaved);
    refetch({ requestPolicy: "network-only" });
  }

  async function onConfirm(): Promise<void> {
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await confirm({ academicYearId, sectionId, weekNumber });
    setBusy(false);
    if (res.error || !res.data?.confirmAssignmentWeek) return setError(friendlyError(res.error));
    const c = res.data.confirmAssignmentWeek;
    setOk(`${STR.asConfirmed} — ${bnNum(c.itemsIssued)} × ${STR.asSubjects}, ${bnNum(c.recordsIssued)} ${STR.asRecords}`);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {loadQ.fetching && !load ? (
          <Loader label={STR.loading} />
        ) : !load || load.items.length === 0 ? (
          <EmptyState message={STR.asNoItems} />
        ) : (
          <>
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>
                  {STR.asWeek} {bnNum(weekNumber)} — {STR.asWeeklyTotal}
                </Body>
                <Badge
                  text={`${bnNum(load.totalMinutes)} / ${bnNum(load.ceiling)} ${STR.asMinutes}`}
                  tone={load.withinCeiling ? "ok" : "warn"}
                />
              </View>
              {!load.withinCeiling ? (
                <Muted style={{ marginTop: 4 }}>
                  {STR.asOverBy} {bnNum(load.overBy)} {STR.asMinutes} — {STR.asTrimHint}
                </Muted>
              ) : null}
            </Card>

            {load.items.map((it) => (
              <Card key={it.itemId}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ fontWeight: "700" }}>{hwSubjectLabel(it.subject)}</Body>
                  <Badge
                    text={it.status === "ISSUED" ? STR.asDelivered : STR.asDraft}
                    tone={it.status === "ISSUED" ? "ok" : "brand"}
                  />
                </View>
                <Muted style={{ marginTop: 2 }}>{it.asId}</Muted>
                {it.status === "DRAFT" ? (
                  <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space(2), marginTop: 6 }}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={STR.asEstMinutes}
                        value={edits[it.itemId] ?? ""}
                        onChangeText={(v) => setEdits((m) => ({ ...m, [it.itemId]: v }))}
                        keyboardType="number-pad"
                      />
                    </View>
                    <Chip label={STR.asTrim} onPress={() => void onTrim(it.itemId)} />
                  </View>
                ) : (
                  <Muted style={{ marginTop: 4 }}>
                    {bnNum(it.estMinutes)} {STR.asMinutes}
                  </Muted>
                )}
              </Card>
            ))}

            <View style={{ marginTop: 8 }}>
              <Button
                title={STR.asConfirmWeek}
                onPress={onConfirm}
                loading={busy}
                disabled={busy || !load.hasDrafts || !load.withinCeiling}
              />
              {!load.hasDrafts ? <Muted style={{ marginTop: 6 }}>{STR.asAllConfirmed}</Muted> : null}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

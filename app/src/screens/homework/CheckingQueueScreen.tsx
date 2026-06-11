/**
 * CheckingQueueScreen (§8.2) — a subject teacher checks SUBMITTED records.
 * Pick a day's item → see its SUBMITTED records → record RESULT. WRONG auto-spawns
 * a resubmission; PARTIAL spawns only if "resubmit" is chosen; both may carry a
 * Pool top-up (qids + minutes). CORRECT just advances.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { HW_RESULTS } from "@scd/shared";
import { HOMEWORK_ITEMS, HOMEWORK_STUDENT_RECORDS, CHECK_HOMEWORK_RECORD } from "../../graphql/operations";
import type { HomeworkStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Field, Chip, ChipRow, Notice, Loader, EmptyState } from "../../components/ui";
import { SectionBar } from "../../components/SectionBar";
import { STR, bnNum, hwSubjectLabel, hwResultLabel, lifecycleStateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeworkStackParamList, "CheckingQueue">;

const today = (): string => new Date().toISOString().slice(0, 10);

interface Pending {
  result: string;
  resubmit: boolean;
  topupQids: string;
  topupTime: string;
}

export default function CheckingQueueScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const [date, setDate] = useState(today());
  const [itemId, setItemId] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const base = { sectionId: selection.sectionId ?? "", classId: selection.classId ?? "" };
  const [itemsQ] = useQuery({
    query: HOMEWORK_ITEMS,
    variables: { ...base, dateGiven: date },
    pause: !hasSection,
  });
  const [recsQ, refetchRecs] = useQuery({
    query: HOMEWORK_STUDENT_RECORDS,
    variables: { ...base, itemId: itemId ?? "" },
    pause: !hasSection || !itemId,
  });
  const [, check] = useMutation(CHECK_HOMEWORK_RECORD);

  const items = (itemsQ.data?.homeworkItems ?? []).filter((i) => i.status === "issued");
  const submitted = (recsQ.data?.homeworkStudentRecords ?? []).filter((r) => r.state === "SUBMITTED");

  function setPend(id: string, patch: Partial<Pending>): void {
    setPending((m) => {
      const cur: Pending = m[id] ?? { result: "", resubmit: false, topupQids: "", topupTime: "" };
      return { ...m, [id]: { ...cur, ...patch } };
    });
  }

  async function onCheck(recordId: string): Promise<void> {
    setError(null);
    setOk(null);
    const p = pending[recordId];
    const result = p?.result;
    if (!result) return setError(STR.hwResult);
    const qids = (p?.topupQids ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    const topupTime = (p?.topupTime ?? "").trim() === "" ? undefined : parseInt(p!.topupTime, 10);
    setBusy(true);
    const res = await check({
      sectionId: base.sectionId,
      recordId,
      result,
      resubmit: result === "PARTIAL" ? p?.resubmit ?? false : undefined,
      topupQids: qids.length > 0 ? qids : undefined,
      topupTime: qids.length > 0 ? topupTime : undefined,
    });
    setBusy(false);
    if (res.error || !res.data?.checkHomeworkRecord) return setError(friendlyError(res.error));
    const spawned = res.data.checkHomeworkRecord.resubmission;
    setOk(spawned ? `${hwResultLabel(result)} · ${STR.hwResubSpawned}` : hwResultLabel(result));
    setPending((m) => {
      const next = { ...m };
      delete next[recordId];
      return next;
    });
    refetchRecs({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <SectionBar onChange={() => navigation.navigate("SectionPicker")} />
        {hasSection ? <Field label={STR.hwDate} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" /> : null}
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {!hasSection ? (
          <EmptyState message={STR.pickSection} />
        ) : itemsQ.fetching && items.length === 0 ? (
          <Loader label={STR.loading} />
        ) : items.length === 0 ? (
          <EmptyState message={STR.empty} />
        ) : (
          <>
            {ok ? <Notice message={ok} tone="ok" /> : null}
            {error ? <Notice message={error} tone="danger" /> : null}

            <Card>
              <Body style={{ fontWeight: "700", marginBottom: 6 }}>{STR.hwToday}</Body>
              <ChipRow>
                {items.map((i) => (
                  <Chip key={i.id} label={`${hwSubjectLabel(i.subject)}`} selected={itemId === i.id} onPress={() => setItemId(i.id)} />
                ))}
              </ChipRow>
            </Card>

            {itemId ? (
              recsQ.fetching && submitted.length === 0 ? (
                <Loader label={STR.loading} />
              ) : submitted.length === 0 ? (
                <EmptyState message={STR.hwNoSubmitted} />
              ) : (
                submitted.map((r) => {
                  const p = pending[r.id];
                  const showTopup = p?.result === "WRONG" || p?.result === "PARTIAL";
                  return (
                    <Card key={r.id}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Muted>{r.hwId}</Muted>
                        <Badge text={lifecycleStateLabel(r.state)} tone="brand" />
                      </View>
                      <Muted style={{ marginTop: 4 }}>{STR.hwResult}</Muted>
                      <ChipRow>
                        {HW_RESULTS.map((rv) => (
                          <Chip key={rv} label={hwResultLabel(rv)} selected={p?.result === rv} onPress={() => setPend(r.id, { result: rv })} />
                        ))}
                      </ChipRow>
                      {showTopup ? (
                        <View style={{ marginTop: 6 }}>
                          {p?.result === "PARTIAL" ? (
                            <ChipRow>
                              <Chip label={STR.hwResubmit} selected={!!p?.resubmit} onPress={() => setPend(r.id, { resubmit: !p?.resubmit })} />
                            </ChipRow>
                          ) : null}
                          <Field label={STR.hwTopupQids} value={p?.topupQids ?? ""} onChangeText={(t) => setPend(r.id, { topupQids: t })} />
                          <Field label={STR.hwTopupTime} value={p?.topupTime ?? ""} onChangeText={(t) => setPend(r.id, { topupTime: t })} keyboardType="number-pad" />
                        </View>
                      ) : null}
                      <View style={{ marginTop: 6 }}>
                        <Button title={STR.hwCheck} onPress={() => onCheck(r.id)} loading={busy} disabled={busy || !p?.result} />
                      </View>
                    </Card>
                  );
                })
              )
            ) : (
              <Muted>{STR.pickSet}</Muted>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * CheckingQueueScreen (§8.2) — a subject teacher checks SUBMITTED records.
 * Auto-lists EVERY pending (SUBMITTED) record for the section across all dates,
 * grouped into date-wise cards — no manual date pick. Record RESULT per student:
 * WRONG auto-spawns a resubmission; PARTIAL spawns only if "resubmit" is chosen;
 * both may carry a Pool top-up (qids + minutes). CORRECT just advances.
 */
import React, { useState, useRef, useCallback, useMemo } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import { HW_RESULTS } from "@scd/shared";
import { HOMEWORK_OPEN_RECORDS, CHECK_HOMEWORK_RECORD, ATTACH_HW_ANSWER_FILE } from "../../graphql/operations";
import { pickAndUploadHomeworkFile, FileUploadError } from "../../lib/files";
import { groupByDate } from "../../lib/groupByDate";
import type { HomeworkStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Field, Chip, ChipRow, Notice, Loader, EmptyState } from "../../components/ui";
import { SectionBar } from "../../components/SectionBar";
import { STR, bnNum, hwSubjectLabel, hwResultLabel, dateHeaderLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeworkStackParamList, "CheckingQueue">;

interface Pending {
  result: string;
  resubmit: boolean;
  topupQids: string;
  topupTime: string;
}

export default function CheckingQueueScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileBusyId, setFileBusyId] = useState<string | null>(null);

  const base = { sectionId: selection.sectionId ?? "", classId: selection.classId ?? "" };
  const [recsQ, refetchRecs] = useQuery({
    query: HOMEWORK_OPEN_RECORDS,
    variables: { ...base, states: ["SUBMITTED"] },
    pause: !hasSection,
  });
  const [, check] = useMutation(CHECK_HOMEWORK_RECORD);
  const [, attachAnswer] = useMutation(ATTACH_HW_ANSWER_FILE);

  const records = recsQ.data?.homeworkOpenRecords ?? [];
  const groups = useMemo(() => groupByDate(records, (r) => r.dateGiven), [records]);

  // Refresh on focus (e.g. after marking a record submitted on Records) so newly
  // pending items appear without a reload.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      if (hasSection) refetchRecs({ requestPolicy: "network-only" });
    }, [hasSection, refetchRecs]),
  );

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

  /** Optional checked-answer attach (GP-A, D-#70) — failure shows a Bangla notice
   *  and never blocks checking (GP-J8). */
  async function onAttachAnswer(recordId: string): Promise<void> {
    if (fileBusyId) return;
    setError(null);
    setOk(null);
    setFileBusyId(recordId);
    try {
      const uploaded = await pickAndUploadHomeworkFile("answer");
      if (!uploaded) return;
      const res = await attachAnswer({ recordId, fileId: uploaded.fileId });
      if (res.error || !res.data?.attachHomeworkAnswerFile) {
        setError(friendlyError(res.error));
        return;
      }
      setOk(STR.hwFileAttached);
      refetchRecs({ requestPolicy: "network-only" });
    } catch (e) {
      setError(e instanceof FileUploadError ? e.message : STR.hwFileUploadFail);
    } finally {
      setFileBusyId(null);
    }
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <SectionBar onChange={() => navigation.navigate("SectionPicker")} />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {!hasSection ? (
          <EmptyState message={STR.pickSection} />
        ) : recsQ.fetching && records.length === 0 ? (
          <Loader label={STR.loading} />
        ) : records.length === 0 ? (
          <EmptyState message={STR.hwNoSubmitted} />
        ) : (
          <>
            {ok ? <Notice message={ok} tone="ok" /> : null}
            {error ? <Notice message={error} tone="danger" /> : null}

            {groups.map((g) => (
              <View key={g.dateKey} style={{ marginBottom: space(2) }}>
                <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>{dateHeaderLabel(g.dateKey)}</Muted>
                {g.items.map((r) => {
                  const p = pending[r.id];
                  const showTopup = p?.result === "WRONG" || p?.result === "PARTIAL";
                  return (
                    <Card key={r.id}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Body style={{ fontWeight: "700", flex: 1 }}>{r.studentName}</Body>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                          {r.hasAnswerFile ? <Badge text={STR.hwFileHas} tone="ok" /> : null}
                          <Badge text={hwSubjectLabel(r.subject)} tone="brand" />
                        </View>
                      </View>
                      <Muted style={{ marginTop: 2 }}>{r.hwId}{r.topicLabelBn ? ` · 📘 ${r.topicLabelBn}` : ""}</Muted>
                      <Muted style={{ marginTop: 4 }}>{STR.hwResult}</Muted>
                      <ChipRow>
                        {HW_RESULTS.map((rv) => (
                          <Chip key={rv} label={hwResultLabel(rv)} selected={p?.result === rv} onPress={() => setPend(r.id, { result: rv })} />
                        ))}
                      </ChipRow>
                      {showTopup ? (
                        <View style={{ marginTop: 8 }}>
                          {p?.result === "PARTIAL" ? (
                            <ChipRow>
                              <Chip label={STR.hwResubmit} selected={!!p?.resubmit} onPress={() => setPend(r.id, { resubmit: !p?.resubmit })} />
                            </ChipRow>
                          ) : null}
                          <Field label={STR.hwTopupQids} value={p?.topupQids ?? ""} onChangeText={(t) => setPend(r.id, { topupQids: t })} />
                          <Field label={STR.hwTopupTime} value={p?.topupTime ?? ""} onChangeText={(t) => setPend(r.id, { topupTime: t })} keyboardType="number-pad" />
                        </View>
                      ) : null}
                      <View style={{ marginTop: 8 }}>
                        <Button title={STR.hwCheck} onPress={() => onCheck(r.id)} loading={busy} disabled={busy || !p?.result} />
                      </View>
                      <View style={{ marginTop: 8 }}>
                        <Button
                          title={STR.hwAttachAnswer}
                          variant="secondary"
                          onPress={() => onAttachAnswer(r.id)}
                          loading={fileBusyId === r.id}
                          disabled={fileBusyId !== null}
                        />
                      </View>
                    </Card>
                  );
                })}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

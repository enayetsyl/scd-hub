/**
 * CheckingQueueScreen (HWG-2, D-#267) — one-tap outcome grid replacing the old
 * SUBMITTED-only check queue. Lists EVERY pending/actionable record for the section
 * across all dates (GIVEN/DUE/SUBMITTED/CHASE), grouped by date then by homework item.
 * Each student row is a single tap: ঠিক (CORRECT) / দেয়নি (NOT_SUBMITTED) fire
 * `recordHomeworkOutcome` immediately; আংশিক (PARTIAL) / ভুল (WRONG) expand an inline
 * panel (resubmit toggle + optional top-up) before confirming. The server fast-forwards
 * the lifecycle (GIVEN→DUE→SUBMITTED / →CHASE) behind the tap — the teacher never
 * touches DUE manually. Non-actionable rows (CHECKED/RESUBMIT/ABSENT_REDELIVER) render
 * read-only with a hint back to the Records screen, which keeps the exception drill-down
 * (redeliver, returns, manual moves).
 */
import React, { useState, useRef, useCallback } from "react";
import { ScrollView, View, RefreshControl } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import {
  HOMEWORK_OPEN_RECORDS,
  RECORD_HOMEWORK_OUTCOME,
  ATTACH_HW_ANSWER_FILE,
  type HwOpenRecordT,
} from "../../graphql/operations";
import { pickAndUploadHomeworkFile, FileUploadError } from "../../lib/files";
import { groupByDate } from "../../lib/groupByDate";
import { useTaughtSubjects } from "../../lib/useTaughtSubjects";
import { SubjectFold } from "../../components/SubjectFold";
import type { HomeworkStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Field, Chip, ChipRow, Notice, Loader, EmptyState } from "../../components/ui";
import { ClassSectionDashboard } from "../../components/ClassSectionDashboard";
import { STR, hwSubjectLabel, hwResultLabel, lifecycleStateLabel, dateHeaderLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeworkStackParamList, "CheckingQueue">;

const OPEN_STATES = ["GIVEN", "DUE", "SUBMITTED", "CHASE", "CHECKED", "RESUBMIT", "ABSENT_REDELIVER"];
const ACTIONABLE_STATES = new Set(["GIVEN", "DUE", "SUBMITTED", "CHASE"]);

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "CORRECT":
      return STR.hwOutcomeCorrect;
    case "PARTIAL":
      return STR.hwOutcomePartial;
    case "WRONG":
      return STR.hwOutcomeWrong;
    case "NOT_SUBMITTED":
      return STR.hwOutcomeNotSubmitted;
    default:
      return outcome;
  }
}

interface ItemGroup {
  hwId: string;
  subject: string;
  topicLabelBn: string;
  /** D-#317: the teacher's brief "what is the homework". */
  description: string | null;
  rows: HwOpenRecordT[];
}

/** Sub-group a date's records by homework item (subject/hwId header), preserving
 *  first-seen order — screen-local, not a shared lib (unlike groupByDate). */
function groupByItem(items: readonly HwOpenRecordT[]): ItemGroup[] {
  const order: string[] = [];
  const map = new Map<string, ItemGroup>();
  for (const r of items) {
    let g = map.get(r.hwId);
    if (!g) {
      g = { hwId: r.hwId, subject: r.subject, topicLabelBn: r.topicLabelBn, description: r.description, rows: [] };
      map.set(r.hwId, g);
      order.push(r.hwId);
    }
    g.rows.push(r);
  }
  return order.map((hwId) => map.get(hwId)!);
}

interface Pending {
  outcome: string;
  expanded: boolean;
  resubmit: boolean;
  topupQids: string;
  topupTime: string;
}

const EMPTY_PENDING: Pending = { outcome: "", expanded: false, resubmit: false, topupQids: "", topupTime: "" };

export default function CheckingQueueScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const [pending, setPending] = useState<Record<string, Pending>>({});
  // Day accordion (owner request): when a subject has homework pending across
  // several days, exactly ONE day card is open at a time. null = default (the
  // newest day); "" = all collapsed. Keyed by dateKey so the same day stays
  // open across subjects.
  const [openDateKey, setOpenDateKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fileBusyId, setFileBusyId] = useState<string | null>(null);

  const base = { sectionId: selection.sectionId ?? "", classId: selection.classId ?? "" };
  const [recsQ, refetchRecs] = useQuery({
    query: HOMEWORK_OPEN_RECORDS,
    variables: { ...base, states: OPEN_STATES },
    pause: !hasSection,
  });
  const [, recordOutcome] = useMutation(RECORD_HOMEWORK_OUTCOME);
  const [, attachAnswer] = useMutation(ATTACH_HW_ANSWER_FILE);

  const records = recsQ.data?.homeworkOpenRecords ?? [];
  // D-#306: fold subjects the caller doesn't actively teach on this section.
  const taught = useTaughtSubjects(selection.sectionId ?? null);

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
    setPending((m) => ({ ...m, [id]: { ...(m[id] ?? EMPTY_PENDING), ...patch } }));
  }

  /** ঠিক/দেয়নি fire immediately; আংশিক/ভুল expand the inline panel instead. */
  function onChipPress(recordId: string, outcome: string): void {
    setError(null);
    setOk(null);
    if (outcome === "CORRECT" || outcome === "NOT_SUBMITTED") {
      void onOutcome(recordId, outcome);
      return;
    }
    setPending((m) => ({ ...m, [recordId]: { ...EMPTY_PENDING, outcome, expanded: true } }));
  }

  async function onOutcome(recordId: string, outcome: string, opts?: Pending): Promise<void> {
    setError(null);
    setOk(null);
    const qids = (opts?.topupQids ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    const topupTime = (opts?.topupTime ?? "").trim() === "" ? undefined : parseInt(opts!.topupTime, 10);
    setBusyId(recordId);
    const res = await recordOutcome({
      sectionId: base.sectionId,
      recordId,
      outcome,
      resubmit: outcome === "PARTIAL" ? opts?.resubmit ?? false : undefined,
      topupQids: qids.length > 0 ? qids : undefined,
      topupTime: qids.length > 0 ? topupTime : undefined,
    });
    setBusyId(null);
    if (res.error || !res.data?.recordHomeworkOutcome) return setError(friendlyError(res.error));
    const spawned = res.data.recordHomeworkOutcome.resubmission;
    setOk(spawned ? `${outcomeLabel(outcome)} · ${STR.hwResubSpawned}` : outcomeLabel(outcome));
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

  // UX-7: pull-to-refresh.
  const { refreshing, onRefresh } = usePullRefresh(recsQ.fetching, () =>
    refetchRecs({ requestPolicy: "network-only" }),
  );

  const renderDateGroups = (recs: HwOpenRecordT[]): React.ReactNode => {
    const groups = groupByDate(recs, (r) => r.dateGiven);
    // Accordion only when there is more than one pending day (groups are newest
    // first — the newest is the default open card).
    const accordion = groups.length > 1;
    const effectiveOpen = openDateKey ?? groups[0]?.dateKey ?? "";
    return groups.map((g) => {
      const isOpen = !accordion || g.dateKey === effectiveOpen;
      return (
      <View key={g.dateKey} style={{ marginBottom: space(2) }}>
        {accordion ? (
          <Button
            title={`${isOpen ? "▾" : "▸"} ${dateHeaderLabel(g.dateKey)} (${bnNum(g.items.length)})`}
            variant="secondary"
            onPress={() => setOpenDateKey(isOpen ? "" : g.dateKey)}
          />
        ) : (
          <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>{dateHeaderLabel(g.dateKey)}</Muted>
        )}
        {!isOpen
          ? null
          : groupByItem(g.items).map((ig) => (
          <View key={ig.hwId} style={{ marginBottom: space(2) }}>
            <Muted style={{ marginBottom: 4 }}>
              {hwSubjectLabel(ig.subject)} · {ig.hwId}
              {ig.topicLabelBn ? ` · 📘 ${ig.topicLabelBn}` : ""}
            </Muted>
            {/* D-#317: the teacher's brief "what is the homework". */}
            {ig.description ? <Body style={{ marginBottom: 4 }}>📝 {ig.description}</Body> : null}
            {ig.rows.map((r) => {
              const actionable = ACTIONABLE_STATES.has(r.state);
              const p = pending[r.id];
              return (
                <Card key={r.id}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Body style={{ fontWeight: "700", flex: 1 }}>{r.studentName}</Body>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                      {r.hasAnswerFile ? <Badge text={STR.hwFileHas} tone="ok" /> : null}
                      <Badge text={lifecycleStateLabel(r.state)} tone={actionable ? "info" : "muted"} />
                    </View>
                  </View>

                  {actionable ? (
                    <>
                      <ChipRow>
                        <Chip
                          label={STR.hwOutcomeCorrect}
                          selected={busyId === r.id}
                          onPress={() => onChipPress(r.id, "CORRECT")}
                        />
                        <Chip
                          label={STR.hwOutcomePartial}
                          selected={!!p?.expanded && p?.outcome === "PARTIAL"}
                          onPress={() => onChipPress(r.id, "PARTIAL")}
                        />
                        <Chip
                          label={STR.hwOutcomeWrong}
                          selected={!!p?.expanded && p?.outcome === "WRONG"}
                          onPress={() => onChipPress(r.id, "WRONG")}
                        />
                        <Chip
                          label={STR.hwOutcomeNotSubmitted}
                          selected={busyId === r.id}
                          onPress={() => onChipPress(r.id, "NOT_SUBMITTED")}
                        />
                      </ChipRow>
                      {p?.expanded ? (
                        <View style={{ marginTop: 8 }}>
                          {p.outcome === "PARTIAL" ? (
                            <ChipRow>
                              <Chip
                                label={STR.hwResubmit}
                                selected={!!p.resubmit}
                                onPress={() => setPend(r.id, { resubmit: !p.resubmit })}
                              />
                            </ChipRow>
                          ) : null}
                          <Field label={STR.hwTopupQids} value={p.topupQids} onChangeText={(t) => setPend(r.id, { topupQids: t })} />
                          <Field
                            label={STR.hwTopupTime}
                            value={p.topupTime}
                            onChangeText={(t) => setPend(r.id, { topupTime: t })}
                            keyboardType="number-pad"
                          />
                          <View style={{ marginTop: 8 }}>
                            <Button
                              title={STR.hwConfirm}
                              onPress={() => onOutcome(r.id, p.outcome, p)}
                              loading={busyId === r.id}
                              disabled={busyId !== null}
                            />
                          </View>
                        </View>
                      ) : null}
                      <View style={{ marginTop: 8 }}>
                        <Button
                          title={STR.hwAttachAnswer}
                          variant="secondary"
                          onPress={() => onAttachAnswer(r.id)}
                          loading={fileBusyId === r.id}
                          disabled={fileBusyId !== null}
                        />
                      </View>
                    </>
                  ) : (
                    <View style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      {r.result ? <Muted>{hwResultLabel(r.result)}</Muted> : <View />}
                      <Button title={STR.hwSeeRecords} variant="ghost" onPress={() => navigation.navigate("HomeworkRecords")} />
                    </View>
                  )}
                </Card>
              );
            })}
          </View>
        ))}
      </View>
      );
    });
  };

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <ClassSectionDashboard />
      </View>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {!hasSection ? (
          <EmptyState message={STR.pickSection} />
        ) : recsQ.fetching && records.length === 0 ? (
          <Loader label={STR.loading} />
        ) : records.length === 0 ? (
          <EmptyState message={STR.hwNoOpenRecords} />
        ) : (
          <>
            {ok ? <Notice message={ok} tone="ok" /> : null}
            {error ? <Notice message={error} tone="danger" /> : null}

            <SubjectFold
              key={selection.sectionId ?? ""}
              records={records}
              taught={taught}
              render={renderDateGroups}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

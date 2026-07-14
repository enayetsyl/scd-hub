/**
 * HomeworkRecordsScreen (§8.2) — the per-student lifecycle view.
 * Auto-lists EVERY open (non-terminal) record for the section across all dates,
 * grouped into date-wise cards — no manual date pick — and applies one legal
 * transition per record (GIVEN→DUE→SUBMITTED/CHASE, ABSENT_REDELIVER→GIVEN,
 * CHECKED→RETURNED). The DUE/CHASE rows here are the "chase" worklist. Once a record
 * reaches SUBMITTED, the result is recorded in the Checking queue.
 *
 * D-#313: GIVEN rows carry a checkbox — pick some and "mark selected due", or
 * flip a whole day with one tap. Records also auto-flip to DUE on their due
 * morning (the scheduler sweep); these buttons are only the EARLY path.
 */
import React, { useState, useRef, useCallback } from "react";
import { ScrollView, View, Text, Pressable, RefreshControl } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import {
  HOMEWORK_OPEN_RECORDS,
  TRANSITION_HOMEWORK_RECORD,
  MARK_HOMEWORK_RECORDS_DUE,
  type HwOpenRecordT,
} from "../../graphql/operations";
import { groupByDate } from "../../lib/groupByDate";
import { useTaughtSubjects } from "../../lib/useTaughtSubjects";
import { SubjectFold } from "../../components/SubjectFold";
import type { HomeworkStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Notice, Loader, EmptyState } from "../../components/ui";
import { ClassSectionDashboard } from "../../components/ClassSectionDashboard";
import { STR, bnNum, hwSubjectLabel, lifecycleStateLabel, dateHeaderLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { useSectionContext } from "../../state/SectionContext";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeworkStackParamList, "HomeworkRecords">;

/** Open (non-terminal) states — what counts as "pending" lifecycle work. */
const OPEN_STATES = ["GIVEN", "ABSENT_REDELIVER", "DUE", "SUBMITTED", "CHASE", "CHECKED", "RESUBMIT"];

/** Legal next states per state (language-free; mirrors lifecycle.ts LIFECYCLE_EDGES). */
const NEXT_STATES: Record<string, string[]> = {
  GIVEN: ["DUE"],
  ABSENT_REDELIVER: ["GIVEN"],
  DUE: ["SUBMITTED", "CHASE"],
  CHASE: ["SUBMITTED", "CHASE"],
  CHECKED: ["RETURNED"],
  RESUBMIT: ["RETURNED"],
  SUBMITTED: [],
  RETURNED: [],
};

/** Resolve a move's button label at RENDER time so it follows the current language. */
function moveLabel(from: string, to: string): string {
  switch (to) {
    case "DUE":
      return STR.hwMarkDue;
    case "SUBMITTED":
      return STR.hwMarkSubmitted;
    case "CHASE":
      return from === "CHASE" ? STR.hwChaseAgain : STR.hwChaseAction;
    case "GIVEN":
      return STR.hwRedeliver;
    case "RETURNED":
      return STR.hwReturnAction;
    default:
      return to;
  }
}

export default function HomeworkRecordsScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const colors = useColors();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // D-#313: the picked GIVEN records (bulk early mark-due).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const base = { sectionId: selection.sectionId ?? "", classId: selection.classId ?? "" };
  const [recsQ, refetchRecs] = useQuery({
    query: HOMEWORK_OPEN_RECORDS,
    variables: { ...base, states: OPEN_STATES },
    pause: !hasSection,
  });
  const [, transition] = useMutation(TRANSITION_HOMEWORK_RECORD);
  const [, markManyDue] = useMutation(MARK_HOMEWORK_RECORDS_DUE);

  const records = recsQ.data?.homeworkOpenRecords ?? [];
  // D-#306: fold subjects the caller doesn't actively teach on this section.
  const taught = useTaughtSubjects(selection.sectionId ?? null);

  const toggleSelect = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function onMarkDue(recordIds: string[]): Promise<void> {
    if (recordIds.length === 0 || bulkBusy) return;
    setError(null);
    setOk(null);
    setBulkBusy(true);
    const res = await markManyDue({ sectionId: base.sectionId, recordIds });
    setBulkBusy(false);
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(`${lifecycleStateLabel("DUE")} · ${bnNum(res.data?.markHomeworkRecordsDue ?? 0)}`);
    setSelected(new Set());
    refetchRecs({ requestPolicy: "network-only" });
  }

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

  async function onMove(recordId: string, toState: string): Promise<void> {
    setError(null);
    setOk(null);
    setBusyId(recordId);
    const res = await transition({ sectionId: base.sectionId, recordId, toState });
    setBusyId(null);
    if (res.error || !res.data?.transitionHomeworkRecord) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(lifecycleStateLabel(res.data.transitionHomeworkRecord.state));
    refetchRecs({ requestPolicy: "network-only" });
  }

  // UX-7: pull-to-refresh.
  const { refreshing, onRefresh } = usePullRefresh(recsQ.fetching, () =>
    refetchRecs({ requestPolicy: "network-only" }),
  );

  const renderDateGroups = (recs: HwOpenRecordT[]): React.ReactNode =>
    groupByDate(recs, (r) => r.dateGiven).map((g) => {
      const givenIds = g.items.filter((r) => r.state === "GIVEN").map((r) => r.id);
      return (
      <View key={g.dateKey} style={{ marginBottom: space(2) }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space(1) }}>
          <Muted style={{ fontWeight: "700", flex: 1 }}>{dateHeaderLabel(g.dateKey)}</Muted>
          {/* D-#313: one tap flips the whole day's GIVEN records to DUE. */}
          {givenIds.length > 0 ? (
            <Button
              title={`${STR.hwMarkDayDue} (${bnNum(givenIds.length)})`}
              variant="ghost"
              onPress={() => void onMarkDue(givenIds)}
              disabled={bulkBusy}
            />
          ) : null}
        </View>
        {g.items.map((r) => {
          const moves = NEXT_STATES[r.state] ?? [];
          const isSelected = selected.has(r.id);
          return (
            <Card key={r.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                {r.state === "GIVEN" ? (
                  <Pressable
                    onPress={() => toggleSelect(r.id)}
                    hitSlop={10}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                    style={{ marginRight: space(2) }}
                  >
                    <Text style={{ fontSize: 20, color: colors.primary }}>{isSelected ? "☑" : "☐"}</Text>
                  </Pressable>
                ) : null}
                <Body style={{ fontWeight: "700", flexShrink: 1 }}>{r.studentName}</Body>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                  <Badge text={hwSubjectLabel(r.subject)} tone="info" />
                  {r.chaseCount > 0 ? <Badge text={`${STR.hwChaseAction} ${r.chaseCount}`} tone="warn" /> : null}
                  <Badge text={lifecycleStateLabel(r.state)} tone="brand" />
                </View>
              </View>
              <Muted style={{ marginTop: 2 }}>{r.hwId}{r.topicLabelBn ? ` · 📘 ${r.topicLabelBn}` : ""}</Muted>
              {moves.length > 0 ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: 8 }}>
                  {moves.map((to) => (
                    <View key={to} style={{ flexGrow: 1 }}>
                      <Button
                        title={moveLabel(r.state, to)}
                        variant="secondary"
                        onPress={() => onMove(r.id, to)}
                        loading={busyId === r.id}
                        disabled={busyId !== null}
                      />
                    </View>
                  ))}
                </View>
              ) : r.state === "SUBMITTED" ? (
                <View style={{ marginTop: 8 }}>
                  <Muted style={{ marginBottom: 6 }}>{STR.hwCheckHint}</Muted>
                  <Button title={STR.hwGoChecking} onPress={() => navigation.navigate("CheckingQueue")} />
                </View>
              ) : null}
            </Card>
          );
        })}
      </View>
      );
    });

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
          <EmptyState message={STR.hwNoRecords} />
        ) : (
          <>
            {ok ? <Notice message={ok} tone="ok" /> : null}
            {error ? <Notice message={error} tone="danger" /> : null}

            {/* D-#313: bulk early mark-due for the picked GIVEN records. */}
            {selected.size > 0 ? (
              <View style={{ marginBottom: space(2) }}>
                <Button
                  title={`${STR.hwMarkSelectedDue} (${bnNum(selected.size)})`}
                  onPress={() => void onMarkDue([...selected])}
                  loading={bulkBusy}
                  disabled={bulkBusy}
                />
              </View>
            ) : null}

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

/**
 * WorkBoardScreen (WB-1/WB-2, D-#701) — one person's unified board. Without params it
 * is the caller's own; with `userId` it is someone else's (the load grid's drill-down,
 * tasks:assign — the server re-gates). Three views over ONE week query: আজ (today +
 * overdue), এই সপ্তাহ (all), বকেয়া (overdue only); inside a day, cards sit under
 * their slot with the slot's summed minutes, so an uneven day is visible before it
 * happens.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import type { DaySlot, TaskStatus } from "@scd/shared";
import { DAY_SLOTS } from "@scd/shared";
import { MY_WORK_BOARD_QUERY, SET_TASK_BLOCKED, SET_TASK_STATUS, WORK_BOARD_FOR_QUERY, type WorkCardT } from "../../graphql/workBoard";
import type { TabParamList, WorkBoardStackParamList } from "../../navigation/types";
import { Screen, Button, EmptyState, Notice, Field, Loader, ErrorBanner } from "../../components/ui";
import { WorkCardView } from "../../components/WorkCardView";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, dateHeaderLabel, daySlotLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { addDaysKey, dateKey } from "../../lib/dates";
import { cardTarget, minutesLabel } from "../../lib/workBoardNav";
import { makeStyles, radius, space, typeScale, useColors } from "../../theme";

type Props = NativeStackScreenProps<WorkBoardStackParamList, "WorkBoard">;
type View3 = "today" | "week" | "overdue";

export default function WorkBoardScreen({ route, navigation }: Props): React.ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const { user, can } = useAuth();
  const tabNav = useNavigation<NavigationProp<TabParamList>>();
  const otherId = route.params?.userId && route.params.userId !== user?.id ? route.params.userId : null;
  const mine = !otherId;
  const today = dateKey();
  const fromKey = today;
  const toKey = addDaysKey(today, 6);
  const [view, setView] = React.useState<View3>(route.params?.dateKey && route.params.dateKey !== today ? "week" : "today");
  const [error, setError] = React.useState<string | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [blockFor, setBlockFor] = React.useState<{ taskId: string; reason: string } | null>(null);

  React.useEffect(() => {
    if (otherId) navigation.setOptions({ title: route.params?.name ?? STR.wbMyBoard });
  }, [otherId, route.params?.name, navigation]);

  const [mineQ, refetchMine] = useQuery({ query: MY_WORK_BOARD_QUERY, variables: { fromKey, toKey }, pause: !mine, requestPolicy: "cache-and-network" });
  const [otherQ, refetchOther] = useQuery({
    query: WORK_BOARD_FOR_QUERY,
    variables: { userId: otherId ?? "", fromKey, toKey },
    pause: mine,
    requestPolicy: "cache-and-network",
  });
  const q = mine ? mineQ : otherQ;
  const refetch = (): void => {
    if (mine) refetchMine({ requestPolicy: "network-only" });
    else refetchOther({ requestPolicy: "network-only" });
  };
  const cards: WorkCardT[] = (mine ? mineQ.data?.myWorkBoard : otherQ.data?.workBoardFor) ?? [];

  const [, setStatus] = useMutation(SET_TASK_STATUS);
  const [, setBlocked] = useMutation(SET_TASK_BLOCKED);

  const canWork = mine || can("tasks:assign");

  async function onStatus(card: WorkCardT, status: TaskStatus | "BLOCK"): Promise<void> {
    if (!card.taskId) return;
    setError(null);
    if (status === "BLOCK") {
      if (card.blockedReason) {
        setBusyKey(card.key);
        const res = await setBlocked({ id: card.taskId, reason: null });
        setBusyKey(null);
        if (res.error) setError(friendlyError(res.error));
        else refetch();
        return;
      }
      setBlockFor({ taskId: card.taskId, reason: "" });
      return;
    }
    setBusyKey(card.key);
    const res = await setStatus({ id: card.taskId, status });
    setBusyKey(null);
    if (res.error) setError(friendlyError(res.error));
    else refetch();
  }

  async function submitBlock(): Promise<void> {
    if (!blockFor || !blockFor.reason.trim()) return;
    const res = await setBlocked({ id: blockFor.taskId, reason: blockFor.reason.trim() });
    if (res.error) setError(friendlyError(res.error));
    setBlockFor(null);
    refetch();
  }

  function open(card: WorkCardT): void {
    if (card.kind === "TASK" && card.taskId) {
      navigation.navigate("TaskDetail", { taskId: card.taskId });
      return;
    }
    const t = cardTarget(card.link);
    if (!t) return;
    (tabNav.navigate as unknown as (name: string, params?: object) => void)(t.tab, { screen: t.screen, params: t.params, initial: false });
  }

  // --- derive the three views ---------------------------------------------
  const overdue = cards.filter((c) => c.overdue && c.status !== "DONE");
  const visible =
    view === "overdue" ? overdue : view === "today" ? cards.filter((c) => c.dateKey === today || (c.overdue && c.status !== "DONE")) : cards;
  const todayCards = cards.filter((c) => c.dateKey === today);
  const summary = {
    today: todayCards.filter((c) => !c.overdue).length,
    done: todayCards.filter((c) => c.status === "DONE").length,
    overdue: overdue.length,
  };

  // group: overdue block first, then day → slot
  const overdueBlock = view === "overdue" ? [] : visible.filter((c) => c.overdue && c.status !== "DONE");
  const rest = view === "overdue" ? visible : visible.filter((c) => !(c.overdue && c.status !== "DONE"));
  const days = [...new Set(rest.map((c) => c.dateKey))].sort();

  return (
    <Screen scroll>
      <View style={styles.seg}>
        {(
          [
            ["today", STR.wbToday],
            ["week", STR.wbWeek],
            ["overdue", `${STR.wbOverdue}${overdue.length ? ` ${bnNum(overdue.length)}` : ""}`],
          ] as Array<[View3, string]>
        ).map(([k, label]) => (
          <Pressable key={k} onPress={() => setView(k)} style={[styles.segBtn, view === k && styles.segOn]}>
            <Text style={[styles.segText, view === k && styles.segTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.summary}>
        <View style={styles.tile}>
          <Text style={styles.tileN}>{bnNum(summary.today)}</Text>
          <Text style={styles.tileL}>{STR.wbTodayCount}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileN}>{bnNum(summary.done)}</Text>
          <Text style={styles.tileL}>{STR.wbDone}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={[styles.tileN, summary.overdue > 0 && { color: colors.error }]}>{bnNum(summary.overdue)}</Text>
          <Text style={styles.tileL}>{STR.wbOverdue}</Text>
        </View>
      </View>

      {mine ? (
        <View style={{ marginBottom: space(3) }}>
          <Button title={`+ ${STR.wbNewTask}`} variant="secondary" onPress={() => navigation.navigate("TaskForm", { assigneeUserId: user?.id })} />
        </View>
      ) : can("tasks:assign") ? (
        <View style={{ marginBottom: space(3) }}>
          <Button title={`+ ${STR.wbNewTask}`} variant="secondary" onPress={() => navigation.navigate("TaskForm", { assigneeUserId: otherId ?? undefined })} />
        </View>
      ) : null}

      {error ? <Notice message={error} tone="danger" /> : null}
      {blockFor ? (
        <View style={styles.blockBox}>
          <Field label={STR.wbBlockReason} value={blockFor.reason} onChangeText={(t) => setBlockFor({ ...blockFor, reason: t })} />
          <View style={{ flexDirection: "row", gap: space(2) }}>
            <Button title={STR.wbBlock} onPress={submitBlock} disabled={!blockFor.reason.trim()} />
            <Button title={STR.cancel} variant="ghost" onPress={() => setBlockFor(null)} />
          </View>
        </View>
      ) : null}

      {q.fetching && cards.length === 0 ? (
        <Loader label={STR.loading} />
      ) : q.error ? (
        <ErrorBanner message={friendlyError(q.error)} onRetry={refetch} />
      ) : visible.length === 0 ? (
        <EmptyState message={STR.wbEmpty} />
      ) : (
        <>
          {overdueBlock.length > 0 ? (
            <View style={{ marginBottom: space(2) }}>
              <Text style={[styles.dayHead, { color: colors.error }]}>{STR.wbOverdue}</Text>
              {overdueBlock.map((c) => (
                <WorkCardView
                  key={c.key}
                  card={c}
                  onOpen={() => open(c)}
                  onStatus={canWork && c.kind === "TASK" ? (s) => onStatus(c, s) : undefined}
                  busy={busyKey === c.key}
                />
              ))}
            </View>
          ) : null}
          {days.map((day) => {
            const dayCards = rest.filter((c) => c.dateKey === day);
            return (
              <View key={day} style={{ marginBottom: space(2) }}>
                {view !== "today" ? <Text style={styles.dayHead}>{dateHeaderLabel(day)}</Text> : null}
                {DAY_SLOTS.map((slot: DaySlot) => {
                  const inSlot = dayCards.filter((c) => c.slot === slot);
                  if (inSlot.length === 0) return null;
                  const openMin = inSlot.filter((c) => c.status !== "DONE").reduce((n, c) => n + c.effortMin, 0);
                  return (
                    <View key={slot}>
                      <View style={styles.slotRow}>
                        <Text style={styles.slot}>{daySlotLabel(slot)}</Text>
                        <Text style={styles.slot}>{minutesLabel(openMin, bnNum)}</Text>
                      </View>
                      {inSlot.map((c) => (
                        <WorkCardView
                          key={c.key}
                          card={c}
                          onOpen={() => open(c)}
                          onStatus={canWork && c.kind === "TASK" ? (s) => onStatus(c, s) : undefined}
                          busy={busyKey === c.key}
                        />
                      ))}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  seg: { flexDirection: "row", gap: space(1), marginBottom: space(3) },
  segBtn: { flex: 1, paddingVertical: space(2), borderRadius: radius.sm, backgroundColor: c.surfaceAlt, alignItems: "center" },
  segOn: { backgroundColor: c.primaryContainer },
  segText: { ...typeScale.chip, color: c.textSecondary },
  segTextOn: { color: c.onPrimaryContainer },
  summary: { flexDirection: "row", gap: space(2), marginBottom: space(3) },
  tile: { flex: 1, backgroundColor: c.surfaceAlt, borderRadius: radius.md, padding: space(2) },
  tileN: { ...typeScale.pageTitle, color: c.textPrimary },
  tileL: { ...typeScale.caption, color: c.textSecondary },
  dayHead: { ...typeScale.bodyStrong, color: c.textPrimary, marginBottom: space(1) },
  slotRow: { flexDirection: "row", justifyContent: "space-between", marginTop: space(1), marginBottom: space(1) },
  slot: { ...typeScale.caption, color: c.textDisabled, letterSpacing: 0.5 },
  blockBox: { backgroundColor: c.surfaceAlt, borderRadius: radius.md, padding: space(3), marginBottom: space(3) },
}));

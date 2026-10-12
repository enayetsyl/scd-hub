/**
 * CtScriptOfficeCard (CS-1..CS-3, docs/prd-ct-scripts.md §7.2, D-#715–#719) — the
 * Office's "ক্লাস টেস্টের খাতা" card on Today: a badge per stage, the tests waiting to
 * be received (count stepper + "নিশ্চিত করুন" inline — the desk does this with the
 * bundle in hand), and every later stage as a row that opens the scan & tag screen
 * (or hands the paper back to the teacher once published).
 *
 * Rendered on AdminTodayScreen AND on TodayScreen for any `roster:manage` holder —
 * AppTabs picks the Today screen by PRIMARY role, and the TEACHER logins carrying the
 * OFFICE template (D-#715) would otherwise never see it. Self-contained (own query);
 * renders nothing while loading, when empty, and on error.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useMutation, useQuery } from "urql";
import {
  CT_SCRIPT_QUEUE_QUERY,
  RECEIVE_CT_SCRIPTS,
  HAND_BACK_CT_SCRIPTS,
  type CtScriptRowT,
} from "../graphql/ctScripts";
import type { TabParamList } from "../navigation/types";
import { Badge, Body, Button, Card, Muted, Notice } from "./ui";
import { STR, bnNum, isoDateLabel, ctScriptStageLabel } from "../lib/labels";
import { ctScriptRowTitle, ctScriptStageTone } from "../lib/ctScriptStage";
import { friendlyError } from "../lib/errors";
import { makeStyles, space, typeScale, useColors } from "../theme";

const MAX_ROWS = 5;

type Group = { key: string; title: string; rows: CtScriptRowT[] };

export function CtScriptOfficeCard(): React.ReactElement | null {
  const styles = useStyles();
  const colors = useColors();
  const nav = useNavigation<NavigationProp<TabParamList>>();
  const [q, refetch] = useQuery({ query: CT_SCRIPT_QUEUE_QUERY, variables: {}, requestPolicy: "cache-and-network" });
  const [, receive] = useMutation(RECEIVE_CT_SCRIPTS);
  const [, handBack] = useMutation(HAND_BACK_CT_SCRIPTS);
  const [open, setOpen] = React.useState<string | null>(null);
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const rows: CtScriptRowT[] = q.data?.classTestScriptQueue ?? [];
  if (q.error || rows.length === 0) return null;

  const byStage = (...s: string[]) => rows.filter((r) => s.includes(r.stage));
  const groups: Group[] = [
    { key: "wait", title: STR.csGroupWaiting, rows: byStage("OVERDUE", "DUE") },
    { key: "upload", title: STR.csGroupUpload, rows: byStage("UPLOAD_IN_PROGRESS", "UPLOAD_PENDING") },
    { key: "publish", title: STR.csGroupToPublish, rows: byStage("UPLOAD_DONE") },
    { key: "handback", title: STR.csGroupToHandBack, rows: byStage("PUBLISHED") },
    { key: "teacher", title: STR.csGroupWithTeacher, rows: byStage("RETURN_OVERDUE", "WITH_TEACHER") },
  ];
  const stageCounts = ["DUE", "OVERDUE", "UPLOAD_PENDING", "UPLOAD_IN_PROGRESS", "UPLOAD_DONE", "PUBLISHED", "WITH_TEACHER", "RETURN_OVERDUE"]
    .map((s) => ({ s, n: rows.filter((r) => r.stage === s).length }))
    .filter((x) => x.n > 0);

  const openUpload = (r: CtScriptRowT): void =>
    (nav.navigate as unknown as (name: string, p?: object) => void)("ClassTestTab", {
      screen: "CtScriptUpload",
      params: { testId: r.testId, title: r.ctId },
      initial: false,
    });

  async function act(p: Promise<{ error?: unknown }>): Promise<void> {
    setErr(null);
    setBusy(true);
    try {
      const res = await p;
      if (res.error) {
        setErr(friendlyError(res.error as Parameters<typeof friendlyError>[0]));
        return;
      }
      setOpen(null);
      refetch({ requestPolicy: "network-only" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Body style={styles.title}>{STR.csCardTitle}</Body>
      <View style={styles.badges}>
        {stageCounts.map(({ s, n }) => (
          <Badge key={s} text={`${ctScriptStageLabel(s)} · ${bnNum(n)}`} tone={ctScriptStageTone(s)} />
        ))}
      </View>
      {err ? <Notice message={err} tone="danger" /> : null}
      {groups
        .filter((g) => g.rows.length > 0)
        .map((g) => (
          <View key={g.key} style={styles.group}>
            <Text style={[styles.groupTitle, { color: colors.textSecondary }]}>{g.title}</Text>
            {g.rows.slice(0, MAX_ROWS).map((r) => {
              const count = counts[r.testId] ?? r.presentCount;
              return (
                <View key={r.testId} style={styles.row}>
                  <Pressable onPress={() => openUpload(r)} style={{ flex: 1, minWidth: 0 }}>
                    <Body numberOfLines={2}>{ctScriptRowTitle(r, STR.ctTestNumber, bnNum)}</Body>
                    <Muted>
                      {g.key === "wait"
                        ? `${r.teacherName} · ${STR.csDueBy}: ${isoDateLabel(r.dueDateKey)} · ${bnNum(r.presentCount)} ${STR.csPresent}`
                        : g.key === "teacher"
                          ? `${r.teacherName} · ${STR.csDueBy}: ${isoDateLabel(r.returnDueDateKey)}`
                          : `${r.teacherName} · ${bnNum(r.resolvedCount)}/${bnNum(r.presentCount)} ${STR.csResolved}`}
                    </Muted>
                  </Pressable>
                  <Badge text={ctScriptStageLabel(r.stage)} tone={ctScriptStageTone(r.stage)} />
                  {g.key === "wait" ? (
                    open === r.testId ? (
                      <View style={styles.receive}>
                        <Muted>{STR.csHowMany}</Muted>
                        <View style={styles.stepper}>
                          <Button
                            title="−"
                            variant="secondary"
                            onPress={() => setCounts((c) => ({ ...c, [r.testId]: Math.max(0, count - 1) }))}
                          />
                          <Body style={styles.count}>{bnNum(count)}</Body>
                          <Button
                            title="+"
                            variant="secondary"
                            onPress={() => setCounts((c) => ({ ...c, [r.testId]: count + 1 }))}
                          />
                          <Muted>/ {bnNum(r.presentCount)}</Muted>
                        </View>
                        {count < r.presentCount ? <Muted>{STR.csShortHint}</Muted> : null}
                        <View style={styles.actions}>
                          <Button
                            title={STR.csConfirm}
                            loading={busy}
                            onPress={() => void act(receive({ testId: r.testId, count }))}
                          />
                          <Button title={STR.csCancel} variant="ghost" onPress={() => setOpen(null)} />
                        </View>
                      </View>
                    ) : (
                      <Button title={STR.csReceive} variant="secondary" onPress={() => setOpen(r.testId)} />
                    )
                  ) : g.key === "handback" ? (
                    <Button
                      title={STR.csHandBack}
                      variant="secondary"
                      loading={busy}
                      onPress={() => void act(handBack({ testId: r.testId }))}
                    />
                  ) : g.key === "upload" || g.key === "publish" ? (
                    <Button title={STR.csUpload} variant="secondary" onPress={() => openUpload(r)} />
                  ) : null}
                </View>
              );
            })}
            {g.rows.length > MAX_ROWS ? (
              <Muted>{`+${bnNum(g.rows.length - MAX_ROWS)}`}</Muted>
            ) : null}
          </View>
        ))}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  title: { ...typeScale.sectionTitle, color: c.textPrimary },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) },
  group: { marginTop: space(3), gap: space(1) },
  groupTitle: { ...typeScale.chip },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space(2),
    paddingVertical: space(2),
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  receive: { width: "100%", gap: space(2) },
  stepper: { flexDirection: "row", alignItems: "center", gap: space(3) },
  count: { ...typeScale.sectionTitle, minWidth: 40, textAlign: "center", color: c.textPrimary },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
}));

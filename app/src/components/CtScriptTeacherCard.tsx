/**
 * CtScriptTeacherCard (CS-1/CS-3, docs/prd-ct-scripts.md §7.1, D-#715/#719) — the
 * teacher's two script reminders on Today:
 *   - "খাতা অফিসে জমা দিন" from the results publish until the Office receives the
 *     paper (red once the due day has passed — strictly after, D-#715);
 *   - "খাতা শিক্ষার্থীদের ফেরত দিন" once the Office hands the paper back, with the
 *     teacher's own "ফেরত দিয়েছি".
 * Both rows disappear by themselves: the stage is derived on the server. Self-contained
 * (own query, the TodayWorkCard posture): renders nothing while loading, when empty,
 * and on error — a broken card must never break Today.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import { MY_CT_SCRIPT_TASKS_QUERY, MARK_CT_SCRIPTS_RETURNED, type CtScriptRowT } from "../graphql/ctScripts";
import { Badge, Body, Button, Muted, Notice, wrapRowText } from "./ui";
import { FoldCard } from "./FoldCard";
import { STR, bnNum, isoDateLabel, ctScriptStageLabel } from "../lib/labels";
import { ctScriptRowTitle, ctScriptStageTone } from "../lib/ctScriptStage";
import { friendlyError } from "../lib/errors";
import { makeStyles, space, typeScale } from "../theme";

export function CtScriptTeacherCard(): React.ReactElement | null {
  const styles = useStyles();
  const [q, refetch] = useQuery({ query: MY_CT_SCRIPT_TASKS_QUERY, variables: {}, requestPolicy: "cache-and-network" });
  const [m, markReturned] = useMutation(MARK_CT_SCRIPTS_RETURNED);
  const [err, setErr] = React.useState<string | null>(null);
  const rows: CtScriptRowT[] = q.data?.myClassTestScriptTasks ?? [];
  if (q.error || rows.length === 0) return null;

  const submit = rows.filter((r) => r.stage === "DUE" || r.stage === "OVERDUE");
  const back = rows.filter((r) => r.stage === "WITH_TEACHER" || r.stage === "RETURN_OVERDUE");

  async function returned(r: CtScriptRowT): Promise<void> {
    setErr(null);
    const res = await markReturned({ testId: r.testId });
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    refetch({ requestPolicy: "network-only" });
  }

  // D-#758: a badge per stage is the summary (the Office card's idiom); the rows open on tap.
  const stageCounts = ["OVERDUE", "DUE", "RETURN_OVERDUE", "WITH_TEACHER"]
    .map((s) => ({ s, n: rows.filter((r) => r.stage === s).length }))
    .filter((x) => x.n > 0);

  return (
    <FoldCard
      id="today:ctScriptsTeacher"
      title={<Body style={styles.title}>{STR.csCardTitle}</Body>}
      summary={
        <View style={styles.badges}>
          {stageCounts.map(({ s, n }) => (
            <Badge key={s} text={`${ctScriptStageLabel(s)} · ${bnNum(n)}`} tone={ctScriptStageTone(s)} />
          ))}
        </View>
      }
    >
      {err ? <Notice message={err} tone="danger" /> : null}
      {submit.length > 0 ? (
        <View style={styles.group}>
          <Body style={styles.groupTitle}>{STR.csSubmitTitle}</Body>
          {submit.map((r) => (
            <View key={r.testId} style={styles.row}>
              <View style={wrapRowText}>
                <Body numberOfLines={2}>{ctScriptRowTitle(r, STR.ctTestNumber, bnNum)}</Body>
                <Muted>
                  {STR.csDueBy}: {isoDateLabel(r.dueDateKey)} · {bnNum(r.presentCount)} {STR.csPresent}
                </Muted>
              </View>
              <Badge text={ctScriptStageLabel(r.stage)} tone={ctScriptStageTone(r.stage)} />
            </View>
          ))}
          <Muted>{STR.csSubmitHint}</Muted>
        </View>
      ) : null}
      {back.length > 0 ? (
        <View style={styles.group}>
          <Body style={styles.groupTitle}>{STR.csReturnTitle}</Body>
          {back.map((r) => (
            <View key={r.testId} style={styles.row}>
              <View style={wrapRowText}>
                <Body numberOfLines={2}>{ctScriptRowTitle(r, STR.ctTestNumber, bnNum)}</Body>
                <Muted>
                  {STR.csDueBy}: {isoDateLabel(r.returnDueDateKey)}
                </Muted>
              </View>
              <Badge text={ctScriptStageLabel(r.stage)} tone={ctScriptStageTone(r.stage)} />
              <Button
                title={STR.csReturnDone}
                variant="secondary"
                loading={m.fetching}
                onPress={() => void returned(r)}
              />
            </View>
          ))}
        </View>
      ) : null}
    </FoldCard>
  );
}

const useStyles = makeStyles((c) => ({
  title: { ...typeScale.sectionTitle, color: c.textPrimary },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) },
  group: { marginTop: space(2), gap: space(1) },
  groupTitle: { ...typeScale.bodyStrong, color: c.textPrimary },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space(2),
    paddingVertical: space(2),
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
}));

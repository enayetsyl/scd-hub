/**
 * HomeworkRollupsScreen (§7.3/§7.4/§8.4) — the principal/Subject-Lead roll-ups:
 * the resubmission watch-list (≥3 in a rolling 2 weeks), per-subject trim-pattern
 * flags for a month (>30% of reconciled days), and the de-identified question-usage
 * feed. Read-scope enforced server-side.
 */
import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { HOMEWORK_WATCHLIST, HOMEWORK_TRIM_PATTERN, QUESTION_USAGE_FEED } from "../../graphql/operations";
import type { HomeworkStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Field, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { SectionBar } from "../../components/SectionBar";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeworkStackParamList, "HomeworkRollups">;

/** Current month "YYYY-MM". */
function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
/** First + last day (ISO) of a "YYYY-MM" month; falls back to the current month. */
function monthRange(ym: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  const now = new Date();
  const year = m ? Number(m[1]) : now.getFullYear();
  const month = m ? Number(m[2]) - 1 : now.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export default function HomeworkRollupsScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const [month, setMonth] = useState(thisMonth());
  const base = { sectionId: selection.sectionId ?? "", classId: selection.classId ?? "" };
  const { from, to } = monthRange(month);

  const [watchQ] = useQuery({ query: HOMEWORK_WATCHLIST, variables: base, pause: !hasSection });
  const [trimQ] = useQuery({ query: HOMEWORK_TRIM_PATTERN, variables: { ...base, from, to }, pause: !hasSection });
  const [usageQ] = useQuery({ query: QUESTION_USAGE_FEED, variables: base, pause: !hasSection });

  const watch = watchQ.data?.homeworkWatchList;
  const trim = trimQ.data?.homeworkTrimPattern;
  const usage = usageQ.data?.questionUsageFeed;
  const anyError = watchQ.error || trimQ.error || usageQ.error;
  const loading = (watchQ.fetching || trimQ.fetching || usageQ.fetching) && !watch && !trim && !usage;

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <SectionBar onChange={() => navigation.navigate("SectionPicker")} />
        {hasSection ? <Field label={STR.hwMonth} value={month} onChangeText={setMonth} placeholder="YYYY-MM" /> : null}
      </View>

      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {!hasSection ? (
          <EmptyState message={STR.pickSection} />
        ) : anyError ? (
          <ErrorBanner message={friendlyError(watchQ.error ?? trimQ.error ?? usageQ.error)} />
        ) : loading ? (
          <Loader label={STR.loading} />
        ) : (
          <>
            {/* Watch-list (§7.3) */}
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.hwWatchList}</Body>
              <Muted style={{ marginBottom: 4 }}>{STR.hwWatchHint}</Muted>
              {(watch?.watchList ?? []).length === 0 ? (
                <Muted>{STR.empty}</Muted>
              ) : (
                (watch?.watchList ?? []).map((w) => (
                  <View key={w.studentId} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                    <Muted>{w.studentId}</Muted>
                    <Badge text={`${bnNum(w.resubmissionCount)} ${STR.hwResubmissions}`} tone="danger" />
                  </View>
                ))
              )}
            </Card>

            {/* Trim pattern (§7.4) */}
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.hwTrimPattern}</Body>
              <Muted style={{ marginBottom: 4 }}>
                {STR.hwTrimHint} · {STR.hwSchoolDays}: {bnNum(trim?.schoolDays ?? 0)}
              </Muted>
              {(trim?.flags ?? []).length === 0 ? (
                <Muted>{STR.hwNoFlags}</Muted>
              ) : (
                (trim?.flags ?? []).map((f) => (
                  <View key={f.subject} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                    <Muted>
                      {hwSubjectLabel(f.subject)} · {STR.hwTrimmedDays} {bnNum(f.trimmedDays)}/{bnNum(f.schoolDays)}
                    </Muted>
                    <Badge text={`${bnNum(Math.round(f.ratio * 100))}%`} tone={f.flagged ? "danger" : "muted"} />
                  </View>
                ))
              )}
            </Card>

            {/* Question usage (§8.4 — de-identified) */}
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.hwQuestionUsage}</Body>
              {(usage?.feed ?? []).length === 0 ? (
                <Muted>{STR.empty}</Muted>
              ) : (
                (usage?.feed ?? []).slice(0, 30).map((u) => (
                  <View key={u.qid} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                    <Muted>{u.qid}</Muted>
                    <Muted>{bnNum(u.count)} {STR.hwUses}</Muted>
                  </View>
                ))
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

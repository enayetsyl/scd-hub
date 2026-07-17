/**
 * TrackerSummaryScreen (S12 / J4.4, redesigned per ux-audit F1): the view a
 * closed tracker lands on — two headline stat tiles, the "locked, cannot be
 * reopened" note, and the per-student result list (roster matched to the
 * pseudonymised entries client-side via lib/pseudo, same as TrackerEntry).
 * Read-only; supervisory teachers can view (read-scope).
 */
import React from "react";
import { ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import {
  TRACKER_QUERY,
  STUDENTS_QUERY,
  ASSESSMENT_SET_QUERY,
  type TrackerEntryT,
} from "../../graphql/operations";
import type { TrackersStackParamList } from "../../navigation/types";
import { Screen, Badge, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, trackerKindLabel, setTypeLabel } from "../../lib/labels";
import { buildPseudoMap } from "../../lib/pseudo";
import { makeStyles, radius, space, typeScale, useColors } from "../../theme";

type Props = NativeStackScreenProps<TrackersStackParamList, "TrackerSummary">;

function StatTile({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: "brand" | "danger" | "gold";
}): React.ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const fg = tone === "brand" ? colors.primary : tone === "danger" ? colors.error : colors.gold;
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, { color: fg }]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

export default function TrackerSummaryScreen({ route }: Props): React.ReactElement {
  const { trackerId } = route.params;
  const styles = useStyles();

  // cache-and-network: arriving right after closeTracker, the document cache
  // still holds the tracker as "open" — refresh so the lock note appears.
  const [tQ, refetchT] = useQuery({
    query: TRACKER_QUERY,
    variables: { id: trackerId },
    requestPolicy: "cache-and-network",
  });
  const tracker = tQ.data?.tracker;

  const [sQ, refetchS] = useQuery({
    query: STUDENTS_QUERY,
    variables: { sectionId: tracker?.sectionId ?? "" },
    pause: !tracker,
  });
  const [setQ, refetchSet] = useQuery({
    query: ASSESSMENT_SET_QUERY,
    variables: { id: tracker?.setId ?? "" },
    pause: !tracker,
  });

  const students = sQ.data?.studentsInSection ?? [];
  const set = setQ.data?.assessmentSet;
  const totalMarks = set?.totalMarks ?? 0;

  const mode = tracker?.trackerKind === "homework" ? "homework" : tracker?.trackerKind === "assignment" ? "assignment" : "score";
  const entries = tracker?.entries ?? [];

  const byStudent = React.useMemo(() => {
    const map = new Map<string, TrackerEntryT>();
    if (!tracker || students.length === 0) return map;
    const pseudoToId = buildPseudoMap(students.map((s) => s.id));
    for (const e of tracker.entries) {
      const sid = pseudoToId.get(e.pseudoStudentId);
      if (sid) map.set(sid, e);
    }
    return map;
  }, [tracker, students]);

  // Headline tiles per kind (prototype).
  let statA: { value: string; label: string; tone: "brand" | "danger" | "gold" };
  let statB: { value: string; label: string; tone: "brand" | "danger" | "gold" };
  if (mode === "homework") {
    statA = { value: bnNum(entries.filter((e) => e.complete === true).length), label: STR.complete, tone: "brand" };
    statB = { value: bnNum(entries.filter((e) => e.complete === false).length), label: STR.incomplete, tone: "danger" };
  } else if (mode === "assignment") {
    statA = { value: bnNum(entries.filter((e) => e.submitted === true).length), label: STR.submitted, tone: "brand" };
    statB = { value: bnNum(entries.filter((e) => e.submitted === false).length), label: STR.notSubmitted, tone: "danger" };
  } else {
    const scores = entries.filter((e) => typeof e.score === "number").map((e) => e.score as number);
    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    statA = { value: avg != null ? bnNum(avg.toFixed(1)) : "—", label: STR.trkAvgMarks, tone: "brand" };
    statB = {
      value: totalMarks > 0 ? bnNum(scores.filter((n) => n === totalMarks).length) : "—",
      label: STR.trkGotFullMarks,
      tone: "gold",
    };
  }

  function badgeFor(e: TrackerEntryT | undefined): { text: string; tone: "ok" | "danger" | "muted" } {
    if (mode === "score") {
      if (e?.score == null) return { text: STR.trkNotRecorded, tone: "muted" };
      const text = totalMarks > 0 ? `${bnNum(e.score)}/${bnNum(totalMarks)}` : bnNum(e.score);
      return { text, tone: e.score === 0 ? "danger" : "ok" };
    }
    if (mode === "homework") {
      if (e?.complete == null) return { text: STR.trkNotRecorded, tone: "muted" };
      return e.complete ? { text: STR.complete, tone: "ok" } : { text: STR.incomplete, tone: "danger" };
    }
    if (e?.submitted == null) return { text: STR.trkNotRecorded, tone: "muted" };
    return e.submitted ? { text: STR.submitted, tone: "ok" } : { text: STR.notSubmitted, tone: "danger" };
  }

  const setTitle = set ? setTypeLabel(set.setType) : tracker ? trackerKindLabel(tracker.trackerKind) : "";

  function retryAll(): void {
    refetchT({ requestPolicy: "network-only" });
    if (tracker) {
      refetchS({ requestPolicy: "network-only" });
      refetchSet({ requestPolicy: "network-only" });
    }
  }

  return (
    <Screen padded={false}>
      <QueryGate
        results={tracker ? [tQ, sQ, setQ] : [tQ]}
        onRetry={retryAll}
        loaderLabel={STR.loading}
        isEmpty={!tQ.fetching && !tracker}
        empty={
          <View style={styles.padBox}>
            <Notice message={STR.empty} tone="warn" />
          </View>
        }
      >
        {tracker ? (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.head}>
              <Text style={styles.headTitle}>✓ {STR.trkDone}</Text>
              <Text style={styles.headSub} numberOfLines={1}>
                {trackerKindLabel(tracker.trackerKind)} · {setTitle}
              </Text>
            </View>

            <View style={styles.tiles}>
              <StatTile {...statA} />
              <StatTile {...statB} />
            </View>

            {tracker.status === "closed" ? (
              <View style={styles.lockRow}>
                <Text style={styles.lockText}>{STR.trkLocked}</Text>
              </View>
            ) : null}

            <Text style={styles.sectionLabel}>{STR.trkPerStudent}</Text>

            {students.map((student) => {
              const badge = badgeFor(byStudent.get(student.id));
              return (
                <View key={student.id} style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {student.name}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {student.schoolId}
                    </Text>
                  </View>
                  <Badge text={badge.text} tone={badge.tone} />
                </View>
              );
            })}
          </ScrollView>
        ) : null}
      </QueryGate>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  padBox: { padding: space(4) },
  content: { padding: space(4), gap: space(3) },
  head: { gap: space(1) },
  headTitle: { ...typeScale.sectionTitle, color: colors.primary },
  headSub: { ...typeScale.secondary, color: colors.textSecondary },
  tiles: { flexDirection: "row", gap: space(3) },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space(4),
    gap: space(1),
  },
  tileValue: { ...typeScale.display },
  tileLabel: { ...typeScale.secondary, color: colors.textSecondary },
  lockRow: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
  lockText: { ...typeScale.caption, color: colors.textSecondary },
  sectionLabel: { ...typeScale.chip, color: colors.textSecondary, marginTop: space(1) },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { ...typeScale.body, color: colors.textPrimary },
  rowMeta: { ...typeScale.secondary, color: colors.textSecondary },
}));

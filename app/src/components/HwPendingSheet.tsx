/**
 * HwPendingSheet (D-#350) — the drill-down behind a pending number on the
 * homework lifecycle report. Given a teacher + pending stage (and the report's
 * active date/class/subject filters), it lists the named students stuck at that
 * stage — grouped into ONE ROW PER CARD (owner ask 2026-08-04): date · class ·
 * subject with the pending count, tapping straight through to that workspace card.
 * It used to list every stuck child with a guardian phone: a long scroll you could
 * not act on, when the question being asked is "which card do I open?". The names
 * are one tap further in, on the card itself. Same Modal scaffold as FilterSheet.
 */
import React from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "urql";
import { HW_LIFECYCLE_PENDING_QUERY, type HwPendingStage } from "../graphql/operations";
import { Body, Button, H2, Muted, Loader, ErrorBanner } from "./ui";
import { STR, bnNum, classLevelLabel, hwSubjectLabel, isoDateLabel } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { makeStyles, radius, space } from "../theme";

/** One homework CARD with pending students behind it — what a drill row now is. */
export interface HwPendingGroup {
  key: string;
  hwItemId: string;
  dateGiven: string;
  classLevel: number;
  subject: string;
  sectionNameBn: string | null;
  sectionId: string;
  classId: string;
  count: number;
  maxDaysWaiting: number;
}

export interface HwPendingTarget {
  teacherId: string;
  teacherName: string;
  stage: HwPendingStage;
  stageLabel: string;
}

export function HwPendingSheet({
  visible,
  target,
  from,
  to,
  classLevel,
  subject,
  onClose,
  onOpenCard,
}: {
  visible: boolean;
  target: HwPendingTarget | null;
  from: string;
  to: string;
  classLevel: number | null;
  subject: string | null;
  onClose: () => void;
  /** Open the workspace card a row stands for. Omitted → rows are not tappable. */
  onOpenCard?: (g: HwPendingGroup) => void;
}): React.ReactElement {
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  const [q] = useQuery({
    query: HW_LIFECYCLE_PENDING_QUERY,
    variables: {
      from,
      to,
      teacherId: target?.teacherId ?? "",
      stage: (target?.stage ?? "SUBMISSION") as HwPendingStage,
      classLevel,
      subject,
    },
    pause: !visible || !target,
    requestPolicy: "cache-and-network",
  });
  const rows = q.data?.homeworkLifecyclePending ?? [];

  /** One entry per homework CARD (item), newest day first — what the teacher opens. */
  const groups = React.useMemo<HwPendingGroup[]>(() => {
    const byItem = new Map<string, HwPendingGroup>();
    for (const s of rows) {
      const g = byItem.get(s.hwItemId);
      if (g) {
        g.count += 1;
        g.maxDaysWaiting = Math.max(g.maxDaysWaiting, s.daysWaiting);
        continue;
      }
      byItem.set(s.hwItemId, {
        key: s.hwItemId,
        hwItemId: s.hwItemId,
        dateGiven: s.dateGiven,
        classLevel: s.classLevel,
        subject: s.subject,
        sectionNameBn: s.sectionNameBn,
        sectionId: s.sectionId,
        classId: s.classId,
        count: 1,
        maxDaysWaiting: s.daysWaiting,
      });
    }
    return [...byItem.values()].sort(
      (a, b) => b.dateGiven.localeCompare(a.dateGiven) || a.subject.localeCompare(b.subject),
    );
  }, [rows]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdropWrap}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={STR.close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]}>
          <View style={styles.handle} />
          <H2>{target?.stageLabel ?? STR.hlrPendingHeader}</H2>
          {target ? <Muted>{target.teacherName}</Muted> : null}

          {q.error ? <ErrorBanner message={friendlyError(q.error)} /> : null}
          {q.fetching && rows.length === 0 ? <Loader label={STR.loading} /> : null}
          {!q.fetching && rows.length === 0 && !q.error ? (
            <Muted style={{ marginTop: space(2) }}>{STR.hlrNoPending}</Muted>
          ) : null}

          {/*
            ONE ROW PER CARD, not per student (owner ask 2026-08-04). The drill used to
            be a flat roll of every stuck child with their guardian's phone — dozens of
            rows to scroll, and nothing you could act on from here. What the teacher
            actually wants is "which card do I open", so it now groups by the homework
            item and shows DATE · CLASS · SUBJECT with the count, and tapping opens that
            workspace card. The names are still one tap further in, on the card itself.
          */}
          <ScrollView style={styles.scroll}>
            {groups.map((g) => (
              <Pressable
                key={g.key}
                style={styles.row}
                onPress={() => onOpenCard?.(g)}
                accessibilityRole="button"
              >
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: "600" }}>{isoDateLabel(g.dateGiven)}</Body>
                  <Muted>
                    {classLevelLabel(g.classLevel)}
                    {g.subject ? ` · ${hwSubjectLabel(g.subject)}` : ""}
                    {g.sectionNameBn ? ` · ${g.sectionNameBn}` : ""}
                  </Muted>
                </View>
                <View style={styles.wait}>
                  <Body style={{ fontWeight: "700" }}>{bnNum(g.count)}</Body>
                  <Muted>{STR.studentsWord}</Muted>
                  {g.maxDaysWaiting > 0 ? (
                    <Muted>
                      {bnNum(g.maxDaysWaiting)} {STR.hlrDays}
                    </Muted>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>

          <Button title={STR.close} variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdropWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(4),
    gap: space(2),
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    maxHeight: "88%",
  },
  handle: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.border, alignSelf: "center" },
  scroll: { flexGrow: 0 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space(2),
    paddingVertical: space(2),
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  wait: { alignItems: "flex-end", minWidth: 64 },
}));

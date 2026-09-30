/**
 * WorkCardView (WB-1/WB-2, D-#701) — one card on a work board. A MANUAL card
 * (kind TASK) carries the three status buttons; an AUTO card carries only its
 * "open the source" affordance — it is finished where its record lives.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import type { TaskStatus } from "@scd/shared";
import type { WorkCardT } from "../graphql/workBoard";
import { STR, bnNum, taskPriorityLabel, taskStatusLabel, workCardKindLabel } from "../lib/labels";
import { minutesLabel } from "../lib/workBoardNav";
import { makeStyles, radius, space, typeScale, useColors } from "../theme";

export function WorkCardView({
  card,
  onOpen,
  onStatus,
  busy = false,
  showAssignee,
}: {
  card: WorkCardT;
  onOpen?: () => void;
  /** Present only on a manual card the viewer may work: the three status buttons. */
  onStatus?: (status: TaskStatus | "BLOCK") => void;
  busy?: boolean;
  /** For an assigner's list: name the person the card belongs to. */
  showAssignee?: string | null;
}): React.ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const manual = card.kind === "TASK";
  const done = card.status === "DONE";
  const stripe = manual ? colors.primary : colors.info;
  const blocked = !!card.blockedReason;

  const chip = ((): { text: string; bg: string; fg: string } | null => {
    if (done) return { text: taskStatusLabel("DONE"), bg: colors.primaryContainer, fg: colors.onPrimaryContainer };
    if (blocked) return { text: STR.wbBlock, bg: colors.errorContainer, fg: colors.onErrorContainer };
    if (card.overdue) return { text: STR.wbOverdue, bg: colors.errorContainer, fg: colors.onErrorContainer };
    if (card.status === "DOING") return { text: taskStatusLabel("DOING"), bg: colors.warningContainer, fg: colors.warning };
    if (card.priority === "URGENT") return { text: taskPriorityLabel("URGENT"), bg: colors.errorContainer, fg: colors.onErrorContainer };
    return null;
  })();

  return (
    <Pressable onPress={onOpen} disabled={!onOpen} style={({ pressed }) => [styles.card, done && styles.done, pressed && onOpen ? styles.pressed : null]}>
      <View style={[styles.stripe, { backgroundColor: stripe }]} />
      <View style={styles.body}>
        <View style={styles.row}>
          <Text style={[styles.title, done && styles.strike]} numberOfLines={3}>
            {card.titleBn}
          </Text>
          {chip ? (
            <View style={[styles.chip, { backgroundColor: chip.bg }]}>
              <Text style={[styles.chipText, { color: chip.fg }]}>{chip.text}</Text>
            </View>
          ) : (
            <Text style={styles.mins}>{minutesLabel(card.effortMin, bnNum)}</Text>
          )}
        </View>
        {card.detailBn ? <Text style={styles.meta}>{card.detailBn}</Text> : null}
        {blocked ? <Text style={[styles.meta, { color: colors.error }]}>{`${STR.wbBlock}: ${card.blockedReason}`}</Text> : null}
        <Text style={styles.meta}>
          {[
            showAssignee ?? null,
            manual && card.assignedByName ? `${card.assignedByName} ${STR.wbAssignedBy}` : null,
            manual && card.forLabel ? `${STR.wbForLabel.replace(/ \(.*\)$/, "")}: ${card.forLabel}` : null,
            manual ? `${STR.wbDue} ${bnNum(card.dateKey)}` : null,
            chip ? minutesLabel(card.effortMin, bnNum) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <View style={styles.footer}>
          <View style={[styles.kind, { backgroundColor: manual ? colors.primaryContainer : colors.infoContainer }]}>
            <Text style={[styles.kindText, { color: manual ? colors.onPrimaryContainer : colors.info }]}>
              {manual ? workCardKindLabel("TASK") : `${STR.wbAuto} · ${workCardKindLabel(card.kind)}`}
            </Text>
          </View>
          {!manual && onOpen ? <Text style={[styles.open, { color: colors.info }]}>{STR.wbOpenSource}</Text> : null}
        </View>
        {manual && onStatus && !done ? (
          <View style={styles.acts}>
            {card.status !== "DOING" ? (
              <Pressable disabled={busy} onPress={() => onStatus("DOING")} style={[styles.act, styles.actPrimary, { backgroundColor: colors.primary }]}>
                <Text style={[styles.actText, { color: colors.onPrimary }]}>{taskStatusLabel("DOING")}</Text>
              </Pressable>
            ) : null}
            <Pressable disabled={busy} onPress={() => onStatus("DONE")} style={[styles.act, card.status === "DOING" && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
              <Text style={[styles.actText, card.status === "DOING" && { color: colors.onPrimary }]}>{taskStatusLabel("DONE")}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => onStatus("BLOCK")} style={styles.act}>
              <Text style={styles.actText}>{blocked ? STR.wbUnblock : STR.wbBlock}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  card: {
    flexDirection: "row",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: "hidden",
    marginBottom: space(2),
  },
  done: { opacity: 0.62 },
  pressed: { opacity: 0.85 },
  stripe: { width: 4 },
  body: { flex: 1, padding: space(3), gap: space(1), minWidth: 0 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space(2) },
  title: { ...typeScale.bodyStrong, color: c.textPrimary, flex: 1, minWidth: 0 },
  strike: { textDecorationLine: "line-through" },
  meta: { ...typeScale.caption, color: c.textSecondary },
  mins: { ...typeScale.caption, color: c.textSecondary, flexShrink: 0 },
  chip: { borderRadius: radius.pill, paddingHorizontal: space(2), paddingVertical: 2, flexShrink: 0 },
  chipText: { ...typeScale.caption, fontFamily: typeScale.chip.fontFamily },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  kind: { borderRadius: radius.pill, paddingHorizontal: space(2), paddingVertical: 1 },
  kindText: { ...typeScale.caption },
  open: { ...typeScale.caption, fontFamily: typeScale.chip.fontFamily },
  acts: { flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) },
  act: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.sm,
    paddingHorizontal: space(3),
    paddingVertical: space(1),
    backgroundColor: c.surface,
  },
  actPrimary: { borderColor: "transparent" },
  actText: { ...typeScale.caption, fontFamily: typeScale.chip.fontFamily, color: c.textPrimary },
}));

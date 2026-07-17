/**
 * TrackerProgressHeader (ux-audit F1): sticky header for TrackerEntry —
 * tracker title + code line, a 48dp ✕ close action, and the live
 * "১২/৩০ রেকর্ড হয়েছে" counter with an 8dp progress bar. Rendered OUTSIDE the
 * scroll view so the count stays visible while the teacher works down the
 * roster.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { STR, trackerProgressMsg } from "../lib/labels";
import { makeStyles, radius, space, typeScale } from "../theme";

export function TrackerProgressHeader({
  title,
  subtitle,
  recorded,
  total,
  onClose,
}: {
  title: string;
  subtitle?: string;
  recorded: number;
  total: number;
  onClose?: () => void;
}): React.ReactElement {
  const styles = useStyles();
  const pct = total > 0 ? Math.min(1, recorded / total) : 0;
  return (
    <View style={styles.host}>
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {onClose ? (
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={STR.closeTracker}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          >
            <Text style={styles.closeGlyph}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.progressRow}>
        <Text style={styles.progressText}>{trackerProgressMsg(recorded, total)}</Text>
        <Text style={styles.hint}>{STR.trkOneTap}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  host: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: space(4),
    paddingTop: space(2),
    paddingBottom: space(3),
    gap: space(2),
  },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: space(2) },
  titleBlock: { flex: 1, minWidth: 0, paddingTop: space(1) },
  title: { ...typeScale.sectionTitle, color: colors.textPrimary },
  subtitle: { ...typeScale.secondary, color: colors.textSecondary },
  closeBtn: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  closeGlyph: { ...typeScale.sectionTitle, color: colors.textSecondary },
  progressRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space(2),
  },
  progressText: { ...typeScale.chip, color: colors.textPrimary },
  hint: { ...typeScale.caption, color: colors.textSecondary },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  pressed: { opacity: 0.7 },
}));

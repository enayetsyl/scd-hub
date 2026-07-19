/**
 * BatchBar (ux-audit F1): one-tap batch action above the roster — e.g.
 * "সবাই সম্পন্ন" fills every still-unrecorded row with the tracker kind's
 * default outcome in ONE batched mutation. Individually-recorded rows are
 * never overwritten (user decision at plan review). After a batch, rows that
 * deviate from the default show up in the ব্যতিক্রম counter.
 */
import React from "react";
import { View } from "react-native";
import { Button, Badge } from "./ui";
import { STR, bnNum } from "../lib/labels";
import { makeStyles, radius, space } from "../theme";

export function BatchBar({
  actionLabel,
  onApply,
  exceptionsCount,
  disabled = false,
}: {
  actionLabel: string;
  onApply: () => void;
  /** Recorded rows deviating from the batch default; 0 hides the badge. */
  exceptionsCount: number;
  /** Disable when every row is already recorded (nothing left to fill). */
  disabled?: boolean;
}): React.ReactElement {
  const styles = useStyles();
  return (
    <View style={styles.host}>
      <View style={styles.button}>
        <Button title={`✓ ${actionLabel}`} onPress={onApply} disabled={disabled} />
      </View>
      {exceptionsCount > 0 ? (
        <Badge text={`${STR.trkExceptions} ${bnNum(exceptionsCount)}`} tone="warn" />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  host: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space(2),
  },
  button: { flex: 1 },
}));

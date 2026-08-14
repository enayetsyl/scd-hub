/**
 * LoadOlder (D-#476) — the "show older" foot of every guardian history list.
 *
 * Guardian lists are anchored to today and walk BACKWARDS, so paging back is the
 * only direction that exists: there is no "next page", only an older window. The
 * screens keep their own from/to state and simply widen it; this component owns
 * nothing but the three states that widening can be in — can page, is paging,
 * nothing older left.
 *
 * The date pickers above a list and this button are deliberately BOTH offered:
 * the pickers answer "show me that week in Ramadan", the button answers "keep
 * going back a bit" without a parent having to work out a date.
 */
import React from "react";
import { View } from "react-native";
import { Button, Muted } from "./ui";
import { STR } from "../lib/labels";
import { space } from "../theme/tokens";

export function LoadOlder({
  onPress,
  loading = false,
  exhausted = false,
  label,
}: {
  onPress: () => void;
  /** A fetch for the wider window is in flight. */
  loading?: boolean;
  /** The last widening returned nothing new — there is no more history. */
  exhausted?: boolean;
  label?: string;
}): React.ReactElement {
  if (exhausted) {
    return (
      <Muted style={{ textAlign: "center", marginTop: space(3), marginBottom: space(2) }}>
        {STR.gpNoOlder}
      </Muted>
    );
  }
  return (
    <View style={{ marginTop: space(3), marginBottom: space(2) }}>
      <Button
        title={loading ? STR.gpLoadingOlder : (label ?? STR.gpLoadOlder)}
        variant="secondary"
        loading={loading}
        disabled={loading}
        onPress={onPress}
      />
    </View>
  );
}

export default LoadOlder;

/**
 * MoreOptions (UX-6, prd-ux-improvements.md §4.6, D-#265) — the collapsed
 * "আরও অপশন" fold for rarely-changed form inputs. The happy path never needs to
 * open it: folded fields keep their (defaulted) state whether or not the fold is
 * open. A ghost button toggles; 48dp target via the shared Button.
 */
import React from "react";
import { View } from "react-native";
import { Button } from "./ui";
import { STR } from "../lib/labels";

export function MoreOptions({
  children,
  initiallyOpen = false,
}: {
  children: React.ReactNode;
  initiallyOpen?: boolean;
}): React.ReactElement {
  const [open, setOpen] = React.useState(initiallyOpen);
  return (
    <View>
      <Button
        title={`${open ? "▾" : "▸"} ${STR.moreOptions}`}
        variant="ghost"
        onPress={() => setOpen((o) => !o)}
      />
      {open ? <View>{children}</View> : null}
    </View>
  );
}

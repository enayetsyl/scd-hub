/**
 * ChildSwitcher (GP-2, J5.3) — the persistent header control on every guardian
 * screen. Multi-child families switch with chips; a single-child family skips
 * the chooser but still sees the child's name + class.
 */
import React from "react";
import { View } from "react-native";
import { Body, Muted, Card, Chip, ChipRow } from "./ui";
import { useGuardianChild } from "../state/GuardianChildContext";
import { STR, getActiveLang, classLevelLabel } from "../lib/labels";
import { space } from "../theme/tokens";

export function ChildSwitcher(): React.ReactElement | null {
  const { children, selected, selectChild } = useGuardianChild();
  const lang = getActiveLang();
  const displayName = (c: { name: string; nameBn: string }): string => (lang === "en" ? c.name : c.nameBn);
  if (children.length === 0) return null;
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Body style={{ fontWeight: "700" }}>
          {selected ? displayName(selected) : STR.gpChildren}
        </Body>
        {selected ? <Muted>{classLevelLabel(selected.classLevel)}</Muted> : null}
      </View>
      {children.length > 1 ? (
        <View style={{ marginTop: space(2) }}>
          <ChipRow>
            {children.map((c) => (
              <Chip
                key={c.studentId}
                label={displayName(c)}
                selected={selected?.studentId === c.studentId}
                onPress={() => selectChild(c.studentId)}
              />
            ))}
          </ChipRow>
        </View>
      ) : null}
    </Card>
  );
}

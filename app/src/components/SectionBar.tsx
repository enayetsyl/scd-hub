/**
 * Section selection bar used by the section-scoped journeys (sets + trackers).
 * Shows the current class/section or prompts to pick one. `onChange` navigates
 * to the SectionPicker in the host stack.
 */
import React from "react";
import { View } from "react-native";
import { Card, Body, Muted, Button } from "./ui";
import { STR } from "../lib/labels";
import { useSectionContext } from "../state/SectionContext";
import { space } from "../theme/tokens";

export function SectionBar({ onChange }: { onChange: () => void }): React.ReactElement {
  const { selection, hasSection } = useSectionContext();

  return (
    <Card>
      {hasSection ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) }}>
          <View style={{ flex: 1 }}>
            <Muted>{STR.section}</Muted>
            <Body style={{ fontWeight: "600" }}>
              {selection.classNameBn} · {selection.sectionNameBn}
            </Body>
          </View>
          <Button title={STR.select} variant="ghost" onPress={onChange} />
        </View>
      ) : (
        <View>
          <Muted style={{ marginBottom: space(2) }}>{STR.noSectionSelected}</Muted>
          <Button title={STR.pickSection} variant="secondary" onPress={onChange} />
        </View>
      )}
    </Card>
  );
}

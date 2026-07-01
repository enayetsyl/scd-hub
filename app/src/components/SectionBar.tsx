/**
 * Section selection bar used by the section-scoped journeys (sets + trackers).
 * Shows the current class/section or prompts to pick one. `onChange` navigates
 * to the SectionPicker in the host stack.
 */
import React from "react";
import { View } from "react-native";
import { Card, Body, Muted, Button } from "./ui";
import { STR, classLevelLabel, getActiveLang } from "../lib/labels";
import { useSectionContext } from "../state/SectionContext";
import { space } from "../theme/tokens";

/** Sections that ARE the whole class (post-merge) - their name is redundant noise
 * next to the class, so we show just the class. Real sub-sections (Boys/Girls) stay. */
const WHOLE_CLASS_SECTIONS = new Set(["মূল", "সম্মিলিত"]);

export function SectionBar({ onChange }: { onChange: () => void }): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const lang = getActiveLang();
  const classLabel = lang === "en" ? classLevelLabel(selection.classLevel ?? 0) : selection.classNameBn;
  const sectionLabel = lang === "en" ? selection.sectionCode ?? selection.sectionNameBn : selection.sectionNameBn;
  const showSection = !!sectionLabel && !WHOLE_CLASS_SECTIONS.has(sectionLabel);

  return (
    <Card>
      {hasSection ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) }}>
          <View style={{ flex: 1 }}>
            <Muted>{STR.klass}</Muted>
            <Body style={{ fontWeight: "600" }}>
              {classLabel}
              {showSection ? ` · ${sectionLabel}` : ""}
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

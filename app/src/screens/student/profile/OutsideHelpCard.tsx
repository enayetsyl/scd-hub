/**
 * OutsideHelpCard (AL-12, AC-H4/H5, D-#1676) - the term tag after an outside-help outcome, on the student profile's
 * homework and assignment tabs (staff only). One line per tagged objective: subject, the objective, the note
 * "বাড়ির কাজে বাইরের সাহায্য সন্দেহ", an "অস্পষ্ট" mark when the outcome was unclear and a "বারবার" badge at 2+ cases in
 * the term. A note on the profile; it never changes a mark. Renders nothing when there is no live tag.
 */
import React from "react";
import { View } from "react-native";
import type { ProfileOutsideHelpT } from "../../../graphql/studentProfile";
import { Badge, Body, Card, Muted } from "../../../components/ui";
import { STR, hwSubjectLabel, isoDateLabel } from "../../../lib/labels";
import { space } from "../../../theme";

export function OutsideHelpCard({ tags }: { tags: readonly ProfileOutsideHelpT[] | null | undefined }): React.ReactElement | null {
  const rows = tags ?? [];
  if (rows.length === 0) return null;
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.hiOutsideHelpTitle}</Body>
      <View style={{ gap: space(2), marginTop: space(1) }}>
        {rows.map((t) => (
          <View key={t.caseId} style={{ gap: 2 }}>
            <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap", alignItems: "center" }}>
              <Body style={{ fontWeight: "600", flexShrink: 1 }}>
                {hwSubjectLabel(t.subject)} — {t.loLabelBn}
              </Body>
              {t.outcome === "UNCLEAR" ? <Badge text={STR.hiOutcomeUnclear} tone="muted" /> : null}
              {t.recurring ? <Badge text={STR.hiRecurring} tone="danger" /> : null}
            </View>
            <Muted>
              {t.markBn} · {STR.hiOutsideHelpUntil.replace("{d}", isoDateLabel(t.tagUntil))}
            </Muted>
          </View>
        ))}
      </View>
    </Card>
  );
}

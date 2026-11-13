/**
 * এই শিক্ষার্থীর সাথে যেভাবে কাজ করবেন — the card and the full profile (docs/prd-child-support-profile.md
 * §9.1, §9.2; D-#1557). Every open is audited by the server (surface + via). Strengths first; do's
 * with their kind, level line and lead marks; avoids with their "বরং"; one goal; the fixed footer. No
 * print, share or copy; a faint "পড়ছেন:" line discourages screenshots.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { SUPPORT_LEVEL_LABELS_BN, SUPPORT_SECTION_LABELS_BN, SUPPORT_STRATEGY_KIND_LABELS_BN, type SupportLevel, type SupportSection, type SupportStrategyKind } from "@scd/shared";
import { SUPPORT_PROFILE_VIEW, type SupportItemT, type SupportProfileViewT } from "../../graphql/supportProfile";
import type { HomeStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Loader, Notice, H2, Chip, ChipRow } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeStackParamList, "SupportCard">;

function countLine(i: SupportItemT): string {
  const parts = [
    i.level ? SUPPORT_LEVEL_LABELS_BN[i.level as SupportLevel] : "",
    i.teachersCount ? `${bnNum(i.teachersCount)} ${STR.supTeachers}` : "",
    i.settings.length ? i.settings.join(", ") : "",
    i.lastEvidenceKey ? `${STR.supLatest} ${i.lastEvidenceKey}` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}
const isLead = (i: SupportItemT) => i.level === "SINGLE" || i.level === "EMERGING";

export default function SupportCardScreen({ route, navigation }: Props): React.ReactElement {
  const { studentId, via } = route.params;
  const [full, setFull] = useState<boolean>(!!route.params.full);
  const { user, can } = useAuth();
  const [q] = useQuery<{ supportProfileView: SupportProfileViewT | null }>({
    query: SUPPORT_PROFILE_VIEW,
    variables: { studentId, surface: full ? "FULL" : "CARD", via },
    requestPolicy: "network-only",
  });
  const v = q.data?.supportProfileView;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        {q.fetching ? <Loader /> : null}
        {q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : null}
        {!q.fetching && !q.error && !v ? <Notice message={STR.supNoProfile} tone="info" /> : null}
        {v ? (
          <>
            <H2>{`${v.studentName} — ${STR.supCardTitle}`}</H2>
            <ChipRow>
              <Chip label={STR.supCardTitle} selected={!full} onPress={() => setFull(false)} />
              <Chip label={STR.supFullProfile} selected={full} onPress={() => setFull(true)} />
            </ChipRow>
            {!full && v.card ? (
              <Card>
                {v.card.strengths.length ? <Body>{`${STR.supStrengths}: ${v.card.strengths.map((s) => s.textBn).join(" · ")}`}</Body> : null}
                <Body style={{ fontWeight: "700", marginTop: space(2) }}>{STR.supDo}</Body>
                {v.card.dos.length === 0 ? <Muted>{STR.supNoStrategyYet}</Muted> : null}
                {v.card.dos.map((d) => (
                  <View key={d.itemId} style={{ marginTop: space(1) }}>
                    <Body>{`✓ [${isLead(d) ? STR.supTryIt : d.kind ? SUPPORT_STRATEGY_KIND_LABELS_BN[d.kind as SupportStrategyKind] : ""}] ${d.textBn}`}</Body>
                    <Muted>{d.teachersCount === 1 ? `${countLine(d)} · ${STR.supOneTeacher}` : countLine(d)}</Muted>
                  </View>
                ))}
                {v.card.avoids.length ? <Body style={{ fontWeight: "700", marginTop: space(2) }}>{STR.supAvoid}</Body> : null}
                {v.card.avoids.map((a) => (
                  <Body key={a.itemId}>{`✗ ${a.textBn} → ${STR.supInstead}: ${a.insteadText ?? ""}`}</Body>
                ))}
                {v.card.goal ? <Body style={{ marginTop: space(2) }}>{`${STR.supGoal}: ${v.card.goal.textBn}`}</Body> : null}
              </Card>
            ) : null}
            {full
              ? v.sections
                  .filter((s) => s.items.length)
                  .map((s) => (
                    <Card key={s.section}>
                      <Body style={{ fontWeight: "700" }}>{SUPPORT_SECTION_LABELS_BN[s.section as SupportSection]}</Body>
                      {s.items.map((i) => (
                        <View key={i.itemId} style={{ marginTop: space(1), opacity: i.stale || i.dormant ? 0.6 : 1 }}>
                          <Body>{i.textBn}</Body>
                          <Muted>{[countLine(i), i.dormant ? STR.supDormant : i.stale ? STR.supStale : ""].filter(Boolean).join(" · ")}</Muted>
                        </View>
                      ))}
                    </Card>
                  ))
              : null}
            {can("support_profile:report") ? (
              <Button title={STR.supWriteReport} variant="secondary" onPress={() => navigation.navigate("SupportReportForm", { studentId })} />
            ) : null}
            <Muted>{STR.supFooter}</Muted>
            <Muted>{`${STR.supReadingAs} ${user?.name ?? ""}`}</Muted>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

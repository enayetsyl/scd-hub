/**
 * ChildMasteryScreen (M-6, mocks G1 / G2 / G4) — the guardian's view of their child's learning,
 * per subject the school has switched on, in plain words only (D-#783): how many topics need
 * attention / are improving / are going well, what to do at home for each topic that needs
 * attention, and what the school did (extra classes, re-teaching, the re-test result). Never a
 * code, a verdict word, a rank or another child.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { CHILD_MASTERY_PROGRESS, type ChildMasteryProgressRow } from "../../graphql/mastery";
import { Screen, Body, Muted, Card, Badge, Loader, EmptyState, Notice } from "../../components/ui";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

export default function ChildMasteryScreen(): React.ReactElement {
  const { selected } = useGuardianChild();
  const [{ data, fetching, error }] = useQuery({
    query: CHILD_MASTERY_PROGRESS,
    variables: { studentId: selected?.studentId ?? "" },
    pause: !selected,
    requestPolicy: "cache-and-network",
  });
  const subjects = (data?.childMasteryProgress ?? []) as ChildMasteryProgressRow[];
  const name = selected?.nameBn || selected?.name || "";

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <ChildSwitcher />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4), gap: space(3) }}>
        {!selected || (fetching && subjects.length === 0) ? <Loader label={STR.loading} /> : null}
        {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
        {selected && !fetching && !error && subjects.length === 0 ? <EmptyState message={STR.gpMsNone} /> : null}
        {subjects.map((s) => (
          <Card key={s.subject}>
            <Body style={{ fontWeight: "700", fontSize: 17 }}>{hwSubjectLabel(s.subject)}</Body>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
              <Badge text={`${STR.gpMsAttention} ${bnNum(s.counts.attention)}`} tone={s.counts.attention > 0 ? "danger" : "muted"} />
              <Badge text={`${STR.gpMsImproving} ${bnNum(s.counts.improving)}`} tone="warn" />
              <Badge text={`${STR.gpMsGood} ${bnNum(s.counts.good)}`} tone="ok" />
              <Badge text={`${STR.gpMsUnknown} ${bnNum(s.counts.unknown)}`} tone="muted" />
            </View>

            {s.attention.length > 0 ? (
              <View style={{ gap: space(1) }}>
                <Body style={{ fontWeight: "600" }}>{STR.gpMsAttentionTitle}</Body>
                {s.attention.map((a) => (
                  <View key={a.labelBn} style={{ gap: 2 }}>
                    <Body>• {a.labelBn}</Body>
                    {a.homeTipBn ? (
                      <Muted>
                        {STR.gpMsHomeTip} {a.homeTipBn}
                      </Muted>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : (
              <Muted>{STR.gpMsNothingAttention.replace("{name}", name)}</Muted>
            )}

            {s.improving.length > 0 ? (
              <View style={{ gap: 2 }}>
                <Body style={{ fontWeight: "600" }}>{STR.gpMsImprovingTitle}</Body>
                {s.improving.map((x) => (
                  <Body key={x.labelBn}>• {x.labelBn}</Body>
                ))}
              </View>
            ) : null}

            <View style={{ gap: 2 }}>
              <Body style={{ fontWeight: "600" }}>{STR.gpMsSchoolDid}</Body>
              {s.assignmentsSent > 0 ? <Body>• {STR.gpMsAssignmentsSent.replace("{n}", bnNum(s.assignmentsSent))}</Body> : null}
              {s.schoolDid.map((d, i) => (
                <Body key={`${d.date}-${i}`}>
                  • {bnNum(d.date)} · {d.kind === "EXTRA_CLASS" ? STR.gpMsExtraClass : STR.gpMsReteach} · {d.labelBn}
                  {d.present === false ? ` · ${STR.gpMsMissed}` : ""}
                  {d.retestPct !== null ? ` · ${STR.gpMsRetest} ${bnNum(d.retestPct)}%` : ""}
                </Body>
              ))}
              {s.assignmentsSent === 0 && s.schoolDid.length === 0 ? <Muted>{STR.gpMsNothingYet}</Muted> : null}
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

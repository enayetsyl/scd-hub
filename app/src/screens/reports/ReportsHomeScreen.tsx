/**
 * ReportsHomeScreen (D-#309) — the Principal/Office Reports hub: one launcher
 * for the oversight reports. ALL six open in THIS stack (D-#311): the
 * attendance/class-note report screens are mounted here too, so the back
 * button returns to the hub — the original cross-tab jump popped to the host
 * tab's home (owner report).
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ReportsStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card } from "../../components/ui";
import { STR } from "../../lib/labels";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReportsStackParamList, "ReportsHome">;

export default function ReportsHomeScreen({ navigation }: Props): React.ReactElement {
  const cards: Array<{ icon: string; title: string; sub?: string; onPress: () => void }> = [
    { icon: "🙋", title: STR.attReportTitle, onPress: () => navigation.navigate("AttendanceReport") },
    { icon: "📓", title: STR.rtNoteReportTitle, onPress: () => navigation.navigate("ClassNoteReport") },
    { icon: "📕", title: STR.rptHwDeclarePending, sub: STR.rrHwNdSub, onPress: () => navigation.navigate("HwDeclarePending") },
    { icon: "📒", title: STR.rptHwIssuePending, sub: STR.admSubReconReport, onPress: () => navigation.navigate("HwIssuePending") },
    { icon: "📋", title: STR.rptAsDeclarePending, sub: STR.rptAsNdSub, onPress: () => navigation.navigate("AsDeclarePending") },
    { icon: "📦", title: STR.rptAsDeliverPending, onPress: () => navigation.navigate("AsDeliverPending") },
  ];

  return (
    <Screen scroll>
      <H2>{STR.tabReports}</H2>
      <Muted style={{ marginBottom: space(2) }}>{STR.rptHomeSub}</Muted>
      {cards.map((c) => (
        <Card key={c.title} onPress={c.onPress}>
          <Body style={{ fontWeight: "700" }}>
            {c.icon} {c.title}
          </Body>
          {c.sub ? <Muted style={{ marginTop: 2 }}>{c.sub}</Muted> : null}
        </Card>
      ))}
    </Screen>
  );
}

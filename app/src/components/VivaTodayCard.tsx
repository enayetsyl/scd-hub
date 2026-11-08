/**
 * VivaTodayCard (D-#1082, mockup screen 5) — on an examiner's Today screen: today's oral
 * papers with the caller's progress; a tap opens the mark sheet. Renders nothing on a day
 * with no oral. Has its own query, so it is mounted OUTSIDE Today's QueryGate (an empty
 * Today would otherwise swallow it).
 */
import React from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { useNavigation } from "@react-navigation/native";
import { MY_VIVA_PAPERS } from "../graphql/viva";
import { Body, Button, Card, Muted } from "./ui";
import { useAuth } from "../auth/AuthContext";
import { STR, bnNum, dhakaDateKey } from "../lib/labels";
import { space } from "../theme";

export function VivaTodayCard(): React.ReactElement | null {
  const today = dhakaDateKey();
  const { user } = useAuth();
  const [q] = useQuery({ query: MY_VIVA_PAPERS });
  const nav = useNavigation() as unknown as { navigate: (name: string, params?: object) => void };
  const papers = (q.data?.myVivaPapers ?? []).filter((p) => p.dateKey === today);
  if (!papers.length) return null;
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.vivaTodayCard}</Body>
      <View style={{ gap: space(2), marginTop: space(1) }}>
        {papers.map((p) => {
          const e = p.examiners.find((x) => x.userId === user?.id);
          // The caller's own children (myVivaPapers only returns papers where they examine).
          const mine = e ? { n: e.children, d: e.done, x: e.absent } : { n: p.progress.children, d: p.progress.done, x: p.progress.absent };
          return (
            <View key={p.id} style={{ gap: space(1) }}>
              <Body>
                {p.classLabelBn} · {p.subjectLabelBn}
              </Body>
              <Muted>{STR.vivaProgress.replace("{n}", bnNum(mine.n)).replace("{d}", bnNum(mine.d)).replace("{a}", bnNum(mine.x))}</Muted>
              <Button title={STR.vivaOpenSheet} onPress={() => nav.navigate("VivaTab", { screen: "VivaSheet", params: { paperId: p.id }, initial: false })} />
            </View>
          );
        })}
      </View>
    </Card>
  );
}

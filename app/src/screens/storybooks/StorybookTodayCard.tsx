/**
 * The storybook card on the guardian's আজ (SB-4, D-#984 — the Today-card leg of the
 * alerts): a book lent today, a book held at the office, the books at home with due dates,
 * and this month's reading + stickers. Hidden when the child has no storybook activity.
 * Tapping it opens "my child's books".
 */
import React from "react";
import { Pressable, View } from "react-native";
import { useQuery } from "urql";
import { CHILD_STORY_READING, CHILD_STORY_WAITS } from "../../graphql/storybooks";
import { Badge, Body, Card, Muted } from "../../components/ui";
import { STR, bnNum, dhakaDateKey, isoDateLabel } from "../../lib/labels";
import { space } from "../../theme";

export function StorybookTodayCard({ studentId, childName, onOpen }: { studentId: string; childName: string; onOpen: () => void }): React.ReactElement | null {
  const [q] = useQuery({ query: CHILD_STORY_READING, variables: { studentId }, pause: !studentId });
  const [wq] = useQuery({ query: CHILD_STORY_WAITS, variables: { studentId }, pause: !studentId });
  const r = q.data?.childStoryReading;
  const held = (wq.data?.childStoryWaits ?? []).filter((w) => w.position === 0);
  if (!r || (r.current.length === 0 && r.history.length === 0 && held.length === 0)) return null;
  const today = dhakaDateKey(new Date());
  const newToday = r.current.filter((l) => dhakaDateKey(l.issuedAt) === today);
  return (
    <Pressable onPress={onOpen} accessibilityRole="button">
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
          <Body style={{ fontWeight: "700", flex: 1 }}>{STR.stbNav}</Body>
          <Muted>{STR.stbTodayOpen}</Muted>
        </View>
        {newToday.map((l) => (
          <Badge key={l.loanId} text={STR.stbTodayNew.replace("{book}", l.titleBn)} tone="info" />
        ))}
        {held.map((w) => (
          <Muted key={w.titleId} style={{ marginTop: space(1) }}>
            {STR.stbWaitHeld.replace("{name}", childName).replace("{date}", isoDateLabel(w.holdUntil))}
          </Muted>
        ))}
        {r.current.map((l) => (
          <Muted key={l.loanId} style={{ marginTop: space(1) }}>
            • {l.titleBn} · {STR.stbDueOn.replace("{date}", isoDateLabel(l.dueDate))}
            {l.overdue ? ` · ${STR.stbDeskOverdue}` : ""}
          </Muted>
        ))}
        <Muted style={{ marginTop: space(2) }}>{STR.stbTodayLine.replace("{n}", bnNum(r.readThisMonth)).replace("{s}", bnNum(r.stickersThisYear))}</Muted>
      </Card>
    </Pressable>
  );
}

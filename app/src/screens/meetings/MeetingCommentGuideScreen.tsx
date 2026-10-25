/**
 * MeetingCommentGuideScreen (D-#850) — the teachers' guideline for parents'-meeting
 * comments: why, the two boxes, five rules, what not to write, length/language, before→
 * after rewrites, one child's full example, the class teacher's extra rules and a
 * checklist. Content lives in content/meetingCommentGuide.ts; this file only lays it out.
 *
 * Reached from both write screens (MeetingSubjectNote / MeetingSummaryWrite) and from the
 * daily reminder popup (D-#851). No params, and never first in the Home stack.
 */
import React from "react";
import { ScrollView, Text, View } from "react-native";
import { Body, Card, Muted, Screen } from "../../components/ui";
import { MEETING_COMMENT_GUIDE, MEETING_COMMENT_GUIDE_TITLE, type GuideSection } from "../../content/meetingCommentGuide";
import { useColors } from "../../theme";
import { radius, space } from "../../theme/tokens";

function Bullet({ text, mark = "•" }: { text: string; mark?: string }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", gap: space(2) }}>
      <Body>{mark}</Body>
      <Body style={{ flex: 1 }}>{text}</Body>
    </View>
  );
}

function Tinted({ text, tone }: { text: string; tone: "bad" | "good" }): React.ReactElement {
  const c = useColors();
  const bg = tone === "bad" ? c.errorContainer : c.primaryContainer;
  const fg = tone === "bad" ? c.onErrorContainer : c.onPrimaryContainer;
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.sm, padding: space(2), flexDirection: "row", gap: space(2) }}>
      <Text style={{ color: fg }}>{tone === "bad" ? "❌" : "✅"}</Text>
      <Text style={{ color: fg, flex: 1, lineHeight: 22 }}>{text}</Text>
    </View>
  );
}

function Section({ s }: { s: GuideSection }): React.ReactElement {
  const c = useColors();
  return (
    <Card>
      <View style={{ gap: space(2) }}>
        <Body style={{ fontWeight: "700" }}>{s.title}</Body>
        {s.paragraphs?.map((p) => <Body key={p}>{p}</Body>)}
        {s.bullets?.map((b) => <Bullet key={b} text={b} />)}
        {s.note ? <Body style={{ fontWeight: "600" }}>{s.note}</Body> : null}
        {s.bad ? <Tinted tone="bad" text={s.bad} /> : null}
        {s.good ? <Tinted tone="good" text={s.good} /> : null}
        {s.pairs?.map((p) => (
          <View key={p.before} style={{ gap: space(1), borderTopWidth: 1, borderTopColor: c.border, paddingTop: space(2) }}>
            <Tinted tone="bad" text={p.before} />
            <Tinted tone="good" text={p.after} />
          </View>
        ))}
        {s.blocks?.map((b) => (
          <View key={b.heading} style={{ gap: space(1), borderTopWidth: 1, borderTopColor: c.border, paddingTop: space(2) }}>
            <Body style={{ fontWeight: "600" }}>{b.heading}</Body>
            {b.lines.map((l) => <Bullet key={l} text={l} />)}
          </View>
        ))}
        {s.checks?.map((t) => <Bullet key={t} text={t} mark="☐" />)}
      </View>
    </Card>
  );
}

export default function MeetingCommentGuideScreen(): React.ReactElement {
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        <Body style={{ fontWeight: "700", fontSize: 18 }}>{MEETING_COMMENT_GUIDE_TITLE}</Body>
        <Muted>প্রতিটি মন্তব্যে দুটি ঘর: ভালো দিক ও চিন্তার বিষয়। নিচের নিয়মগুলো মেনে লিখুন।</Muted>
        {MEETING_COMMENT_GUIDE.map((s) => (
          <Section key={s.title} s={s} />
        ))}
      </ScrollView>
    </Screen>
  );
}

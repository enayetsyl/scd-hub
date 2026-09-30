/**
 * Complaints tab — the student comments (which replaced the old "Student-Complain"
 * Google Form) with concerns listed first, an All / Concern / Positive filter, and
 * the parent-meeting notes underneath. Read-only: writing a comment stays on the
 * comment-entry screen that owns its gate.
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import type { ProfileCommentsT } from "../../../graphql/studentProfile";
import { Badge, Body, Card, Chip, ChipRow, Loader, Muted, Notice } from "../../../components/ui";
import { STR, bnNum, commentTypeLabel, isoDateLabel } from "../../../lib/labels";
import { radius, space, useColors } from "../../../theme";
import { SectionTitle, StatTile, TileRow } from "./parts";

type Filter = "all" | "CONCERN" | "POSITIVE";

export function ComplainTab({
  data,
  fetching,
  error,
  rangeControl,
}: {
  data: ProfileCommentsT | null;
  fetching: boolean;
  error: string | null;
  rangeControl: React.ReactNode;
}): React.ReactElement {
  const colors = useColors();
  const [filter, setFilter] = useState<Filter>("all");

  // Concerns first, newest first within each group.
  const comments = useMemo(
    () =>
      [...(data?.comments ?? [])]
        .filter((c) => filter === "all" || c.sentiment === filter)
        .sort(
          (a, b) =>
            Number(b.sentiment === "CONCERN") - Number(a.sentiment === "CONCERN") ||
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
    [data, filter],
  );

  const body = (() => {
    if (error) return <Notice message={error} tone="danger" />;
    if (fetching && !data) return <Loader label={STR.loading} />;
    if (!data) return null;
    const t = data.tally;
    return (
      <View style={{ gap: space(3) }}>
        <TileRow>
          <StatTile label={STR.spCommentsConcern} value={bnNum(t.concern)} tone={t.concern > 0 ? "danger" : "ok"} onPress={() => setFilter("CONCERN")} />
          <StatTile label={STR.spCommentsPositive} value={bnNum(t.positive)} tone={t.positive > 0 ? "ok" : "muted"} onPress={() => setFilter("POSITIVE")} />
          {t.undelivered > 0 ? <StatTile label={STR.spCommentsUndelivered} value={bnNum(t.undelivered)} tone="warn" /> : null}
        </TileRow>

        <ChipRow>
          <Chip label={STR.spFilterAll} selected={filter === "all"} onPress={() => setFilter("all")} />
          <Chip label={STR.spCommentsConcern} selected={filter === "CONCERN"} onPress={() => setFilter("CONCERN")} />
          <Chip label={STR.spCommentsPositive} selected={filter === "POSITIVE"} onPress={() => setFilter("POSITIVE")} />
        </ChipRow>

        {comments.length === 0 ? <Muted>{STR.spNoComments}</Muted> : null}
        {comments.map((c) => {
          const concern = c.sentiment === "CONCERN";
          return (
            <Card
              key={c.id}
              style={{
                gap: space(1),
                borderLeftWidth: 4,
                borderLeftColor: concern ? colors.error : colors.success,
                borderRadius: radius.md,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
                <Badge text={concern ? STR.spCommentsConcern : STR.spCommentsPositive} tone={concern ? "danger" : "ok"} />
                <Muted style={{ flex: 1 }}>{commentTypeLabel(c.type)}</Muted>
                <Muted>{isoDateLabel(c.createdAt)}</Muted>
              </View>
              <Body>{c.text}</Body>
              <Muted style={{ fontSize: 12 }}>
                {c.authorName ?? ""}
                {c.deliveredAt ? "" : `${c.authorName ? " · " : ""}${STR.spCommentsUndelivered}`}
              </Muted>
            </Card>
          );
        })}

        {data.meetingNotes.length > 0 ? (
          <Card style={{ gap: space(2) }}>
            <SectionTitle title={STR.spMeetingNotes} />
            {data.meetingNotes.map((m) => (
              <View key={m.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space(2), gap: 2 }}>
                <Muted style={{ fontWeight: "700" }}>
                  {m.instanceLabel} · {isoDateLabel(m.meetingDate)}
                </Muted>
                {m.positiveText ? <Body>+ {m.positiveText}</Body> : null}
                {m.concernText ? <Body>! {m.concernText}</Body> : null}
              </View>
            ))}
          </Card>
        ) : null}
      </View>
    );
  })();

  return (
    <View style={{ gap: space(3) }}>
      {rangeControl}
      {body}
    </View>
  );
}

/**
 * Dashboard tab — the child at a glance: one headline tile per plane (attendance,
 * homework, assignment, class test) over the whole-picture's last 90 days, each
 * opening its tab, and a short "needs attention" list that also links into the
 * right tab. Nothing here is new data — it is the whole picture, the year's
 * attendance and the comment tally, read so that the first screen answers
 * "is this child OK, and where should I look?".
 */
import React from "react";
import { Pressable, View } from "react-native";
import type { WholePictureT } from "../../../graphql/wholePicture";
import type { ProfileAttendanceT, ProfileCommentsT } from "../../../graphql/studentProfile";
import { overallLabel } from "../../../components/WholePictureCard";
import { Badge, Body, Card, Loader, Muted } from "../../../components/ui";
import { STR, bnNum, ctTrendGlyph, hwSubjectLabel } from "../../../lib/labels";
import { space, useColors } from "../../../theme";
import { SectionTitle, StatTile, TileRow, pctText, toneForPct, withN, type Tone } from "./parts";
import type { ProfileTabKey } from "./tabs";

interface Attention {
  key: string;
  text: string;
  tab: ProfileTabKey;
  tone: Tone;
}

const overallTone = (o: string): "ok" | "danger" | "warn" | "muted" =>
  o === "improving" ? "ok" : o === "declining" ? "danger" : o === "steady" ? "warn" : "muted";

/** `YYYY-MM-DD` of the day `n - 1` days before `todayKey` (so n = 30 spans 30 days). */
function keyDaysBefore(todayKey: string, n: number): string {
  const [y, m, d] = todayKey.split("-").map(Number);
  const t = new Date(y, m - 1, d - (n - 1));
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export function attentionItems(
  wp: WholePictureT | null,
  attendance: ProfileAttendanceT | null,
  comments: ProfileCommentsT | null,
  todayKey: string,
): Attention[] {
  const out: Attention[] = [];
  if (attendance) {
    const since = keyDaysBefore(todayKey, 30);
    const n = attendance.days.filter((d) => d.dateKey >= since && d.absent && !d.leaveCovered).length;
    if (n > 0) out.push({ key: "att", text: withN(STR.spAttnAbsent30, n), tab: "attendance", tone: n >= 3 ? "danger" : "warn" });
  }
  if (wp) {
    if (wp.homework.open > 0) {
      out.push({ key: "hw", text: withN(STR.spAttnHwOpen, wp.homework.open), tab: "homework", tone: wp.homework.open >= 3 ? "danger" : "warn" });
    }
    if (wp.assignment.pending > 0) {
      out.push({ key: "asP", text: withN(STR.spAttnAsPending, wp.assignment.pending), tab: "assignment", tone: "warn" });
    }
    if (wp.assignment.late > 0) {
      out.push({ key: "asL", text: withN(STR.spAttnAsLate, wp.assignment.late), tab: "assignment", tone: "warn" });
    }
    const weakest = wp.classTest.weakestSubject ? ` · ${STR.spWeakest}: ${hwSubjectLabel(wp.classTest.weakestSubject)}` : "";
    if (wp.classTest.atRisk) out.push({ key: "ct", text: `${STR.spAttnCtRisk}${weakest}`, tab: "classTest", tone: "danger" });
    else if (wp.classTest.trajectory === "down") out.push({ key: "ct", text: `${STR.spAttnCtFalling}${weakest}`, tab: "classTest", tone: "warn" });
  }
  if (comments && comments.tally.concern > 0) {
    out.push({ key: "cm", text: withN(STR.spAttnConcerns, comments.tally.concern), tab: "complain", tone: "warn" });
  }
  return out;
}

export function DashboardTab({
  wp,
  wpFetching,
  attendance,
  comments,
  todayKey,
  onOpen,
}: {
  wp: WholePictureT | null;
  wpFetching: boolean;
  attendance: ProfileAttendanceT | null;
  comments: ProfileCommentsT | null;
  todayKey: string;
  onOpen: (tab: ProfileTabKey) => void;
}): React.ReactElement {
  const colors = useColors();
  if (wpFetching && !wp) return <Loader label={STR.loading} />;

  const items = attentionItems(wp, attendance, comments, todayKey);
  const att = wp?.attendance;

  return (
    <View style={{ gap: space(3) }}>
      {wp ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
          <Badge text={overallLabel(wp.overall)} tone={overallTone(wp.overall)} />
          <Muted>{STR.spWindow90}</Muted>
        </View>
      ) : null}

      {wp ? (
        <TileRow>
          <StatTile
            label={STR.spPanelAttendance}
            value={pctText(att?.presentPct)}
            sub={
              att?.earlierPresentPct != null && att.recentPresentPct != null
                ? `${pctText(att.earlierPresentPct)} → ${pctText(att.recentPresentPct)}`
                : STR.spPresentPct
            }
            tone={toneForPct(att?.presentPct, 90, 80)}
            onPress={() => onOpen("attendance")}
          />
          <StatTile
            label={STR.spPanelHomework}
            value={pctText(wp.homework.completionPct)}
            sub={`${STR.spSubmissionPct} · ${STR.spColOutstanding} ${bnNum(wp.homework.open)}`}
            tone={toneForPct(wp.homework.completionPct, 85, 65)}
            onPress={() => onOpen("homework")}
          />
          <StatTile
            label={STR.spPanelAssignment}
            value={pctText(wp.assignment.avgMarksPct)}
            sub={`${STR.spAvgMarks} · ${STR.spColOutstanding} ${bnNum(wp.assignment.pending)}`}
            tone={toneForPct(wp.assignment.avgMarksPct, 70, 50)}
            onPress={() => onOpen("assignment")}
          />
          <StatTile
            label={STR.spPanelClassTest}
            value={pctText(wp.classTest.avgPercent)}
            sub={`${STR.ctAvgPercent} · ${ctTrendGlyph(wp.classTest.trajectory)}`}
            tone={wp.classTest.atRisk ? "danger" : toneForPct(wp.classTest.avgPercent, 80, 50)}
            onPress={() => onOpen("classTest")}
          />
        </TileRow>
      ) : null}

      <Card style={{ gap: space(1) }}>
        <SectionTitle title={STR.spNeedsAttention} />
        {items.length === 0 ? <Muted>{STR.spAllGood}</Muted> : null}
        {items.map((it) => (
          <Pressable
            key={it.key}
            accessibilityRole="button"
            onPress={() => onOpen(it.tab)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space(2),
              paddingVertical: space(2),
              borderTopWidth: 1,
              borderTopColor: colors.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: it.tone === "danger" ? colors.error : colors.warning,
              }}
            />
            <Body style={{ flex: 1 }}>{it.text}</Body>
            <Muted>›</Muted>
          </Pressable>
        ))}
      </Card>
    </View>
  );
}

/**
 * The all-rounder card (SB-7, W5, D-#987): the overall 0–100 with its band, a row of petals
 * (one per area, coloured by band — dashed when there is no data), and one row per area with
 * its own score and band. Shown to guardians on আজ and to staff on the student profile.
 * Self-loading; hidden while loading or when nothing at all is known yet.
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "urql";
import { CHILD_ALL_ROUNDER, STUDENT_ALL_ROUNDER, type AllRounderT } from "../graphql/allRounder";
import { Badge, Body, Card, Muted } from "./ui";
import { STR, bnNum } from "../lib/labels";
import { radius, space, typeScale, useColors } from "../theme";

const AREA_LABEL: Record<string, () => string> = {
  ATTENDANCE: () => STR.allrAreaAttendance,
  CLASS_TEST: () => STR.allrAreaClassTest,
  HOMEWORK: () => STR.allrAreaHomework,
  ASSIGNMENT: () => STR.allrAreaAssignment,
  READING: () => STR.allrAreaReading,
  ACTIVITY: () => STR.allrAreaActivity,
};
const BAND: Record<string, { label: () => string; tone: "ok" | "warn" | "danger" | "muted" | "info" }> = {
  STRONG: { label: () => STR.allrBandStrong, tone: "ok" },
  OK: { label: () => STR.allrBandOk, tone: "warn" },
  ATTENTION: { label: () => STR.allrBandAttention, tone: "danger" },
  NONE: { label: () => STR.allrBandNone, tone: "muted" },
  SOON: { label: () => STR.allrBandSoon, tone: "info" },
};

function Body_({ r }: { r: AllRounderT }): React.ReactElement {
  const colors = useColors();
  const [how, setHow] = useState(false);
  const petal = (band: string) =>
    band === "STRONG" ? colors.success : band === "OK" ? colors.warning ?? "#C68A1A" : band === "ATTENTION" ? colors.error : "transparent";
  const b = BAND[r.band] ?? BAND.NONE;
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <Body style={{ fontWeight: "700", flex: 1 }}>{STR.allrTitle}</Body>
        <Muted style={{ fontSize: 12 }}>{STR.allrWindow}</Muted>
      </View>
      {r.score === null ? (
        <Muted style={{ marginTop: space(2) }}>{STR.allrNoData}</Muted>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: space(2), marginTop: space(2) }}>
          <Text style={{ ...typeScale.pageTitle, fontSize: 30, color: colors.textPrimary }}>{bnNum(r.score)}</Text>
          <Muted>/ {bnNum(100)}</Muted>
          <View style={{ flex: 1 }} />
          <Badge text={b.label()} tone={b.tone} />
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 4, marginTop: space(2) }} accessibilityLabel={STR.allrStrongOf.replace("{n}", bnNum(r.countedAreas)).replace("{s}", bnNum(r.strongCount))}>
        {r.areas.map((a) => (
          <View
            key={a.area}
            style={{
              flex: 1,
              height: 8,
              borderRadius: radius.sm,
              backgroundColor: petal(a.band),
              borderWidth: a.score === null ? 1 : 0,
              borderStyle: "dashed",
              borderColor: colors.border,
            }}
          />
        ))}
      </View>
      {r.countedAreas > 0 ? (
        <Body style={{ fontWeight: "600", marginTop: space(2) }}>
          {STR.allrStrongOf.replace("{n}", bnNum(r.countedAreas)).replace("{s}", bnNum(r.strongCount))}
        </Body>
      ) : null}
      <View style={{ marginTop: space(1) }}>
        {r.areas.map((a) => {
          const ab = BAND[a.band] ?? BAND.NONE;
          const value =
            a.area === "READING" && a.value !== null
              ? ` · ${STR.allrReadingValue.replace("{n}", bnNum(a.value))}`
              : a.area === "ACTIVITY" && a.value !== null
              ? ` · ${STR.allrActivityValue.replace("{n}", bnNum(a.value))}`
              : a.score !== null
                ? ` · ${bnNum(a.score)}`
                : "";
          return (
            <View key={a.area} style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingVertical: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: petal(a.band), borderWidth: a.score === null ? 1 : 0, borderStyle: "dashed", borderColor: colors.border }} />
              <Text style={{ ...typeScale.body, color: colors.textPrimary, flex: 1 }}>
                {(AREA_LABEL[a.area] ?? (() => a.area))()}
                {value}
              </Text>
              <Badge text={ab.label()} tone={ab.tone} />
            </View>
          );
        })}
      </View>
      <Pressable onPress={() => setHow((h) => !h)} accessibilityRole="button" style={{ marginTop: space(1) }}>
        <Muted style={{ textDecorationLine: "underline" }}>{STR.allrHow}</Muted>
      </Pressable>
      {how ? <Muted style={{ marginTop: space(1) }}>{STR.allrHowBody}</Muted> : null}
    </Card>
  );
}

/** Guardian: their own child. Staff: pass `staff` to read through the profile gate. */
export function AllRounderCard({ studentId, staff = false }: { studentId: string; staff?: boolean }): React.ReactElement | null {
  const [gq] = useQuery({ query: CHILD_ALL_ROUNDER, variables: { studentId }, pause: staff || !studentId });
  const [sq] = useQuery({ query: STUDENT_ALL_ROUNDER, variables: { studentId }, pause: !staff || !studentId });
  const r = staff ? sq.data?.studentAllRounder : gq.data?.childAllRounder;
  if (!r) return null;
  return <Body_ r={r} />;
}

/**
 * ReturningStudentsCard (RL-1, D-#552/#553) — "ছুটি শেষে ফিরেছে".
 *
 * The two groups are never mixed, because they are different asks:
 *   পুনরায় দিতে হবে — the child never RECEIVED this (ABSENT_REDELIVER)
 *   জমা নিতে হবে   — they have it and have not handed it in (DUE/CHASE)
 *
 * A ফেরার কথা row is the leave register talking, not attendance: the child is
 * DUE back but nobody has marked the day yet. It is labelled as such, because a
 * maybe presented as a fact is how a teacher learns to distrust the screen.
 */
import React from "react";
import { View } from "react-native";
import { Body, Muted, Card, Badge, Divider } from "./ui";
import { space } from "../theme/tokens";
import { STR, bnNum, subjectLabel } from "../lib/labels";
import type { ReturningStudentT } from "../graphql/operations";

export function ReturningStudentsCard({
  rows,
}: {
  rows: ReturningStudentT[];
}): React.ReactElement | null {
  if (rows.length === 0) return null;

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Body style={{ fontWeight: "700" }}>{STR.rlCardTitle}</Body>
        <Badge text={bnNum(rows.length)} tone="info" />
      </View>

      {rows.map((s, i) => {
        const redeliver = s.items.filter((x) => x.group === "REDELIVER");
        const collect = s.items.filter((x) => x.group === "COLLECT");
        return (
          <View key={s.studentId}>
            {i > 0 ? <Divider /> : null}
            <View style={{ marginTop: space(2), gap: space(1) }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: space(2),
                }}
              >
                <Body style={{ fontWeight: "700", flexShrink: 1 }}>{s.studentNameBn}</Body>
                <Badge
                  text={
                    s.source === "RETURNED"
                      ? s.daysAbsent > 0
                        ? `${bnNum(s.daysAbsent)} ${STR.rlDaysAfter}`
                        : STR.rlReturned
                      : STR.rlExpected
                  }
                  tone={s.source === "RETURNED" ? "ok" : "warn"}
                />
              </View>

              {s.source === "EXPECTED" ? <Muted>{STR.rlNotMarked}</Muted> : null}

              {redeliver.length > 0 ? (
                <View style={{ marginTop: space(1) }}>
                  <Muted>{STR.rlRedeliver}</Muted>
                  {redeliver.map((it) => (
                    <Body key={it.recordId}>
                      · {subjectLabel(it.subject)} — {it.workId}
                    </Body>
                  ))}
                </View>
              ) : null}

              {collect.length > 0 ? (
                <View style={{ marginTop: space(1) }}>
                  <Muted>{STR.rlCollect}</Muted>
                  {collect.map((it) => (
                    <Body key={it.recordId}>
                      · {subjectLabel(it.subject)} — {it.workId}
                      {it.chaseCount > 0 ? ` (${bnNum(it.chaseCount)})` : ""}
                    </Body>
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

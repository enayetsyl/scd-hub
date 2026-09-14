/**
 * GiftHandoverCard (AG-3, owner ask 2026-09-14) — the weekly gift on the Office's
 * Today screen: this week's winners grouped class-wise, each with "উপহার দেওয়া হয়েছে"
 * so the desk never leaves Today to do the job.
 *
 * Only for `gift:manage` holders (Principal + Office, D-#667). A teacher keeps the
 * full গিফট রিপোর্ট screen, which is section-scoped — this card is the school-wide
 * desk view and would be refused for them server-side anyway.
 *
 * Classes are COLLAPSED by default with the outstanding count on the heading: thirty
 * winners is a lot of rows to push the rest of Today off the screen, and the desk
 * works one class at a time. A class whose gifts are all handed out still shows —
 * with a ✅ instead of a count — because "done" is information the desk wants; it is
 * the empty classes (no winners at all this week) that `groupWinnersByClass` drops.
 *
 * The grouping rules live in the pure `lib/giftGrouping.ts` and are unit-tested from
 * the server suite; this file is rendering only.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import { Body, Muted, Card, Badge, Button, Divider, Loader } from "./ui";
import { space } from "../theme/tokens";
import { STR, bnNum } from "../lib/labels";
import { useToast } from "../state/ToastContext";
import { friendlyError } from "../lib/errors";
import {
  ASSIGNMENT_GIFT_REPORT,
  RECORD_GIFT_HANDOVER,
  UNDO_GIFT_HANDOVER,
} from "../graphql/assignmentGift";
import { ACADEMIC_YEARS_QUERY } from "../graphql/operations";
import { groupWinnersByClass, giftTotals } from "../lib/giftGrouping";

/** Self-contained: it resolves its own academic year so Today only has to decide
 *  WHETHER to render it, not feed it. */
export function GiftHandoverCard(): React.ReactElement | null {
  const toast = useToast();
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const academicYearId = React.useMemo(() => {
    const years = yearsQ.data?.academicYears ?? [];
    return years.find((y) => y.current)?.id ?? years[0]?.id ?? null;
  }, [yearsQ.data]);
  // null = let the server pick the latest week with issued work; ◀/▶ then pin it.
  const [weekTo, setWeekTo] = React.useState<number | null>(null);
  const [openClassId, setOpenClassId] = React.useState<string | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  const [reportQ, refetchReport] = useQuery({
    query: ASSIGNMENT_GIFT_REPORT,
    variables: {
      academicYearId: academicYearId ?? "",
      weekTo,
      // One week is all the desk needs here; the full report screen keeps the 4-week window.
      weekFrom: weekTo,
      classId: null,
      sectionId: null,
    },
    pause: !academicYearId,
  });

  const [, recordHandover] = useMutation(RECORD_GIFT_HANDOVER);
  const [, undoHandover] = useMutation(UNDO_GIFT_HANDOVER);

  const report = reportQ.data?.assignmentGiftReport ?? null;
  const week = weekTo ?? report?.weekTo ?? 0;
  const weekMeta = report?.weekDueDates.find((w) => w.weekNumber === week) ?? null;

  const groups = React.useMemo(
    () => groupWinnersByClass(report?.students ?? [], week),
    [report, week],
  );
  const totals = React.useMemo(() => giftTotals(groups), [groups]);

  async function onToggle(
    studentId: string,
    kind: "WEEKLY" | "STREAK",
    given: boolean,
  ): Promise<void> {
    const key = `${studentId}:${kind}`;
    setBusyKey(key);
    const vars = { academicYearId: academicYearId ?? "", studentId, kind, weekNumber: week };
    const res = given ? await undoHandover(vars) : await recordHandover(vars);
    setBusyKey(null);
    if (res.error) return toast.show(friendlyError(res.error), "danger");
    toast.show(given ? STR.agUndone : STR.agHandedOver, "ok");
    refetchReport({ requestPolicy: "network-only" });
  }

  if (!academicYearId) return null;
  if (reportQ.fetching && !report) {
    return (
      <Card>
        <Loader label={STR.loading} />
      </Card>
    );
  }
  // Nothing to hand out and nothing won — say so rather than rendering a bare header.
  if (!report) return null;

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Body style={{ fontWeight: "700" }}>{STR.agTodayTitle}</Body>
        <Badge
          text={totals.outstanding > 0 ? bnNum(totals.outstanding) : "✅"}
          tone={totals.outstanding > 0 ? "warn" : "ok"}
        />
      </View>

      {/* Week stepper — the desk often works a week late, so ◀ must be reachable. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: space(2),
        }}
      >
        <Button
          title="◀"
          variant="ghost"
          onPress={() => setWeekTo(Math.max(1, week - 1))}
          disabled={week <= 1}
        />
        <View style={{ alignItems: "center" }}>
          <Body style={{ fontWeight: "600" }}>
            {STR.agWeek} {bnNum(week)}
          </Body>
          {weekMeta?.dueDate ? <Muted>{weekMeta.dueDate}</Muted> : null}
        </View>
        <Button
          title="▶"
          variant="ghost"
          onPress={() => setWeekTo(week + 1)}
          disabled={week >= (report.weekTo ?? week)}
        />
      </View>

      {groups.length === 0 ? (
        <Muted style={{ marginTop: space(2) }}>{STR.agNoWinnersThisWeek}</Muted>
      ) : (
        <>
          <Muted style={{ marginTop: space(2) }}>
            {STR.agWinners}: {bnNum(totals.winners)} · {STR.agOutstanding}:{" "}
            {bnNum(totals.outstanding)}
          </Muted>
          {groups.map((g, i) => {
            const open = openClassId === g.classId;
            return (
              <View key={g.classId}>
                {i > 0 ? <Divider /> : null}
                <Card
                  onPress={() => setOpenClassId(open ? null : g.classId)}
                  style={{ marginTop: space(2) }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: space(2),
                    }}
                  >
                    <Body style={{ fontWeight: "600", flexShrink: 1 }}>
                      {open ? "▾" : "▸"} {g.className} ({bnNum(g.winners.length)})
                    </Body>
                    <Badge
                      text={g.outstanding > 0 ? bnNum(g.outstanding) : "✅"}
                      tone={g.outstanding > 0 ? "warn" : "ok"}
                    />
                  </View>
                </Card>

                {open
                  ? g.winners.map((w) => {
                      const busy = busyKey === `${w.studentId}:WEEKLY`;
                      return (
                        <View
                          key={w.studentId}
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: space(2),
                            marginTop: space(2),
                          }}
                        >
                          <View style={{ flexShrink: 1 }}>
                            <Body>
                              {w.studentName}
                              {w.streakMilestone ? " 🌟" : ""}
                            </Body>
                            {w.rollNumber ? (
                              <Muted>
                                {STR.agRoll} {bnNum(Number(w.rollNumber) || 0)}
                              </Muted>
                            ) : null}
                          </View>
                          {w.given ? (
                            <View style={{ alignItems: "flex-end" }}>
                              <Badge text={`✅ ${STR.agHandedOver}`} tone="ok" maxWidthPct={100} />
                              <Button
                                title={STR.agUndoHandover}
                                variant="ghost"
                                onPress={() => onToggle(w.studentId, "WEEKLY", true)}
                                disabled={busy}
                              />
                            </View>
                          ) : (
                            <Button
                              title={STR.agMarkHandedOver}
                              onPress={() => onToggle(w.studentId, "WEEKLY", false)}
                              loading={busy}
                            />
                          )}
                        </View>
                      );
                    })
                  : null}
              </View>
            );
          })}
        </>
      )}
    </Card>
  );
}

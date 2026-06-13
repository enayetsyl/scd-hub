/**
 * GuardianHomeScreen ("আজ", GP-2) — the selected child's today: routine
 * (day-type aware — a holiday shows its label), class notes, open homework with
 * state chips, and the personal day-load vs the LOCKED 240. Plus the inert
 * "শীঘ্রই আসছে" placeholder cards (GP-3+ riders) — tap shows a one-line notice,
 * no navigation, no dead queries (GP-J11).
 */
import React, { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import {
  CHILD_ROUTINE_QUERY,
  CHILD_CLASS_NOTES_QUERY,
  CHILD_HOMEWORK_QUERY,
  CHILD_DAY_LOAD_QUERY,
  CHILD_LIBRARY_LOANS_QUERY,
} from "../../graphql/operations";
import { Screen, Body, Muted, Card, Badge, Button, Notice, Loader, EmptyState } from "../../components/ui";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { useGuardianChild } from "../../state/GuardianChildContext";
import type { GuardianHomeStackParamList } from "../../navigation/types";
import { STR, bnNum, loanStatusLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";

type Nav = NativeStackNavigationProp<GuardianHomeStackParamList>;

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const today = (): string => isoDay(new Date());
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
};

/** Lifecycle states that still need the family's attention (not RETURNED). */
const OPEN_STATES = new Set(["GIVEN", "ABSENT_REDELIVER", "DUE", "SUBMITTED", "CHASE", "CHECKED", "RESUBMIT"]);

export default function GuardianHomeScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { selected, fetching } = useGuardianChild();
  const [placeholderNote, setPlaceholderNote] = useState<string | null>(null);
  const sid = selected?.studentId ?? "";
  const date = today();

  const [routineQ] = useQuery({
    query: CHILD_ROUTINE_QUERY,
    variables: { studentId: sid, date },
    pause: !selected,
  });
  const [notesQ] = useQuery({
    query: CHILD_CLASS_NOTES_QUERY,
    variables: { studentId: sid, date },
    pause: !selected,
  });
  const [hwQ] = useQuery({
    query: CHILD_HOMEWORK_QUERY,
    variables: { studentId: sid, from: daysAgo(7), to: date },
    pause: !selected,
  });
  const [loadQ] = useQuery({
    query: CHILD_DAY_LOAD_QUERY,
    variables: { studentId: sid, date },
    pause: !selected,
  });
  const [libraryQ] = useQuery({
    query: CHILD_LIBRARY_LOANS_QUERY,
    variables: { studentId: sid },
    pause: !selected,
  });

  if (fetching && !selected) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }
  if (!selected) {
    return (
      <Screen>
        <EmptyState message={STR.gpNoChildren} />
      </Screen>
    );
  }

  const day = routineQ.data?.childRoutine;
  const notes = notesQ.data?.childClassNotes ?? [];
  const openHomework = (hwQ.data?.childHomework ?? []).filter(
    (r) => OPEN_STATES.has(r.state) || r.dateGiven.slice(0, 10) === date,
  );
  const load = loadQ.data?.childDayLoad;

  const placeholders = [STR.gpAttendance, STR.gpFees, STR.gpNotices, STR.gpLeave, STR.gpPush];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <ChildSwitcher />

        {/* Child info — section + Quran/Arabic group memberships (myChildren,
            already loaded by the provider; cross-grade groups per D-#48/#56). */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.gpChildInfo}</Body>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(2) }}>
            <Muted>{STR.gpSection}</Muted>
            <Body>{selected.sectionName}</Body>
          </View>
          {selected.quranGroup ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(1) }}>
              <Muted>{STR.gpQuranGroup}</Muted>
              <Body>{selected.quranGroup.name}</Body>
            </View>
          ) : null}
          {selected.arabicGroup ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(1) }}>
              <Muted>{STR.gpArabicGroup}</Muted>
              <Body>{selected.arabicGroup.name}</Body>
            </View>
          ) : null}
        </Card>

        {/* Today's routine (subject + period + time ONLY, D-#69) */}
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700" }}>{STR.gpToday}</Body>
            {day ? (
              <Badge
                text={day.dayType === "HOLIDAY" && day.holidayNameBn ? day.holidayNameBn : day.dayTypeLabelBn}
                tone={day.dayType === "FULL" ? "brand" : "warn"}
              />
            ) : null}
          </View>
          {routineQ.fetching ? (
            <Loader label={STR.loading} />
          ) : !day || day.slots.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{day?.dayTypeLabelBn ?? ""}</Muted>
          ) : (
            day.slots.map((s) => (
              <View
                key={`${s.periodNumber}-${s.subject}`}
                style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(2) }}
              >
                <Body>
                  {bnNum(s.periodNumber)}. {s.subjectLabelBn}
                </Body>
                <Muted>{s.startHHMM && s.endHHMM ? `${s.startHHMM}–${s.endHHMM}` : ""}</Muted>
              </View>
            ))
          )}
        </Card>

        {/* Class notes — what was taught today */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.gpClassNotes}</Body>
          {notesQ.fetching ? (
            <Loader label={STR.loading} />
          ) : notes.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.gpNoNotes}</Muted>
          ) : (
            notes.map((n, i) => (
              <View key={`${n.subject}-${n.periodNumber ?? i}`} style={{ marginTop: space(2) }}>
                <Body style={{ fontWeight: "700" }}>{n.subjectLabelBn}</Body>
                <Body>{n.taughtSummaryBn}</Body>
                {n.homework ? (
                  <Muted>
                    {STR.gpHomeworkOpen}: {n.homework.hwId} · {bnNum(n.homework.qCount)} ·{" "}
                    {bnNum(n.homework.timeDecl)} {STR.gpMinutes}
                  </Muted>
                ) : null}
              </View>
            ))
          )}
          <View style={{ marginTop: space(2) }}>
            <Button
              title={STR.gpPastLessons}
              variant="ghost"
              onPress={() => nav.navigate("ChildClassNotes")}
            />
          </View>
        </Card>

        {/* Open homework + day-load vs 240 */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.gpHomeworkOpen}</Body>
          {load ? (
            <Muted style={{ marginTop: space(1) }}>
              {STR.gpDayLoad}: {bnNum(load.totalMinutes)}/{bnNum(load.ceiling)} {STR.gpMinutes}
              {load.topupMinutes > 0
                ? ` (${STR.gpDayLoadBase} ${bnNum(load.baseMinutes)} + ${STR.gpDayLoadTopup} ${bnNum(
                    load.topupMinutes,
                  )})`
                : ""}
            </Muted>
          ) : null}
          {load?.overCeiling ? (
            <Notice
              message={`${STR.gpDayLoad}: ${bnNum(load.totalMinutes)}/${bnNum(load.ceiling)} ${STR.gpMinutes}`}
              tone="warn"
            />
          ) : null}
          {hwQ.fetching ? (
            <Loader label={STR.loading} />
          ) : openHomework.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.gpNoHomework}</Muted>
          ) : (
            openHomework.map((r) => (
              <View
                key={r.recordId}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: space(2),
                }}
              >
                <View style={{ flexShrink: 1 }}>
                  <Body>{r.subjectLabelBn}</Body>
                  <Muted>{r.hwId}</Muted>
                </View>
                <Badge text={r.stateLabelBn} tone={r.state === "CHASE" ? "danger" : "brand"} />
              </View>
            ))
          )}
        </Card>

        {/* Library loans — read-only child-loans card (LB-5 rider, J-L9; D-#68:
            no reserve/renew control exists for guardians) */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.gpLibraryLoans}</Body>
          {libraryQ.fetching ? (
            <Loader label={STR.loading} />
          ) : (libraryQ.data?.childLibraryLoans ?? []).length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.gpNoLibraryLoans}</Muted>
          ) : (
            (libraryQ.data?.childLibraryLoans ?? []).map((loan) => (
              <View
                key={loan.id}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: space(2),
                }}
              >
                <View style={{ flexShrink: 1 }}>
                  <Body>{loan.titleBn ?? loan.accessionNo ?? "—"}</Body>
                  <Muted>
                    {loan.status === "ACTIVE"
                      ? `${STR.libDue}: ${new Date(loan.dueDate).toLocaleDateString()}`
                      : loan.returnedAt
                        ? `${loanStatusLabel(loan.status)}: ${new Date(loan.returnedAt).toLocaleDateString()}`
                        : loanStatusLabel(loan.status)}
                  </Muted>
                </View>
                {loan.overdue ? (
                  <Badge text={STR.libOverdue} tone="danger" />
                ) : loan.status === "ACTIVE" ? (
                  <Badge text={loanStatusLabel(loan.status)} tone="brand" />
                ) : (
                  <Badge text={loanStatusLabel(loan.status)} tone="muted" />
                )}
              </View>
            ))
          )}
        </Card>

        {/* GP-3+ placeholders — inert by contract (GP-J11) */}
        {placeholderNote ? <Notice message={placeholderNote} tone="info" /> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
          {placeholders.map((label) => (
            <Pressable
              key={label}
              onPress={() => setPlaceholderNote(`${label} — ${STR.gpComingSoonNote}`)}
              style={{ flexGrow: 1, minWidth: 140 }}
            >
              <Card>
                <Body style={{ fontWeight: "700" }}>{label}</Body>
                <Muted>{STR.gpComingSoon}</Muted>
              </Card>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

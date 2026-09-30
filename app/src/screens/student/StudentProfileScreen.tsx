/**
 * StudentProfileScreen (SP-3, prd-student-profile §8) — ONE student, everything the
 * app records about them, as an identity card beside seven tabs (owner redesign
 * 2026-09-30): Dashboard · Profile · Attendance · Class test · Homework · Assignment ·
 * Complaints. On a phone the card stacks above a sideways-scrolling tab bar.
 *
 * READ-ONLY by design (§1): no marking, no lifecycle transition, no comment authoring
 * happens here — each of those stays on the screen that owns its write gate.
 *
 * LAZY BY TAB: every tab has its own query, paused until the tab is opened, so a
 * teacher who only wants attendance pays for one read. Attendance always reads the
 * academic year to date (the calendar moves month by month locally, and the second
 * pie is the year); homework / assignment / complaints follow the range chips.
 *
 * NARROWING (§4/D-#357): a subject teacher sees only their own subjects on the
 * homework / assignment / class-test tabs; the screen says so explicitly, because a
 * partial panel that looks complete is worse than no panel.
 */
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRoute } from "@react-navigation/native";
import { useQuery } from "urql";
import {
  STUDENT_PROFILE_ASSIGNMENT_QUERY,
  STUDENT_PROFILE_ATTENDANCE_QUERY,
  STUDENT_PROFILE_CLASS_TEST_QUERY,
  STUDENT_PROFILE_COMMENTS_QUERY,
  STUDENT_PROFILE_HEADER_QUERY,
  STUDENT_PROFILE_HOMEWORK_QUERY,
} from "../../graphql/studentProfile";
import { STUDENT_WHOLE_PICTURE_QUERY } from "../../graphql/wholePicture";
import { Screen, Card, Loader, Notice, Chip, ChipRow, Button, EmptyState } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR } from "../../lib/labels";
import { dateKey } from "../../lib/dates";
import { friendlyError } from "../../lib/errors";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import { useFileOpen } from "../../lib/useFileOpen";
import { space } from "../../theme/tokens";
import { useColors } from "../../theme";
import type { StudentProfileParams } from "../../navigation/types";
import { PROFILE_TABS, tabForPanel, tabLabel, type ProfileTabKey } from "./profile/tabs";
import { IdentityCard, ProfileTab } from "./profile/ProfileTab";
import { DashboardTab } from "./profile/DashboardTab";
import { AttendanceTab } from "./profile/AttendanceTab";
import { TrackerTab } from "./profile/TrackerTab";
import { ClassTestTab } from "./profile/ClassTestTab";
import { ComplainTab } from "./profile/ComplainTab";

const keyDaysAgo = (days: number): string => {
  const now = new Date();
  return dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)));
};

/** At this content width the identity card sits beside the tabs instead of above them. */
const SIDE_BY_SIDE_MIN = 980;

export default function StudentProfileScreen(): React.ReactElement {
  // Registered in several stacks (roster / attendance / homework / assignment /
  // class test), so params are read via useRoute rather than tied to one ParamList.
  //
  // Params are read DEFENSIVELY (`?? {}`), never destructured off `params` directly.
  // A profile with no studentId must degrade to an empty state, not throw: this
  // screen is reachable by five routes plus deep links and navigation-state
  // restoration, and a destructure of `undefined` takes the whole tab down with the
  // error boundary. That is exactly what happened when it was accidentally
  // registered as a stack's FIRST screen (= its initial route, so it mounted with
  // no params) — see the fix alongside this guard.
  const params = (useRoute().params ?? {}) as Partial<StudentProfileParams>;
  const studentId = params.studentId ?? "";
  const studentName = params.studentName;
  const colors = useColors();
  const [tab, setTab] = useState<ProfileTabKey>(tabForPanel(params.initialPanel));
  const [width, setWidth] = useState(0);
  const { openingId, runOpen } = useFileOpen();
  const [pdfError, setPdfError] = useState<string | null>(null);
  const todayKey = dateKey();

  const [headerQ] = useQuery({
    query: STUDENT_PROFILE_HEADER_QUERY,
    variables: { studentId },
    pause: !studentId,
  });
  const header = headerQ.data?.studentProfileHeader ?? null;

  // The range chips (homework / assignment / complaints) default to the academic year
  // to date (D-#358); the header supplies it. A local control rather than
  // useReportRange: that hook's chips are Today/7/14/30, a daily-operations range —
  // a profile is a term document.
  const year = header?.academicYear ?? null;
  const [mode, setMode] = useState<"year" | "d30" | "d90" | "custom">("year");
  const [customFrom, setCustomFrom] = useState(keyDaysAgo(30));
  const [customTo, setCustomTo] = useState(dateKey());
  const fromKey =
    mode === "custom" ? customFrom
    : mode === "d30" ? keyDaysAgo(30)
    : mode === "d90" ? keyDaysAgo(90)
    : (year?.fromKey ?? keyDaysAgo(90));
  const toKey = mode === "custom" ? customTo : (mode === "year" ? (year?.toKey ?? dateKey()) : dateKey());
  const rangeVars = { studentId, fromKey, toKey };
  // The fixed year-to-date window: attendance's calendar + year pie, and the
  // dashboard's concern count.
  const yearVars = { studentId, fromKey: year?.fromKey ?? keyDaysAgo(180), toKey: year?.toKey ?? todayKey };

  // Each tab waits until it is opened — and until the header has supplied the
  // year, so the default window never fires a throwaway request with fallback bounds.
  const headerReady = !!studentId && !!headerQ.data;
  const rangeReady = !!studentId && (mode !== "year" || headerReady);
  const onTab = (...keys: ProfileTabKey[]) => keys.includes(tab);

  const [wpQ] = useQuery({
    query: STUDENT_WHOLE_PICTURE_QUERY,
    variables: { studentId },
    pause: !studentId || !onTab("dashboard"),
  });
  const [attQ] = useQuery({
    query: STUDENT_PROFILE_ATTENDANCE_QUERY,
    variables: yearVars,
    pause: !headerReady || !onTab("attendance", "dashboard"),
  });
  const [cmYearQ] = useQuery({
    query: STUDENT_PROFILE_COMMENTS_QUERY,
    variables: yearVars,
    pause: !headerReady || !onTab("dashboard"),
  });
  const [hwQ] = useQuery({
    query: STUDENT_PROFILE_HOMEWORK_QUERY,
    variables: rangeVars,
    pause: !rangeReady || !onTab("homework"),
  });
  const [asQ] = useQuery({
    query: STUDENT_PROFILE_ASSIGNMENT_QUERY,
    variables: rangeVars,
    pause: !rangeReady || !onTab("assignment"),
  });
  const [ctQ] = useQuery({
    query: STUDENT_PROFILE_CLASS_TEST_QUERY,
    variables: { studentId },
    pause: !studentId || !onTab("classTest"),
  });
  const [cmQ] = useQuery({
    query: STUDENT_PROFILE_COMMENTS_QUERY,
    variables: rangeVars,
    pause: !rangeReady || !onTab("complain"),
  });

  const narrowed = header ? !header.fullView : false;

  // AFTER every hook, so hook order never varies between renders (rules of hooks).
  if (!studentId) {
    return (
      <Screen>
        <EmptyState message={STR.spNoStudent} />
      </Screen>
    );
  }

  const rangeControl = (
    <Card>
      <ChipRow>
        <Chip
          label={year ? `${STR.spYearToDate} (${year.label})` : STR.spYearToDate}
          selected={mode === "year"}
          onPress={() => setMode("year")}
        />
        <Chip label={STR.spLast30} selected={mode === "d30"} onPress={() => setMode("d30")} />
        <Chip label={STR.spLast90} selected={mode === "d90"} onPress={() => setMode("d90")} />
        <Chip label={STR.spCustom} selected={mode === "custom"} onPress={() => setMode("custom")} />
      </ChipRow>
      {mode === "custom" ? (
        <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
          <View style={{ flex: 1 }}>
            <DateField label={STR.rptFrom} value={customFrom} onChange={setCustomFrom} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label={STR.rptTo} value={customTo} onChange={setCustomTo} />
          </View>
        </View>
      ) : null}
    </Card>
  );

  // SP-4: the parent-meeting sheet. Web-only like every other PDF path
  // (PDF_SUPPORTED); the server re-asserts the gate and prints the caller's
  // narrowing + a printed-by stamp on the page.
  const printButton = PDF_SUPPORTED ? (
    <View style={{ gap: space(2) }}>
      <Button
        title={STR.spPrintSheet}
        variant="secondary"
        loading={openingId === studentId}
        disabled={!!openingId}
        onPress={() =>
          void runOpen(studentId, async () => {
            setPdfError(null);
            try {
              await openPdf(`/pdf/student-profile/${studentId}?from=${fromKey}&to=${toKey}`);
            } catch (e) {
              setPdfError(e instanceof Error ? e.message : STR.spPrintFailed);
            }
          })
        }
      />
      {pdfError ? <Notice message={pdfError} tone="danger" /> : null}
    </View>
  ) : null;

  const card = headerQ.error ? (
    <Notice message={friendlyError(headerQ.error)} tone="danger" />
  ) : headerQ.fetching && !header ? (
    <Loader label={STR.loading} />
  ) : (
    <IdentityCard header={header} fallbackName={studentName} narrowed={narrowed} footer={printButton} />
  );

  const tabBar = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {PROFILE_TABS.map((k) => {
          const active = k === tab;
          return (
            <Pressable
              key={k}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(k)}
              style={{
                paddingVertical: space(3),
                paddingHorizontal: space(3),
                borderBottomWidth: 3,
                borderBottomColor: active ? colors.primary : "transparent",
                marginBottom: -1,
              }}
            >
              <Text
                style={{
                  color: active ? colors.primary : colors.textSecondary,
                  fontWeight: active ? "800" : "600",
                  fontSize: 15,
                }}
              >
                {tabLabel(k)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );

  const err = (e: typeof hwQ.error) => (e ? friendlyError(e) : null);
  const content = (() => {
    switch (tab) {
      case "dashboard":
        return (
          <DashboardTab
            wp={wpQ.data?.studentWholePicture ?? null}
            wpFetching={wpQ.fetching}
            attendance={attQ.data?.studentProfileAttendance ?? null}
            comments={cmYearQ.data?.studentProfileComments ?? null}
            todayKey={todayKey}
            onOpen={setTab}
          />
        );
      case "profile":
        return header ? <ProfileTab header={header} /> : <Loader label={STR.loading} />;
      case "attendance":
        return (
          <AttendanceTab
            attendance={attQ.data?.studentProfileAttendance ?? null}
            fetching={attQ.fetching || !headerReady}
            error={err(attQ.error)}
            todayKey={todayKey}
          />
        );
      case "classTest":
        return (
          <ClassTestTab
            profile={ctQ.data?.studentProfileClassTest ?? null}
            fetching={ctQ.fetching}
            error={err(ctQ.error)}
            narrowed={narrowed}
          />
        );
      case "homework":
        return (
          <TrackerTab
            kind="homework"
            panel={hwQ.data?.studentProfileHomework ?? null}
            fetching={hwQ.fetching || !rangeReady}
            error={err(hwQ.error)}
            narrowed={narrowed}
            rangeControl={rangeControl}
          />
        );
      case "assignment":
        return (
          <TrackerTab
            kind="assignment"
            panel={asQ.data?.studentProfileAssignment ?? null}
            fetching={asQ.fetching || !rangeReady}
            error={err(asQ.error)}
            narrowed={narrowed}
            rangeControl={rangeControl}
          />
        );
      case "complain":
        return (
          <ComplainTab
            data={cmQ.data?.studentProfileComments ?? null}
            fetching={cmQ.fetching || !rangeReady}
            error={err(cmQ.error)}
            rangeControl={rangeControl}
          />
        );
    }
  })();

  const sideBySide = width >= SIDE_BY_SIDE_MIN;

  return (
    <Screen scroll wide>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ flexDirection: sideBySide ? "row" : "column", gap: space(4), alignItems: "flex-start" }}
      >
        <View style={{ width: sideBySide ? 300 : "100%" }}>{card}</View>
        <View style={{ flex: sideBySide ? 1 : undefined, width: sideBySide ? undefined : "100%", gap: space(3) }}>
          {tabBar}
          {content}
        </View>
      </View>
    </Screen>
  );
}

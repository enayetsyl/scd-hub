/**
 * AttendanceRankingScreen (AR-2 — docs/prd-attendance-ranking.md).
 *
 * Ranks students or staff by attendance over week / month / cumulative / annual,
 * on one axis at a time. Reads the two EXISTING registers — nothing here captures
 * attendance.
 *
 * The one thing this screen must never hide: **held days**. The metric is present %
 * of the days the unit actually marked, so a 100% off four days and a 98% off sixty
 * are not the same claim. Held days sit on every row, and a row under the server's
 * floor is badged and sorted last rather than quietly dropped.
 *
 * Gated `attendance:manage` (Principal + Office) — the server re-enforces.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import {
  STUDENT_ATTENDANCE_RANKING_QUERY,
  STAFF_ATTENDANCE_RANKING_QUERY,
  SUBJECT_GROUP_BREAKDOWN_QUERY,
  type RankRowT,
  type GroupRankBlockT,
} from "../../graphql/attendanceRanking";
import { CLASSES_QUERY, SUBJECT_GROUPS_QUERY } from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import {
  Screen, H2, Body, Muted, Card, Chip, ChipRow, Badge, Select, Notice, Divider, EmptyState, Loader, ErrorBanner,
} from "../../components/ui";
import { DateField } from "../../components/DateField";
import { AcademicYearSelect } from "../../components/selects";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

/** Local day-key, matching AttendanceReportScreen (the register's own dateKey shape). */
const todayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type Props = NativeStackScreenProps<AdminStackParamList, "AttendanceRanking">;

type Subject = "students" | "staff";
type Window = "week" | "month" | "cumulative" | "annual";
/** UI axis → the server's (axis, axisValue) pair. */
type Axis = "school" | "class" | "section" | "quran" | "arabic" | "group" | "breakdown";
/** Which track the per-group breakdown covers. */
type Track = "quran" | "arabic";
/** Row ORDER only — the server never renumbers ranks for it (D-#512). */
type Sort = "rank" | "class";

const PAGE = 40;
/** Rows shown per group card before the reader expands it. */
const GROUP_PREVIEW = 5;

/** One number in the breakdown's summary strip. */
function Stat({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <View style={{ minWidth: 96 }}>
      <Body style={{ fontWeight: "700", fontSize: 20 }}>{value}</Body>
      <Muted>{label}</Muted>
    </View>
  );
}

/**
 * One group's card in the per-group breakdown.
 *
 * `heldDays` sits in the CARD HEADER, not on each row, because in this view it is the
 * group's property and every row shares it — and the whole reason the groups are shown
 * side by side rather than pooled is that these denominators differ.
 *
 * The class badge is unconditional here: the group name is the unit label, so unlike the
 * flat list there is never a class already on the row to duplicate.
 */
function GroupCard({
  block,
  open,
  onToggle,
}: {
  block: GroupRankBlockT;
  open: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const shown = open ? block.rows : block.rows.slice(0, GROUP_PREVIEW);
  return (
    <Card>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: space(2),
        }}
      >
        <View style={{ flex: 1 }}>
          <Body style={{ fontWeight: "700" }}>{block.nameBn}</Body>
          <Muted>
            {block.level} · {block.gender} · {block.memberCount} {STR.arGroupEnrolled}
          </Muted>
        </View>
        <View style={{ alignItems: "flex-end", flexShrink: 0 }}>
          <Body style={{ fontWeight: "700", fontSize: 18 }}>{block.heldDays}</Body>
          <Muted>{STR.arHeld}</Muted>
        </View>
      </View>

      {block.rows.length === 0 ? (
        <Muted style={{ marginTop: space(2) }}>{STR.arGroupNoDays}</Muted>
      ) : (
        <View style={{ marginTop: space(2), gap: space(1) }}>
          {shown.map((r) => (
            <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
              <Body style={{ fontWeight: "700", minWidth: 28 }}>{r.rank}</Body>
              <View style={{ flex: 1 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space(1),
                    flexWrap: "wrap",
                  }}
                >
                  <Body>{r.name}</Body>
                  {r.classLabel ? <Badge text={r.classLabel} tone="muted" /> : null}
                  {r.belowFloor ? <Badge text={STR.arThin} tone="warn" /> : null}
                </View>
                <Muted>
                  {STR.arAbsent}: {r.absentDays}
                </Muted>
              </View>
              <Body style={{ fontWeight: "700", flexShrink: 0 }}>{r.presentPct}%</Body>
            </View>
          ))}
          {block.rows.length > GROUP_PREVIEW ? (
            <Chip
              label={
                open
                  ? STR.arShowTop
                  : STR.arShowAllInGroup.replace("{n}", String(block.rows.length))
              }
              selected={false}
              onPress={onToggle}
            />
          ) : null}
        </View>
      )}
    </Card>
  );
}

export default function AttendanceRankingScreen(_props: Props): React.ReactElement {
  const [subject, setSubject] = useState<Subject>("students");
  const [window, setWindow] = useState<Window>("month");
  const [anchorKey, setAnchorKey] = useState(todayKey());
  const [axis, setAxis] = useState<Axis>("school");
  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [sortBy, setSortBy] = useState<Sort>("rank");
  const [track, setTrack] = useState<Track>("quran");
  /** Group ids the reader has expanded past the top-5 preview. */
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [shown, setShown] = useState(PAGE);

  const [{ data: classData }] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: yearId },
    pause: yearId === "",
  });
  const classes = classData?.classes ?? [];
  const classOptions = classes.map((c) => ({ label: c.nameBn, value: c.id }));
  const sectionOptions = (classes.find((c) => c.id === classId)?.sections ?? []).map((s) => ({
    label: s.nameBn ?? s.code,
    value: s.id,
  }));

  const [{ data: groupData }] = useQuery({ query: SUBJECT_GROUPS_QUERY, variables: { track: null } });
  const groupOptions = (groupData?.subjectGroups ?? [])
    .filter((g) => g.active)
    .map((g) => ({ label: g.nameBn, value: g.id }));

  // Map the UI axis onto the server's (axis, axisValue).
  const serverAxis =
    axis === "quran" || axis === "arabic" ? "track" : axis === "group" ? "group" : axis;
  const axisValue =
    axis === "quran" ? "quran"
    : axis === "arabic" ? "arabic"
    : axis === "class" ? classId
    : axis === "section" ? sectionId
    : axis === "group" ? groupId
    : null;

  /** An axis that needs a target is not queryable until one is picked. The breakdown
   *  needs none — it covers every group of the track by definition. */
  const needsTarget = axis === "class" || axis === "section" || axis === "group";
  const ready = subject === "staff" || axis === "breakdown" || !needsTarget || !!axisValue;
  const isBreakdown = subject === "students" && axis === "breakdown";

  const [studentQ] = useQuery({
    query: STUDENT_ATTENDANCE_RANKING_QUERY,
    variables: { window, anchorKey, axis: serverAxis, axisValue, sortBy },
    pause: subject !== "students" || !ready,
  });
  const [breakdownQ] = useQuery({
    query: SUBJECT_GROUP_BREAKDOWN_QUERY,
    variables: { window, anchorKey, track, sortBy },
    pause: subject !== "students" || axis !== "breakdown",
  });
  const [staffQ] = useQuery({
    query: STAFF_ATTENDANCE_RANKING_QUERY,
    variables: { window, anchorKey },
    pause: subject !== "staff",
  });

  const q = isBreakdown ? breakdownQ : subject === "students" ? studentQ : staffQ;
  const breakdown = breakdownQ.data?.subjectGroupAttendanceBreakdown;
  const result =
    subject === "students" ? studentQ.data?.studentAttendanceRanking : staffQ.data?.staffAttendanceRanking;
  const rows: RankRowT[] = result?.rows ?? [];

  function pickAxis(a: Axis): void {
    setAxis(a);
    setShown(PAGE);
    setOpenGroups([]);
  }

  function toggleGroup(id: string): void {
    setOpenGroups((open) => (open.includes(id) ? open.filter((g) => g !== id) : [...open, id]));
  }

  const windowChips: { key: Window; label: string }[] = [
    { key: "week", label: STR.arWeek },
    { key: "month", label: STR.arMonth },
    { key: "cumulative", label: STR.arCumulative },
    { key: "annual", label: STR.arAnnual },
  ];

  const sortChips: { key: Sort; label: string }[] = [
    { key: "rank", label: STR.arSortRank },
    { key: "class", label: STR.arSortClass },
  ];

  const axisChips: { key: Axis; label: string }[] = [
    { key: "school", label: STR.arAxisSchool },
    { key: "class", label: STR.arAxisClass },
    { key: "section", label: STR.arAxisSection },
    { key: "quran", label: STR.arAxisQuran },
    { key: "arabic", label: STR.arAxisArabic },
    { key: "group", label: STR.arAxisGroup },
    { key: "breakdown", label: STR.arAxisBreakdown },
  ];

  return (
    <Screen scroll>
      <H2>{STR.arTitle}</H2>
      <Muted style={{ marginBottom: space(2) }}>{STR.arHint}</Muted>

      <Card>
        <ChipRow>
          <Chip label={STR.arStudents} selected={subject === "students"} onPress={() => setSubject("students")} />
          <Chip label={STR.arStaff} selected={subject === "staff"} onPress={() => setSubject("staff")} />
        </ChipRow>

        <Muted style={{ marginTop: space(2) }}>{STR.arWindow}</Muted>
        <ChipRow>
          {windowChips.map((w) => (
            <Chip key={w.key} label={w.label} selected={window === w.key} onPress={() => setWindow(w.key)} />
          ))}
        </ChipRow>

        <DateField label={STR.arAnchor} value={anchorKey} onChange={setAnchorKey} />

        {subject === "students" ? (
          <View>
            <Muted style={{ marginTop: space(2) }}>{STR.arAxis}</Muted>
            <ChipRow>
              {axisChips.map((a) => (
                <Chip key={a.key} label={a.label} selected={axis === a.key} onPress={() => pickAxis(a.key)} />
              ))}
            </ChipRow>

            <Muted style={{ marginTop: space(2) }}>{STR.arSort}</Muted>
            <ChipRow>
              {sortChips.map((so) => (
                <Chip
                  key={so.key}
                  label={so.label}
                  selected={sortBy === so.key}
                  onPress={() => {
                    setSortBy(so.key);
                    setShown(PAGE);
                  }}
                />
              ))}
            </ChipRow>

            {axis === "breakdown" ? (
              <View>
                <Muted style={{ marginTop: space(2) }}>{STR.arTrack}</Muted>
                <ChipRow>
                  <Chip
                    label={STR.arAxisQuran}
                    selected={track === "quran"}
                    onPress={() => {
                      setTrack("quran");
                      setOpenGroups([]);
                    }}
                  />
                  <Chip
                    label={STR.arAxisArabic}
                    selected={track === "arabic"}
                    onPress={() => {
                      setTrack("arabic");
                      setOpenGroups([]);
                    }}
                  />
                </ChipRow>
              </View>
            ) : null}

            {axis === "class" || axis === "section" ? (
              <AcademicYearSelect
                label={STR.academicYear}
                value={yearId}
                onChange={(v) => {
                  setYearId(v);
                  setClassId("");
                  setSectionId("");
                }}
              />
            ) : null}

            {axis === "class" || axis === "section" ? (
              <Select
                label={STR.class}
                value={classId === "" ? null : classId}
                options={classOptions}
                onChange={(v) => {
                  setClassId(v);
                  setSectionId("");
                }}
                placeholder={STR.selectClass}
              />
            ) : null}

            {axis === "section" ? (
              <Select
                label={STR.section}
                value={sectionId === "" ? null : sectionId}
                options={sectionOptions}
                onChange={setSectionId}
                placeholder={STR.pickSection}
              />
            ) : null}

            {axis === "group" ? (
              <Select
                label={STR.arGroup}
                value={groupId === "" ? null : groupId}
                options={groupOptions}
                onChange={setGroupId}
                placeholder={STR.arPickGroup}
              />
            ) : null}
          </View>
        ) : null}
      </Card>

      <Divider />

      {!ready ? (
        <Notice message={STR.arPickTarget} tone="info" />
      ) : q.fetching && !result && !breakdown ? (
        <Loader label={STR.loading} />
      ) : q.error ? (
        <ErrorBanner message={friendlyError(q.error)} />
      ) : isBreakdown ? (
        !breakdown || breakdown.groups.length === 0 ? (
          <EmptyState
            message={
              breakdown?.lastMarkedKey
                ? `${STR.arNoData} ${STR.arLastMarked.replace("{d}", breakdown.lastMarkedKey)}`
                : STR.arNoData
            }
          />
        ) : (
          <View>
            <Muted style={{ marginBottom: space(1) }}>
              {breakdown.fromKey} → {breakdown.toKey}
            </Muted>

            <Card>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3) }}>
                <Stat label={STR.arGroupsMeasured} value={breakdown.groupsMeasured} />
                <Stat label={STR.arStudentsRanked} value={breakdown.studentsRanked} />
                <Stat label={STR.arMaxHeld} value={breakdown.maxHeldDays} />
                <Stat label={STR.arPerfect} value={breakdown.perfectCount} />
              </View>
            </Card>

            <Muted style={{ marginBottom: space(1) }}>
              {STR.arFloorNote.replace("{n}", String(breakdown.minHeldDays))}
            </Muted>
            {sortBy === "class" ? (
              <Muted style={{ marginBottom: space(2) }}>{STR.arSortClassNote}</Muted>
            ) : null}

            {breakdown.groups.map((g) => (
              <GroupCard
                key={g.groupId}
                block={g}
                open={openGroups.includes(g.groupId)}
                onToggle={() => toggleGroup(g.groupId)}
              />
            ))}
          </View>
        )
      ) : !result || rows.length === 0 ? (
        // An empty ranking is ambiguous on its own, and the usual cause is a window
        // ahead of the data (asking for "this week" on a day off). Say so.
        <EmptyState
          message={
            result?.lastMarkedKey
              ? `${STR.arNoData} ${STR.arLastMarked.replace("{d}", result.lastMarkedKey)}`
              : STR.arNoData
          }
        />
      ) : (
        <View>
          <Muted style={{ marginBottom: space(1) }}>
            {result.fromKey} → {result.toKey} · {STR.arUnits}: {result.unitCount}
          </Muted>
          <Muted style={{ marginBottom: space(2) }}>
            {STR.arFloorNote.replace("{n}", String(result.minHeldDays))}
          </Muted>
          {sortBy === "class" ? (
            <Muted style={{ marginBottom: space(2) }}>{STR.arSortClassNote}</Muted>
          ) : null}

          {rows.slice(0, shown).map((r) => (
            <Card key={r.id}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                <Body style={{ fontWeight: "700", minWidth: 34 }}>{r.rank}</Body>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space(1), flexWrap: "wrap" }}>
                    <Body style={{ fontWeight: "700" }}>{r.name}</Body>
                    {r.classLabel && !r.unitLabel.startsWith(r.classLabel) ? (
                      <Badge text={r.classLabel} tone="muted" />
                    ) : null}
                  </View>
                  <Muted style={{ marginTop: 2 }}>
                    {r.unitLabel} · {STR.arHeld}: {r.heldDays} · {STR.arAbsent}: {r.absentDays}
                    {r.lateDays !== null ? ` · ${STR.arLate}: ${r.lateDays}` : ""}
                    {r.leaveDays ? ` · ${STR.arLeave}: ${r.leaveDays}` : ""}
                  </Muted>
                </View>
                {/* flexShrink 0: the percentage and its badge are the point of the row
                    and must never be squeezed by a long name in the flexible column. */}
                <View style={{ alignItems: "flex-end", flexShrink: 0, gap: space(1) }}>
                  <Body style={{ fontWeight: "700" }}>{r.presentPct}%</Body>
                  {r.belowFloor ? <Badge text={STR.arThin} tone="warn" /> : null}
                </View>
              </View>
            </Card>
          ))}

          {rows.length > shown ? (
            <Chip
              label={`${STR.arMore} (${rows.length - shown})`}
              selected={false}
              onPress={() => setShown((n) => n + PAGE)}
            />
          ) : null}
        </View>
      )}
    </Screen>
  );
}

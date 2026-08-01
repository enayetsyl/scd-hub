/**
 * MonthlyReportConsoleScreen (MR-5b, prd-monthly-report §7.3) — the release desk.
 *
 * One section, one month, one row per child: status, coverage, whether the comment
 * has been reviewed, and what changed since the revision the family already has.
 *
 * The screen NEVER decides whether something may be released — the server sends
 * `releasable` / `blockedReason` / `requiresPrincipal` with every row (the pure
 * verdict from MR-3), so a disabled button and the refusal behind it can never drift
 * apart. Bulk release reports per-child outcomes rather than one all-or-nothing
 * result, because a refusal on one child must not hide the twenty that went out.
 */
import React, { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  BULK_RELEASE_MUTATION,
  BUILD_MONTHLY_REPORTS_MUTATION,
  DRAFT_MONTHLY_COMMENTS_MUTATION,
  MONTHLY_REPORTS_FOR_SECTION_QUERY,
  parseSnapshot,
  type MonthlyReportT,
} from "../../graphql/monthlyReport";
import { ACADEMIC_YEARS_QUERY, CLASSES_QUERY } from "../../graphql/operations";
import { Screen, Body, Muted, Card, Select, Button, Field, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum } from "../../lib/labels";
import { space, useColors } from "../../theme";
import type { ReportsStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ReportsStackParamList>;

/** The last 6 months, newest first — the console is for closing a month, not browsing a year. */
function recentPeriodKeys(now: Date): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function statusLabel(status: MonthlyReportT["status"]): string {
  switch (status) {
    case "RELEASED":
      return STR.mrStatusReleased;
    case "READY":
      return STR.mrStatusReady;
    case "SUPERSEDED":
      return STR.mrStatusSuperseded;
    default:
      return STR.mrStatusDraft;
  }
}

export function blockedLabel(reason: string | null): string | null {
  switch (reason) {
    case "NOT_REVIEWED":
      return STR.mrBlockedNotReviewed;
    case "PROVISIONAL":
      return STR.mrBlockedProvisional;
    case "HARD_LOCKED":
      return STR.mrBlockedLocked;
    case "ALREADY_RELEASED":
      return STR.mrBlockedAlready;
    default:
      return null;
  }
}

function coverageOf(r: MonthlyReportT): string {
  const parts = [r.coverageHomework, r.coverageAssignment, r.coverageClassTest]
    .filter((p): p is number => p != null)
    .map((p) => `${bnNum(Math.round(p))}%`);
  return parts.length ? parts.join(" / ") : "—";
}

function ReportRow({
  report,
  selected,
  onToggle,
  onOpen,
}: {
  report: MonthlyReportT;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}): React.ReactElement {
  const colors = useColors();
  const snap = useMemo(() => parseSnapshot(report.snapshotJson), [report.snapshotJson]);
  const attendance = snap.metrics?.attendance;
  const blocked = blockedLabel(report.blockedReason);

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: space(2) }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {/* Only a releasable row is selectable — a checkbox that cannot act is a lie. */}
        <Pressable
          onPress={onToggle}
          disabled={!report.releasable}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected, disabled: !report.releasable }}
          style={{
            width: 22, height: 22, borderRadius: 4, marginRight: space(2),
            borderWidth: 2,
            borderColor: report.releasable ? colors.primary : colors.border,
            backgroundColor: selected ? colors.primary : "transparent",
          }}
        />
        <Pressable style={{ flex: 1 }} onPress={onOpen}>
          <Body style={{ fontWeight: "700" }}>
            {report.studentName || report.studentId.slice(-6)}
            {report.rollNumber ? ` (${bnNum(report.rollNumber)})` : ""} — {STR.mrRevision}{" "}
            {bnNum(report.revision)}
          </Body>
          <Muted>
            {statusLabel(report.status)}
            {report.provisional ? ` · ${STR.mrProvisional}` : ""}
            {report.isRerelease ? ` · ${STR.mrRevised}` : ""}
            {report.reviewedAt ? ` · ${STR.mrReviewed}` : ""}
          </Muted>
          <Muted>
            {STR.mrAttendance}: {attendance ? `${bnNum(attendance.present)}/${bnNum(attendance.schoolDays)}` : "—"}
            {"  ·  "}
            {STR.mrCoverage}: {coverageOf(report)}
          </Muted>
          {blocked ? <Muted style={{ color: colors.error }}>{blocked}</Muted> : null}
          {report.changeLog.length > 0 ? (
            <Muted style={{ color: colors.warning }}>
              {STR.mrChangeLog}: {bnNum(report.changeLog.length)}
            </Muted>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

export default function MonthlyReportConsoleScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const colors = useColors();
  // Sections come off the class roster (the same read every other class picker uses),
  // so a class with no reports yet is still selectable and answers honestly.
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const years = yearsQ.data?.academicYears ?? [];
  const yearId = (years.find((y) => y.current) ?? years[0])?.id ?? "";
  const [classesQ] = useQuery({ query: CLASSES_QUERY, variables: { academicYearId: yearId }, pause: !yearId });
  const sections = useMemo(
    () =>
      (classesQ.data?.classes ?? []).flatMap((c) =>
        c.sections
          .filter((s) => s.active)
          .map((s) => ({ id: s.id, label: `${c.nameBn} — ${s.nameBn ?? s.code}` })),
      ),
    [classesQ.data],
  );
  const periods = useMemo(() => recentPeriodKeys(new Date()), []);

  const [sectionId, setSectionId] = useState<string | null>(null);
  const [periodKey, setPeriodKey] = useState<string>(periods[0]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [overrideReason, setOverrideReason] = useState("");

  const activeSection = sectionId ?? sections[0]?.id ?? "";
  const [q, refetch] = useQuery({
    query: MONTHLY_REPORTS_FOR_SECTION_QUERY,
    variables: { sectionId: activeSection, periodKey },
    pause: !activeSection,
  });
  const [buildState, build] = useMutation(BUILD_MONTHLY_REPORTS_MUTATION);
  const [releaseState, bulkRelease] = useMutation(BULK_RELEASE_MUTATION);
  const [draftState, draftAll] = useMutation(DRAFT_MONTHLY_COMMENTS_MUTATION);

  const rows = q.data?.monthlyReportsForSection ?? [];
  // The console lists what is CURRENT per child; a superseded revision is history
  // and belongs on the child's own screen, not in a release queue.
  const current = rows.filter((r) => r.status !== "SUPERSEDED");
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  const onBuild = async (): Promise<void> => {
    const res = await build({ sectionId: activeSection, periodKey });
    if (res.error) {
      Alert.alert(STR.mrActionFailed, res.error.message);
      return;
    }
    Alert.alert(STR.mrBuild, `${bnNum(res.data?.buildMonthlyReports ?? 0)} ${STR.mrBuilt}`);
    refetch({ requestPolicy: "network-only" });
  };

  // Only the ones with nothing to review yet — regenerating a comment a person has
  // already accepted would throw their words away, and paying for a model call to do
  // it is worse than useless.
  const needComment = current.filter((r) => !r.reviewedAt && r.status !== "RELEASED" && !r.commentDraft);

  const onDraftAll = async (): Promise<void> => {
    if (needComment.length === 0) {
      Alert.alert(STR.mrGenerateAll, STR.mrNoneToGenerate);
      return;
    }
    const res = await draftAll({ reportIds: needComment.map((r) => r.id) });
    if (res.error) {
      Alert.alert(STR.mrActionFailed, res.error.message);
      return;
    }
    const outcomes = res.data?.draftMonthlyReportComments ?? [];
    const ok = outcomes.filter((o) => o.drafted).length;
    const fellBack = outcomes.filter((o) => o.drafted && o.fallback).length;
    const failed = outcomes.filter((o) => !o.drafted);
    Alert.alert(
      STR.mrGenerateDone,
      [
        `${bnNum(ok)} / ${bnNum(outcomes.length)}`,
        fellBack > 0 ? `${bnNum(fellBack)} ${STR.mrGenerateFallback}` : null,
        ...failed.map((f) => `• ${f.error ?? ""}`),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    refetch({ requestPolicy: "network-only" });
  };

  const onBulkRelease = async (): Promise<void> => {
    const res = await bulkRelease({
      reportIds: selectedIds,
      overrideReason: overrideReason.trim() || null,
    });
    if (res.error) {
      Alert.alert(STR.mrActionFailed, res.error.message);
      return;
    }
    const outcomes = res.data?.bulkReleaseMonthlyReports ?? [];
    const released = outcomes.filter((o) => o.released).length;
    const failed = outcomes.filter((o) => !o.released);
    // Every refusal is named. A bulk action that silently drops children is how a
    // family ends up never receiving a report nobody noticed was missing.
    Alert.alert(
      STR.mrReleased,
      failed.length === 0
        ? `${bnNum(released)} / ${bnNum(outcomes.length)}`
        : `${bnNum(released)} / ${bnNum(outcomes.length)}\n\n${failed
            .map((f) => `• ${f.error ?? ""}`)
            .join("\n")}`,
    );
    setSelected({});
    setOverrideReason("");
    refetch({ requestPolicy: "network-only" });
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.mrConsoleTitle}</Body>
          <Muted>{STR.mrConsoleSub}</Muted>
          <Select
            label={STR.section}
            value={activeSection || null}
            options={sections.map((s) => ({ label: s.label, value: s.id }))}
            onChange={(v) => {
              setSectionId(v);
              setSelected({});
            }}
            placeholder={STR.section}
          />
          <Select
            label={STR.mrMonth}
            value={periodKey}
            options={periods.map((p) => ({ label: bnNum(p), value: p }))}
            onChange={(v) => {
              if (v) setPeriodKey(v);
              setSelected({});
            }}
            placeholder={STR.mrMonth}
          />
          <Button
            title={STR.mrBuild}
            onPress={onBuild}
            loading={buildState.fetching}
            disabled={!activeSection || buildState.fetching}
          />
        </Card>

        <QueryGate results={[q]} onRetry={() => refetch({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          {current.length === 0 ? (
            <EmptyState message={STR.mrNoReports} />
          ) : (
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: space(2) }}>
                <Muted>
                  {bnNum(selectedIds.length)} {STR.mrSelected}
                </Muted>
                <Pressable
                  onPress={() =>
                    setSelected(
                      selectedIds.length > 0
                        ? {}
                        : Object.fromEntries(current.filter((r) => r.releasable).map((r) => [r.id, true])),
                    )
                  }
                >
                  <Body style={{ color: colors.primary }}>
                    {selectedIds.length > 0 ? STR.mrClearSelection : STR.mrSelectAll}
                  </Body>
                </Pressable>
              </View>

              {/* Drafting a class runs one call per child, sequentially — the label
                  says so, because it is the slowest button on the screen. */}
              <View style={{ marginBottom: space(3) }}>
                <Button
                  title={draftState.fetching ? STR.mrGenerating : `${STR.mrGenerateAll} (${bnNum(needComment.length)})`}
                  variant="secondary"
                  loading={draftState.fetching}
                  disabled={draftState.fetching || needComment.length === 0}
                  onPress={onDraftAll}
                />
                <Muted>{STR.mrGenerateAllNote}</Muted>
              </View>

              {current.map((r) => (
                <ReportRow
                  key={r.id}
                  report={r}
                  selected={!!selected[r.id]}
                  onToggle={() => setSelected((s) => ({ ...s, [r.id]: !s[r.id] }))}
                  onOpen={() => nav.navigate("MonthlyReportDetail", { reportId: r.id })}
                />
              ))}

              {selectedIds.length > 0 ? (
                <View style={{ marginTop: space(3) }}>
                  {/* Only offered when at least one selected row actually needs it. */}
                  {current.some((r) => selected[r.id] && r.requiresPrincipal) ? (
                    <Field
                      label={STR.mrOverrideReason}
                      value={overrideReason}
                      onChangeText={setOverrideReason}
                      multiline
                    />
                  ) : null}
                  <Button
                    title={STR.mrReleaseAll}
                    onPress={onBulkRelease}
                    loading={releaseState.fetching}
                    disabled={releaseState.fetching}
                  />
                </View>
              ) : null}
            </Card>
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}

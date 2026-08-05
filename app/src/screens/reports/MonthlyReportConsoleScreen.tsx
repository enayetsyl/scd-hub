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
  IMPORT_MONTHLY_COMMENTS_MUTATION,
  type CommentImportOutcomeT,
  MONTHLY_REPORTS_FOR_SECTION_QUERY,
  parseSnapshot,
  type MonthlyReportT,
} from "../../graphql/monthlyReport";
import { ACADEMIC_YEARS_QUERY, CLASSES_QUERY } from "../../graphql/operations";
import { Screen, Body, Muted, Card, Select, Button, Field, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum } from "../../lib/labels";
import { downloadFile, PDF_SUPPORTED } from "../../lib/pdf";
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
  // MR-8 — collapsed by default: the in-app lane is the normal path and this is the
  // escape hatch, so it should not compete for the eye above the child rows.
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<CommentImportOutcomeT[] | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const activeSection = sectionId ?? sections[0]?.id ?? "";
  const [q, refetch] = useQuery({
    query: MONTHLY_REPORTS_FOR_SECTION_QUERY,
    variables: { sectionId: activeSection, periodKey },
    pause: !activeSection,
  });
  const [buildState, build] = useMutation(BUILD_MONTHLY_REPORTS_MUTATION);
  const [releaseState, bulkRelease] = useMutation(BULK_RELEASE_MUTATION);
  const [draftState, draftAll] = useMutation(DRAFT_MONTHLY_COMMENTS_MUTATION);
  const [importState, runImport] = useMutation(IMPORT_MONTHLY_COMMENTS_MUTATION);

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

  // --- MR-8: the Desktop round trip ---------------------------------------
  const onExport = async (mode: "section" | "zip" | "single"): Promise<void> => {
    setExportError(null);
    if (!PDF_SUPPORTED) {
      setExportError(STR.mrExportWebOnly);
      return;
    }
    const qs =
      mode === "section"
        ? `?sectionId=${encodeURIComponent(activeSection)}&periodKey=${periodKey}`
        : `?all=1&periodKey=${periodKey}&format=${mode}`;
    const name =
      mode === "section"
        ? `monthly-comments-${periodKey}.md`
        : `monthly-comments-${periodKey}.${mode === "zip" ? "zip" : "md"}`;
    try {
      await downloadFile(`/export/monthly-comments${qs}`, name);
    } catch (e) {
      // Inline for the same reason as the import result — an alert never shows on web.
      setExportError(`${STR.mrExportFailed}: ${e instanceof Error ? e.message : ""}`);
    }
  };

  const onImport = async (): Promise<void> => {
    const res = await runImport({ payload: importText.trim() });
    if (res.error) {
      Alert.alert(STR.mrActionFailed, res.error.message);
      return;
    }
    const outcomes = res.data?.importMonthlyComments ?? [];
    // Rendered INLINE, not through Alert.alert — react-native-web does not implement
    // Alert, so on the web console (which is where this is used) an alert is a silent
    // no-op. Every refusal names its row, and that list IS the feature: an operator who
    // pasted twenty-one paragraphs has to see which one did not take. Sending that to a
    // dialog that never appears would make the guards invisible exactly when they fire.
    setImportResult(outcomes);
    if (outcomes.some((o) => o.imported)) setImportText("");
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

              {/* MR-8 — the second lane. Kept BELOW the in-app button and collapsed by
                  default: most months the generated paragraph is accepted as-is, and
                  this is the escape hatch for when it is not. */}
              <Card style={{ marginBottom: space(3) }}>
                <Pressable
                  onPress={() => setDesktopOpen((v) => !v)}
                  accessibilityRole="button"
                  style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                >
                  <Body style={{ fontWeight: "700" }}>{STR.mrDesktopTitle}</Body>
                  <Body style={{ color: colors.primary }}>{desktopOpen ? "▾" : "▸"}</Body>
                </Pressable>

                {desktopOpen ? (
                  <View style={{ gap: space(2), marginTop: space(2) }}>
                    <Muted>{STR.mrDesktopNote}</Muted>

                    <Button title={STR.mrExportSection} variant="secondary" onPress={() => onExport("section")} />
                    {/* Both whole-school shapes, because neither is right every month:
                        the zip when sections go to different people or a chat window
                        has a length limit, the long file when one person does the lot. */}
                    <Button title={STR.mrExportAllZip} variant="secondary" onPress={() => onExport("zip")} />
                    <Button title={STR.mrExportAllSingle} variant="secondary" onPress={() => onExport("single")} />

                    <Field
                      label={STR.mrImportPaste}
                      value={importText}
                      onChangeText={setImportText}
                      multiline
                    />
                    <Button
                      title={importState.fetching ? STR.mrImporting : STR.mrImport}
                      loading={importState.fetching}
                      disabled={importState.fetching || !importText.trim()}
                      onPress={onImport}
                    />
                    <Muted>{STR.mrImportNeedsAccept}</Muted>

                    {exportError ? <Muted style={{ color: colors.error }}>{exportError}</Muted> : null}

                    {/* The outcome, on screen. Counts first, then EVERY refusal with the
                        reason the server gave — the operator has to know which rows to
                        rewrite, and there may be one bad row among twenty good ones. */}
                    {importResult ? (
                      <View style={{ gap: space(1) }}>
                        <Body style={{ fontWeight: "700" }}>
                          {STR.mrImportDone}: {bnNum(importResult.filter((o) => o.imported).length)} /{" "}
                          {bnNum(importResult.length)}
                        </Body>
                        {importResult
                          .filter((o) => !o.imported)
                          .map((o) => (
                            <Muted key={o.reportId} style={{ color: colors.error }}>
                              • {o.reason ?? STR.mrImportRefused}
                            </Muted>
                          ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </Card>

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

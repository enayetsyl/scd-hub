/**
 * HwLifecycleReportScreen (D-#350, teacher-first redesign — supersedes the D-#300
 * five-card layout). Principal/Office homework oversight:
 *   - a from/to date range + class + subject + teacher filter bar;
 *   - the red checking backlog on top (the sharpest stall);
 *   - one card per teacher with the lifecycle totals (declared/issued/given/
 *     submitted/checked/returned) and the actionable PENDING pills — tap any
 *     pending number to open the drill-down naming the stuck students + guardian
 *     phone (HwPendingSheet).
 */
import React, { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useQuery } from "urql";
import { HW_SUBJECTS, ROSTER_CLASS_LEVELS } from "@scd/shared";
import { HW_LIFECYCLE_REPORT_QUERY, type HwPendingStage } from "../../graphql/operations";
import { Screen, H2, Body, Muted, Card, Badge, Select, Loader, ErrorBanner } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { HwPendingSheet, type HwPendingTarget } from "../../components/HwPendingSheet";
import { STR, bnNum, classLevelLabel, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useColors } from "../../theme";
import { space, radius } from "../../theme/tokens";

const keyOf = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

interface PendingPillSpec {
  stage: HwPendingStage;
  label: string;
  count: number;
}

export default function HwLifecycleReportScreen(): React.ReactElement {
  const colors = useColors();

  // Default: last 14 days ending today.
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState<string>(() =>
    keyOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 13)),
  );
  const [to, setTo] = useState<string>(() => keyOf(today));

  // "" = all. classLevel string round-trips through ROSTER_CLASS_LEVELS.
  const [classLevel, setClassLevel] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [teacherId, setTeacherId] = useState<string>(""); // client-side row filter

  const [target, setTarget] = useState<HwPendingTarget | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const classLevelArg = classLevel === "" ? null : Number(classLevel);
  const subjectArg = subject === "" ? null : subject;

  const [q, refetch] = useQuery({
    query: HW_LIFECYCLE_REPORT_QUERY,
    variables: { from, to, classLevel: classLevelArg, subject: subjectArg },
    requestPolicy: "cache-and-network",
  });
  const report = q.data?.homeworkLifecycleReport;

  const cellTitle = (r: { classLevel: number; sectionNameBn: string; subject: string }): string =>
    `${classLevelLabel(r.classLevel)}${r.sectionNameBn ? ` — ${r.sectionNameBn}` : ""} · ${hwSubjectLabel(r.subject)}`;

  const teacherOptions = useMemo(
    () => [
      { label: STR.hlrAll, value: "" },
      ...(report?.teachers ?? []).map((t) => ({ label: t.teacherName, value: t.teacherId })),
    ],
    [report],
  );

  const teachers = useMemo(
    () => (report?.teachers ?? []).filter((t) => teacherId === "" || t.teacherId === teacherId),
    [report, teacherId],
  );

  const openDrill = (t: { teacherId: string; teacherName: string }, stage: HwPendingStage, label: string): void => {
    setTarget({ teacherId: t.teacherId, teacherName: t.teacherName, stage, stageLabel: label });
    setSheetOpen(true);
  };

  return (
    <Screen scroll>
      <H2>{STR.hlrTitle}</H2>
      <Muted style={{ marginBottom: space(2) }}>{STR.hlrSub}</Muted>

      {/* Filter bar */}
      <Card>
        <View style={{ flexDirection: "row", gap: space(3) }}>
          <View style={{ flex: 1 }}>
            <DateField label={STR.hlrFrom} value={from} onChange={setFrom} max={to} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label={STR.hlrTo} value={to} onChange={setTo} min={from} max={keyOf(today)} />
          </View>
        </View>
        <Select
          label={STR.hlrFilterClass}
          value={classLevel}
          onChange={setClassLevel}
          options={[
            { label: STR.hlrAll, value: "" },
            ...ROSTER_CLASS_LEVELS.map((l) => ({ label: classLevelLabel(l), value: String(l) })),
          ]}
        />
        <Select
          label={STR.hlrFilterSubject}
          value={subject}
          onChange={setSubject}
          options={[{ label: STR.hlrAll, value: "" }, ...HW_SUBJECTS.map((s) => ({ label: hwSubjectLabel(s), value: s }))]}
        />
        <Select label={STR.hlrFilterTeacher} value={teacherId} onChange={setTeacherId} options={teacherOptions} searchable />
      </Card>

      {q.error ? (
        <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : null}
      {q.fetching && !report ? <Loader label={STR.loading} /> : null}

      {report && teachers.length === 0 && report.backlog.length === 0 ? (
        <Card>
          <Body style={{ fontWeight: "600" }}>{STR.hlrEmpty}</Body>
        </Card>
      ) : null}

      {/* Checking backlog — the actionable stall, red, on top. */}
      {(report?.backlog.length ?? 0) > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: 2 }}>🔴 {STR.hlrBacklogTitle}</Body>
          <Muted style={{ marginBottom: space(1) }}>
            &gt; {bnNum(report!.backlogThresholdDays)} {STR.hlrDays} · {STR.hlrBacklogSub}
          </Muted>
          {report!.backlog.map((b) => (
            <View
              key={`${b.sectionId}-${b.subject}-${b.teacherName ?? ""}`}
              style={{ flexDirection: "row", alignItems: "center", paddingVertical: space(1), gap: space(2) }}
            >
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "600" }}>{cellTitle(b)}</Body>
                <Muted>
                  {b.teacherName ?? "—"} · {STR.hlrOldest} {bnNum(b.oldestDays)} {STR.hlrDays}
                </Muted>
              </View>
              <Badge text={bnNum(b.count)} tone="danger" />
            </View>
          ))}
        </Card>
      ) : null}

      {/* One card per teacher: totals + tappable pending pills. */}
      {teachers.map((t) => {
        const pills: PendingPillSpec[] = [
          { stage: "SUBMISSION", label: STR.hlrPendingSubmission, count: t.pendingSubmission },
          { stage: "CHECK", label: STR.hlrPendingCheck, count: t.pendingChecking },
          { stage: "RETURN", label: STR.hlrPendingReturn, count: t.pendingReturn },
          { stage: "CHASE", label: STR.hlrChasedPending, count: t.chasedPending },
        ];
        return (
          <Card key={t.teacherId}>
            <Body style={{ fontWeight: "700", marginBottom: 2 }}>🧑‍🏫 {t.teacherName}</Body>
            <Muted style={{ marginBottom: space(2) }}>
              {STR.hlrDeclared} {bnNum(t.declaredItems)} · {STR.hlrIssued} {bnNum(t.issuedItems)} · {STR.hlrGiven}{" "}
              {bnNum(t.given)} · {STR.hlrSubmitted} {bnNum(t.submitted)} · {STR.hlrChecked} {bnNum(t.checked)} ·{" "}
              {STR.hlrReturned} {bnNum(t.returned)}
            </Muted>
            <Muted style={{ fontWeight: "600", marginBottom: space(1) }}>{STR.hlrPendingHeader}</Muted>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
              {pills.map((p) => {
                const active = p.count > 0;
                return (
                  <Pressable
                    key={p.stage}
                    disabled={!active}
                    onPress={() => openDrill(t, p.stage, p.label)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space(1),
                      paddingVertical: space(1),
                      paddingHorizontal: space(2),
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: active ? colors.error : colors.border,
                      backgroundColor: active ? colors.errorContainer : colors.surfaceAlt,
                      opacity: active ? 1 : 0.6,
                    }}
                  >
                    <Body style={{ fontWeight: "700", color: active ? colors.onErrorContainer : colors.textSecondary }}>
                      {bnNum(p.count)}
                    </Body>
                    <Muted style={{ color: active ? colors.onErrorContainer : colors.textSecondary }}>{p.label}</Muted>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        );
      })}

      <HwPendingSheet
        visible={sheetOpen}
        target={target}
        from={from}
        to={to}
        classLevel={classLevelArg}
        subject={subjectArg}
        onClose={() => setSheetOpen(false)}
      />
    </Screen>
  );
}

/**
 * HomeworkReconcileScreen (§4 / §8.1) — CLASS-TEACHER daily reconciliation.
 * Shows DAY_TOTAL vs 120, lets the teacher trim a subject's Q_COUNT (time follows
 * proportionally; rank auto-chosen ক/খ/গ), then confirm-issue with a present/absent
 * roster. Over-ceiling blocks confirm (server enforces too). Non-class-teachers get
 * a Forbidden error from the server.
 */
import React, { useState, useRef, useCallback, useEffect } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import { HW_DAILY_CEILING_MIN } from "@scd/shared";
import {
  CLASSES_QUERY,
  HOMEWORK_DAY_TALLY,
  HOMEWORK_ISSUE_ROSTER,
  ROSTER_QUERY,
  TRIM_HOMEWORK_ITEM,
  CONFIRM_HOMEWORK_DAY,
} from "../../graphql/operations";
import type { HomeworkStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Field, Chip, ChipRow, Notice, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { ClassSectionDashboard } from "../../components/ClassSectionDashboard";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { useSectionContext } from "../../state/SectionContext";
import { useToast } from "../../state/ToastContext";
import { space, useColors } from "../../theme";
import { dateKey } from "../../lib/dates";

type Props = NativeStackScreenProps<HomeworkStackParamList, "HomeworkReconcile">;

const today = (): string => dateKey();

export default function HomeworkReconcileScreen({ navigation, route }: Props): React.ReactElement {
  const colors = useColors();
  const { role, user, can } = useAuth();
  const { selection, hasSection } = useSectionContext();
  const isAdmin = (can("roster:manage")) || !!user?.homeworkSupervisor;
  // R-Context (UX-5): inherit the date picked on Homework home; still editable here.
  const [date, setDate] = useState(route.params?.date ?? today());
  const [trimTo, setTrimTo] = useState<Record<string, string>>({});
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  // R-Validate (UX-1): per-item trim errors, keyed by itemId.
  const [trimErrors, setTrimErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const vars = { sectionId: selection.sectionId ?? "", classId: selection.classId ?? "", date };
  const [{ data: classesData }] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: selection.academicYearId ?? "" },
    pause: !selection.academicYearId,
  });
  const [tallyQ, refetchTally] = useQuery({ query: HOMEWORK_DAY_TALLY, variables: vars, pause: !hasSection });
  const [rosterQ] = useQuery({ query: ROSTER_QUERY, variables: { sectionId: vars.sectionId }, pause: !hasSection });
  // D-#320: attendance-backed prefill — absentees come pre-crossed; the teacher
  // can still toggle. A manual touch stops further auto-fills for this day.
  const [attRosterQ] = useQuery({ query: HOMEWORK_ISSUE_ROSTER, variables: vars, pause: !hasSection });
  const rosterTouched = useRef(false);
  useEffect(() => {
    rosterTouched.current = false;
    setAbsent(new Set());
  }, [vars.sectionId, date]);
  const attRoster = attRosterQ.data?.homeworkIssueRoster;
  useEffect(() => {
    if (!attRoster?.complete || rosterTouched.current) return;
    setAbsent(new Set(attRoster.entries.filter((e) => !e.present).map((e) => e.studentId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attRoster]);
  const [, trim] = useMutation(TRIM_HOMEWORK_ITEM);
  const [, confirm] = useMutation(CONFIRM_HOMEWORK_DAY);

  // Refetch the live tally when the screen regains focus (e.g. after declaring an
  // item on the sibling screen) so it never shows a stale day-total. Mirrors
  // HomeworkHomeScreen; skips the first focus since the query already runs then.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      if (hasSection) refetchTally({ requestPolicy: "network-only" });
    }, [hasSection, refetchTally]),
  );

  const tally = tallyQ.data?.homeworkDayTally;
  const students = rosterQ.data?.studentsInSection ?? [];
  const over = tally ? !tally.withinCeiling : false;
  const selectedSection =
    classesData?.classes
      .find((c) => c.id === selection.classId)
      ?.sections.find((s) => s.id === selection.sectionId) ?? null;
  const canReconcileHomework =
    isAdmin || (!!selectedSection && (selectedSection.classTeacherId === user?.id || selectedSection.homeworkConfirmerId === user?.id));

  async function onTrim(itemId: string, qCount: number, revItem: boolean): Promise<void> {
    setTrimErrors({});
    const raw = trimTo[itemId];
    const newQ = parseInt(raw ?? "", 10);
    if (!Number.isFinite(newQ) || newQ < 0 || newQ >= qCount) {
      setTrimErrors({ [itemId]: `${STR.hwTrimTo} — ${STR.fieldRequired}` });
      toast.show(`${STR.hwTrimTo} — ${STR.fieldRequired}`, "danger");
      return;
    }
    const rank = newQ === 0 ? "c" : revItem ? "a" : "b";
    setBusy(true);
    const res = await trim({ ...vars, itemId, newQCount: newQ, rank });
    setBusy(false);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.saved, "ok");
    setTrimTo((m) => ({ ...m, [itemId]: "" }));
    refetchTally({ requestPolicy: "network-only" });
  }

  function toggleAbsent(studentId: string): void {
    rosterTouched.current = true; // D-#320: manual edits win over the prefill
    setAbsent((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  async function onConfirm(): Promise<void> {
    const roster = students.map((s) => ({ studentId: s.id, present: !absent.has(s.id) }));
    setBusy(true);
    const res = await confirm({ ...vars, roster });
    setBusy(false);
    if (res.error || !res.data?.confirmHomeworkDay) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    const r = res.data.confirmHomeworkDay;
    toast.show(`${STR.hwIssuedItems}: ${bnNum(r.issuedItems)} · ${STR.hwIssuedRecords}: ${bnNum(r.issuedRecords)}`, "ok");
    refetchTally({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <ClassSectionDashboard />
        {hasSection ? <DateField label={STR.hwDate} value={date} onChange={setDate} /> : null}
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {!hasSection ? (
          <EmptyState message={STR.pickSection} />
        ) : tallyQ.error ? (
          <ErrorBanner message={friendlyError(tallyQ.error)} onRetry={() => refetchTally({ requestPolicy: "network-only" })} />
        ) : tallyQ.fetching && !tally ? (
          <Loader label={STR.loading} />
        ) : (
          <>
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>{STR.hwDayTotal}</Body>
                <Badge text={`${bnNum(tally?.dayTotal ?? 0)} / ${bnNum(tally?.ceiling ?? HW_DAILY_CEILING_MIN)}`} tone={over ? "danger" : "ok"} />
              </View>
              {over ? <Muted style={{ color: colors.error, marginTop: 4 }}>{STR.hwOverCeiling} · {STR.hwTrimPanel}</Muted> : null}
            </Card>

            {canReconcileHomework ? (
              <>
                {/* Trim panel — one row per declared item */}
            {(tally?.items ?? []).filter((it) => it.status === "declared").map((it) => (
              <Card key={it.itemId}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ fontWeight: "700" }}>{hwSubjectLabel(it.subject)}</Body>
                  <Muted>{bnNum(it.timeDecl)} {STR.hwMinutes} · {bnNum(it.qCount)} {STR.questionsWord}</Muted>
                </View>
                {/* D-#317: the teacher's brief "what is the homework". */}
                {it.description ? <Muted style={{ marginTop: 2 }}>📝 {it.description}</Muted> : null}
                <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end", marginTop: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={STR.hwTrimTo}
                      value={trimTo[it.itemId] ?? ""}
                      onChangeText={(t) => setTrimTo((m) => ({ ...m, [it.itemId]: t }))}
                      keyboardType="number-pad"
                      error={trimErrors[it.itemId]}
                    />
                  </View>
                  <View style={{ marginBottom: 12 }}>
                    <Button title={STR.hwTrim} variant="secondary" onPress={() => onTrim(it.itemId, it.qCount, it.revItem)} disabled={busy} />
                  </View>
                </View>
              </Card>
            ))}

            {/* Roster present/absent — D-#320: prefilled from the day's attendance. */}
            <Card>
              <Body style={{ fontWeight: "700", marginBottom: 8 }}>{STR.hwRosterPresent} / {STR.hwRosterAbsent}</Body>
              {attRoster?.complete ? (
                <Muted style={{ marginBottom: 6 }}>✓ {STR.hwRosterFromAttendance}</Muted>
              ) : hasSection && attRosterQ.data && !attRoster?.complete ? (
                <Muted style={{ marginBottom: 6 }}>{STR.hwRosterAttendanceIncomplete}</Muted>
              ) : null}
              {students.length === 0 ? (
                <Muted>{STR.empty}</Muted>
              ) : (
                <ChipRow>
                  {students.map((s) => (
                    <Chip
                      key={s.id}
                      label={`${s.nameBn || s.name}${absent.has(s.id) ? " ✗" : ""}`}
                      selected={!absent.has(s.id)}
                      onPress={() => toggleAbsent(s.id)}
                    />
                  ))}
                </ChipRow>
              )}
            </Card>

            <View style={{ marginTop: space(2) }}>
              {over ? <Muted style={{ color: colors.error, marginBottom: 8 }}>{STR.hwOverCeiling}</Muted> : null}
              <Button title={STR.hwConfirmIssue} onPress={onConfirm} loading={busy} disabled={busy || over} />
            </View>
              </>
            ) : (
              <Notice message={STR.hwClassTeacherOnly} tone="danger" />
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

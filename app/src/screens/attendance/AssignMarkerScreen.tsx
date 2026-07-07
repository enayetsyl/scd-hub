/**
 * AssignMarkerScreen (AT2.1, D-#64) — Principal/Office assign a teacher to mark
 * a section for a day or date range (overrides the class-teacher default for
 * those dates; the newest assignment wins an overlap). Active assignments for
 * the chosen date are listed with revoke — a teacher carrying several sections
 * is visible here. attendance:manage.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  ASSIGN_SECTION_MARKER,
  REVOKE_SECTION_MARKER,
  SECTION_MARKER_ASSIGNMENTS,
} from "../../graphql/operations";
import type { AttendanceStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Button, Notice, Divider, EmptyState } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { TeacherSelect } from "../../components/selects";
import { ClassSectionDashboard } from "../../components/ClassSectionDashboard";
import { STR, classLevelLabel, getActiveLang } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AttendanceStackParamList, "AssignMarker">;

const todayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function AssignMarkerScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const { confirmAction } = useConfirm();
  const lang = getActiveLang();
  const [teacherId, setTeacherId] = useState("");
  const [fromKey, setFromKey] = useState(todayKey());
  const [toKey, setToKey] = useState(todayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [assignmentsQ, refetch] = useQuery({
    query: SECTION_MARKER_ASSIGNMENTS,
    variables: { dateKey: fromKey },
  });
  const [, assign] = useMutation(ASSIGN_SECTION_MARKER);
  const [, revoke] = useMutation(REVOKE_SECTION_MARKER);

  const assignments = assignmentsQ.data?.sectionMarkerAssignments ?? [];

  async function onAssign(): Promise<void> {
    if (!selection.sectionId || !teacherId) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await assign({ sectionId: selection.sectionId, teacherId, fromKey, toKey });
    setBusy(false);
    if (res.error || !res.data?.assignSectionMarker) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.attAssigned);
    setTeacherId("");
    refetch({ requestPolicy: "network-only" });
  }

  async function onRevoke(assignmentId: string): Promise<void> {
    if (!(await confirmAction({ confirmLabel: STR.attRevoke }))) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await revoke({ assignmentId });
    setBusy(false);
    if (res.error || !res.data?.revokeSectionMarker) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.attRevoked);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <ClassSectionDashboard />
      {hasSection ? (
        <Card>
          <TeacherSelect label={STR.attMarkerWord} value={teacherId} onChange={setTeacherId} />
          <DateField label={STR.attLeaveFrom} value={fromKey} onChange={setFromKey} />
          <DateField label={STR.attLeaveTo} value={toKey} onChange={setToKey} min={fromKey || undefined} />
          <Button title={STR.attAssign} onPress={onAssign} loading={busy} disabled={!teacherId} />
        </Card>
      ) : (
        <Muted>{STR.pickSection}</Muted>
      )}

      {error ? <Notice message={error} tone="danger" /> : null}
      {ok ? <Notice message={ok} tone="ok" /> : null}

      <Divider />
      <H2>{STR.attActiveAssignments}</H2>
      {assignments.length === 0 && !assignmentsQ.fetching ? (
        <EmptyState message={STR.attNoAssignments} />
      ) : (
        assignments.map((a) => (
          <Card key={a.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "700" }}>
                  {lang === "en" ? classLevelLabel(a.classLevel ?? 0) : a.classNameBn ?? ""}{" "}
                  {lang === "en" ? a.sectionCode ?? a.sectionNameBn ?? "" : a.sectionNameBn ?? a.sectionCode ?? ""}
                </Body>
                <Muted>
                  {a.teacherName ?? a.teacherId} · {a.fromKey} → {a.toKey}
                </Muted>
              </View>
              <Button title={STR.attRevoke} variant="danger" onPress={() => onRevoke(a.id)} disabled={busy} />
            </View>
          </Card>
        ))
      )}
      <View style={{ height: space(4) }} />
    </Screen>
  );
}

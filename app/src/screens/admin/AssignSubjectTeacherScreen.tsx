/**
 * AssignSubjectTeacherScreen — Principal/Admin assign a SUBJECT TEACHER (teaching
 * grant, ADR-017) to the selected section: teacher + subject → grantTeaching. Lists
 * the section's current subject teachers with revoke. Gated on user:manage.
 *
 * D-#291: the grant is ACCESS, the routine is the TIMETABLE — and their sync runs
 * routine → grants (D-#257), never the other way. To keep the two from drifting,
 * every subject row also shows the ROUTINE's teacher(s) with a mismatch warning;
 * removing a grant while the teacher still holds routine periods warns (the routine
 * would re-create the grant); assigning offers an optional conflict-checked
 * "also update the routine" step (routine:manage holders only).
 */
import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  TEACHING_GRANTS_QUERY,
  GRANT_TEACHING,
  REVOKE_TEACHING,
  TEACHERS_QUERY,
  SUBJECTS_QUERY,
  SECTION_SUBJECT_ROUTINE_TEACHERS,
  REASSIGN_ROUTINE_SUBJECT_TEACHER,
} from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Button, Notice, EmptyState } from "../../components/ui";
import { TeacherSelect, SubjectSelect } from "../../components/selects";
import { ClassSectionDashboard } from "../../components/ClassSectionDashboard";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { useSectionContext } from "../../state/SectionContext";
import { useConfirm } from "../../state/ConfirmContext";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "AssignSubjectTeacher">;

export default function AssignSubjectTeacherScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const { confirmAction } = useConfirm();
  const { role, can } = useAuth();
  const colors = useColors();
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [, grant] = useMutation(GRANT_TEACHING);
  const [, revoke] = useMutation(REVOKE_TEACHING);
  const [, reassignRoutine] = useMutation(REASSIGN_ROUTINE_SUBJECT_TEACHER);

  const [grantsQ, refetchGrants] = useQuery({
    query: TEACHING_GRANTS_QUERY,
    variables: { sectionId: selection.sectionId ?? "" },
    pause: !selection.sectionId,
  });
  const [{ data: teacherData }] = useQuery({ query: TEACHERS_QUERY });
  const [{ data: subjectData }] = useQuery({ query: SUBJECTS_QUERY });
  const teacherName = new Map((teacherData?.teachers ?? []).map((t) => [t.id, t.name]));
  const subjectName = new Map((subjectData?.subjects ?? []).map((s) => [s.id, s.nameBn]));
  const subjectCode = new Map((subjectData?.subjects ?? []).map((s) => [s.id, s.code]));

  // D-#291: what the ROUTINE says per subject — the drift-visibility read.
  const [routineQ, refetchRoutine] = useQuery({
    query: SECTION_SUBJECT_ROUTINE_TEACHERS,
    variables: { sectionId: selection.sectionId ?? "" },
    pause: !selection.sectionId,
  });
  const routineBySubject = new Map(
    (routineQ.data?.sectionSubjectRoutineTeachers ?? []).map((r) => [r.subject, r]),
  );
  const canEditRoutine = can("routine:manage");

  const grants = grantsQ.data?.teachingGrants ?? [];

  async function runGrant(): Promise<void> {
    if (!selection.sectionId || subjectId === "" || teacherId === "") return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await grant({ teacherId, sectionId: selection.sectionId, subjectId });
    setBusy(false);
    if (res.error || !res.data?.grantTeaching) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.stAssigned);
    refetchGrants({ requestPolicy: "network-only" });

    // D-#291: if the routine names someone ELSE for this subject, offer to point
    // its periods at the new teacher too (conflict-checked, whole-or-nothing).
    const code = subjectCode.get(subjectId);
    const routine = code ? routineBySubject.get(code) : undefined;
    const grantedTeacherId = teacherId;
    setSubjectId("");
    setTeacherId("");
    if (
      canEditRoutine &&
      code &&
      routine &&
      routine.teacherIds.length > 0 &&
      !routine.teacherIds.includes(grantedTeacherId)
    ) {
      const yes = await confirmAction({
        title: STR.stSyncRoutineTitle,
        message: `${STR.stSyncRoutineMsg} (${STR.stOnRoutine}: ${routine.teacherNames.join(", ")})`,
        confirmLabel: STR.stSyncRoutineYes,
        tone: "primary",
      });
      if (yes) {
        setBusy(true);
        const sync = await reassignRoutine({
          sectionId: selection.sectionId,
          subject: code,
          teacherId: grantedTeacherId,
        });
        setBusy(false);
        if (sync.error || !sync.data?.reassignRoutineSubjectTeacher) {
          setError(friendlyError(sync.error));
        } else {
          setOk(
            `${STR.stRoutineSynced} — ${sync.data.reassignRoutineSubjectTeacher.updatedSlots}${STR.stPeriodsWord}`,
          );
        }
        refetchRoutine({ requestPolicy: "network-only" });
        refetchGrants({ requestPolicy: "network-only" });
      }
    }
  }

  async function runRevoke(grantId: string, gTeacherId: string | null, gSubjectId: string | null): Promise<void> {
    // D-#291: removing the grant does NOT touch the timetable — and a routine edit
    // would re-create it. Say so when the teacher still holds routine periods.
    const code = gSubjectId ? subjectCode.get(gSubjectId) : undefined;
    const routine = code ? routineBySubject.get(code) : undefined;
    const stillOnRoutine = !!gTeacherId && !!routine && routine.teacherIds.includes(gTeacherId);
    const confirmed = await confirmAction(
      stillOnRoutine
        ? { title: STR.stStillOnRoutineTitle, message: STR.stStillOnRoutineMsg, confirmLabel: STR.remove }
        : { confirmLabel: STR.remove },
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await revoke({ grantId });
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.stRemoved);
    refetchGrants({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <ClassSectionDashboard />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}
        <Muted style={{ marginBottom: space(2) }}>{STR.stHint}</Muted>

        {!hasSection ? (
          <EmptyState message={STR.pickSection} />
        ) : (
          <>
            {/* Current subject teachers for this section */}
            <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stCurrent}</Body>
            {grants.length === 0 ? <Muted>{STR.stNone}</Muted> : null}
            {grants.map((g) => {
              const code = g.subjectId ? subjectCode.get(g.subjectId) : undefined;
              const routine = code ? routineBySubject.get(code) : undefined;
              const mismatch = !!g.teacherId && !!routine && !routine.teacherIds.includes(g.teacherId);
              return (
                <Card key={g.id}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontWeight: "700" }}>{g.subjectId ? subjectName.get(g.subjectId) ?? g.subjectId : "—"}</Body>
                      <Muted>{g.teacherId ? teacherName.get(g.teacherId) ?? g.teacherId : "—"}</Muted>
                      {/* D-#291: what the ROUTINE says, so grant/timetable drift is visible. */}
                      {routine ? (
                        <Muted style={mismatch ? { color: colors.warning, fontWeight: "600" } : undefined}>
                          {mismatch ? `${STR.stRoutineMismatch} — ` : ""}
                          {STR.stOnRoutine}: {routine.teacherNames.join(", ")}
                        </Muted>
                      ) : (
                        <Muted>{STR.stNotOnRoutine}</Muted>
                      )}
                    </View>
                    <Button
                      title={STR.remove}
                      variant="danger"
                      onPress={() => runRevoke(g.id, g.teacherId, g.subjectId)}
                      disabled={busy}
                    />
                  </View>
                </Card>
              );
            })}

            {/* Assign a new subject teacher */}
            <SubjectSelect label={STR.stSubject} value={subjectId} onChange={setSubjectId} />
            <TeacherSelect label={STR.stTeacher} value={teacherId} onChange={setTeacherId} />
            <Button
              title={STR.stAssign}
              onPress={runGrant}
              loading={busy}
              disabled={busy || subjectId === "" || teacherId === ""}
              style={{ marginTop: space(2) }}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * AssignSubjectTeacherScreen — Principal/Admin assign a SUBJECT TEACHER (teaching
 * grant, ADR-017) to the selected section: teacher + subject → grantTeaching. Lists
 * the section's current subject teachers with revoke. Gated on user:manage.
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
} from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Button, Notice, EmptyState } from "../../components/ui";
import { TeacherSelect, SubjectSelect } from "../../components/selects";
import { ClassSectionDashboard } from "../../components/ClassSectionDashboard";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "AssignSubjectTeacher">;

export default function AssignSubjectTeacherScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const { confirmAction } = useConfirm();
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [, grant] = useMutation(GRANT_TEACHING);
  const [, revoke] = useMutation(REVOKE_TEACHING);

  const [grantsQ, refetchGrants] = useQuery({
    query: TEACHING_GRANTS_QUERY,
    variables: { sectionId: selection.sectionId ?? "" },
    pause: !selection.sectionId,
  });
  const [{ data: teacherData }] = useQuery({ query: TEACHERS_QUERY });
  const [{ data: subjectData }] = useQuery({ query: SUBJECTS_QUERY });
  const teacherName = new Map((teacherData?.teachers ?? []).map((t) => [t.id, t.name]));
  const subjectName = new Map((subjectData?.subjects ?? []).map((s) => [s.id, s.nameBn]));

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
    setSubjectId("");
    setTeacherId("");
    refetchGrants({ requestPolicy: "network-only" });
  }

  async function runRevoke(grantId: string): Promise<void> {
    if (!(await confirmAction({ confirmLabel: STR.remove }))) return;
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
            {grants.map((g) => (
              <Card key={g.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{g.subjectId ? subjectName.get(g.subjectId) ?? g.subjectId : "—"}</Body>
                    <Muted>{g.teacherId ? teacherName.get(g.teacherId) ?? g.teacherId : "—"}</Muted>
                  </View>
                  <Button title={STR.remove} variant="danger" onPress={() => runRevoke(g.id)} disabled={busy} />
                </View>
              </Card>
            ))}

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

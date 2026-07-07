/**
 * GroupMembersScreen (routine R1.4) — assign students to a Quran/Arabic SubjectGroup.
 *
 * Why it matters: a student's Quran/Arabic periods only appear on their guardian's
 * weekly routine when a `SubjectGroupMembership` row links them to the group (the
 * guardian view merges the section slots with the student's group slots). Without
 * this screen there was no in-app way to create those rows, so every guardian saw
 * only the general (section) subjects. Gated `routine:manage` (Principal/Office).
 * `addGroupMember` enforces ≤1 group per track per student.
 */
import React, { useMemo, useState } from "react";
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  SUBJECT_GROUPS_QUERY,
  SUBJECT_GROUP_MEMBER_PROFILES,
  STUDENTS_QUERY,
  ADD_GROUP_MEMBER,
  REMOVE_GROUP_MEMBER,
} from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Button, Notice, EmptyState, Select } from "../../components/ui";
import { ClassSectionDashboard } from "../../components/ClassSectionDashboard";
import { AcademicYearSelect } from "../../components/selects";
import { STR, periodTrackLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "GroupMembers">;

export default function GroupMembersScreen(_props: Props): React.ReactElement {
  const { selection, hasSection, setAcademicYearId } = useSectionContext();
  const { confirmAction } = useConfirm();
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [, add] = useMutation(ADD_GROUP_MEMBER);
  const [, remove] = useMutation(REMOVE_GROUP_MEMBER);

  const [{ data: groupsData }] = useQuery({ query: SUBJECT_GROUPS_QUERY, variables: {} });
  const groupOptions = (groupsData?.subjectGroups ?? []).map((g) => ({
    label: `${periodTrackLabel(g.track)} · ${g.nameBn}`,
    value: g.id,
    hint: g.code,
  }));

  const [membersQ, refetchMembers] = useQuery({
    query: SUBJECT_GROUP_MEMBER_PROFILES,
    variables: { groupId },
    pause: groupId === "",
  });
  const members = membersQ.data?.subjectGroupMemberProfiles ?? [];
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  const [studentsQ] = useQuery({
    query: STUDENTS_QUERY,
    variables: { sectionId: selection.sectionId ?? "" },
    pause: !selection.sectionId,
  });
  const students = studentsQ.data?.studentsInSection ?? [];

  async function runAdd(studentId: string): Promise<void> {
    if (groupId === "") return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await add({ groupId, studentId });
    setBusy(false);
    if (res.error || !res.data?.addGroupMember) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.gmAdded);
    refetchMembers({ requestPolicy: "network-only" });
  }

  async function runRemove(studentId: string): Promise<void> {
    if (groupId === "" || !(await confirmAction({ confirmLabel: STR.remove }))) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await remove({ groupId, studentId });
    setBusy(false);
    if (res.error || !res.data?.removeGroupMember) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.gmRemoved);
    refetchMembers({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        {/* Seeds the current academic year into SectionContext so the class list
            below can load; hides itself when there's only one year (variant auto). */}
        <AcademicYearSelect
          variant="auto"
          value={selection.academicYearId ?? ""}
          onChange={setAcademicYearId}
        />
        <ClassSectionDashboard />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}
        <Muted style={{ marginBottom: space(2) }}>{STR.gmHint}</Muted>

        <Select
          label={STR.gmGroup}
          value={groupId === "" ? null : groupId}
          options={groupOptions}
          onChange={setGroupId}
          placeholder={STR.gmSelectGroup}
          searchable
        />

        {groupId === "" ? (
          <EmptyState message={STR.gmPickGroup} />
        ) : (
          <>
            {/* Current members of the group (across all sections) */}
            <Body style={{ fontWeight: "700", marginTop: space(3), marginBottom: space(1) }}>
              {STR.gmCurrent}
            </Body>
            {members.length === 0 ? <Muted>{STR.gmNone}</Muted> : null}
            {members.map((m) => (
              <Card key={m.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{m.name}</Body>
                    <Muted>{m.schoolId}</Muted>
                  </View>
                  <Button title={STR.remove} variant="danger" onPress={() => runRemove(m.id)} disabled={busy} />
                </View>
              </Card>
            ))}

            {/* Add from the selected section — the group spans sections, so pick a
                section above to find its students, then Add each one. */}
            <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(1) }}>{STR.gmAddFrom}</Body>
            {!hasSection ? (
              <EmptyState message={STR.pickSection} />
            ) : students.length === 0 ? (
              <Muted>{STR.gmNoStudents}</Muted>
            ) : (
              students.map((s) => {
                const isMember = memberIds.has(s.id);
                return (
                  <Card key={s.id}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                      <View style={{ flex: 1 }}>
                        <Body style={{ fontWeight: isMember ? "400" : "700" }}>{s.name}</Body>
                        <Muted>{s.schoolId}</Muted>
                      </View>
                      {isMember ? (
                        <Muted>{STR.gmMember}</Muted>
                      ) : (
                        <Button title={STR.gmAdd} onPress={() => runAdd(s.id)} disabled={busy} />
                      )}
                    </View>
                  </Card>
                );
              })
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

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
import { GROUP_GENDERS, PERIOD_TRACKS } from "@scd/shared";
import {
  SUBJECT_GROUPS_QUERY,
  SUBJECT_GROUP_MEMBER_PROFILES,
  STUDENTS_QUERY,
  ADD_GROUP_MEMBER,
  REMOVE_GROUP_MEMBER,
  CREATE_SUBJECT_GROUP,
  SET_SUBJECT_GROUP_ACTIVE,
} from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import {
  Screen,
  Body,
  Muted,
  Card,
  Button,
  Chip,
  ChipRow,
  Badge,
  Field,
  Notice,
  EmptyState,
  Select,
} from "../../components/ui";
import { ClassSectionDashboard } from "../../components/ClassSectionDashboard";
import { AcademicYearSelect } from "../../components/selects";
import { STR, periodTrackLabel, groupGenderLabel } from "../../lib/labels";
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
  const [, createGroup] = useMutation(CREATE_SUBJECT_GROUP);
  const [, setGroupActive] = useMutation(SET_SUBJECT_GROUP_ACTIVE);

  // Create-group form (collapsed until asked for — this screen's day job is
  // assigning students, not authoring groups).
  const [showNew, setShowNew] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const [newTrack, setNewTrack] = useState<string>("quran");
  const [newLevel, setNewLevel] = useState("");
  const [newGender, setNewGender] = useState<string>("boys");
  const [newNameBn, setNewNameBn] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);
  const [newCode, setNewCode] = useState("");

  /** QURAN_HIFZ_1_BOYS — the existing seeded convention, so new rows match. */
  const suggestedCode = useMemo(
    () =>
      [newTrack, newLevel, newGender]
        .map((p) => p.trim().toUpperCase().replace(/\s+/g, "_"))
        .filter(Boolean)
        .join("_"),
    [newTrack, newLevel, newGender],
  );
  const effectiveCode = codeEdited ? newCode : suggestedCode;

  const [groupsQ, refetchGroups] = useQuery({
    query: SUBJECT_GROUPS_QUERY,
    variables: { includeInactive: showRetired },
  });
  const groups = groupsQ.data?.subjectGroups ?? [];
  const groupOptions = groups.map((g) => ({
    label: `${periodTrackLabel(g.track)} · ${g.nameBn}${g.active === false ? ` (${STR.gmInactive})` : ""}`,
    value: g.id,
    hint: g.code,
  }));
  const selectedGroup = groups.find((g) => g.id === groupId) ?? null;

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

  async function runCreateGroup(): Promise<void> {
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await createGroup({
      track: newTrack,
      level: newLevel.trim(),
      gender: newGender,
      code: effectiveCode,
      nameBn: newNameBn.trim(),
    });
    setBusy(false);
    if (res.error || !res.data?.createSubjectGroup) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.gmCreated);
    // Drop straight into the new group so the next step (moving students in) is
    // one tap away rather than a hunt back through the picker.
    setGroupId(res.data.createSubjectGroup.id);
    setNewLevel("");
    setNewNameBn("");
    setNewCode("");
    setCodeEdited(false);
    setShowNew(false);
    refetchGroups({ requestPolicy: "network-only" });
  }

  async function runSetActive(active: boolean): Promise<void> {
    if (!selectedGroup) return;
    if (!active && !(await confirmAction({ confirmLabel: STR.gmRetire }))) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await setGroupActive({ groupId: selectedGroup.id, active });
    setBusy(false);
    if (res.error || !res.data?.setSubjectGroupActive) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(active ? STR.gmRestored : STR.gmRetired);
    // A retired group leaves the default list — keep it visible so the admin can
    // see what just happened instead of the selection vanishing.
    if (!active) setShowRetired(true);
    refetchGroups({ requestPolicy: "network-only" });
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

        <ChipRow>
          <Chip
            label={showNew ? `✕ ${STR.gmNewGroup}` : `＋ ${STR.gmNewGroup}`}
            selected={showNew}
            onPress={() => setShowNew((v) => !v)}
          />
          <Chip
            label={STR.gmShowRetired}
            selected={showRetired}
            onPress={() => setShowRetired((v) => !v)}
          />
        </ChipRow>

        {showNew ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.gmNewGroup}</Body>
            <Muted>{STR.gmNewGroupHint}</Muted>

            <Body style={{ marginTop: space(2) }}>{STR.gmTrack}</Body>
            <ChipRow>
              {PERIOD_TRACKS.filter((t) => t === "quran" || t === "arabic").map((t) => (
                <Chip
                  key={t}
                  label={periodTrackLabel(t)}
                  selected={newTrack === t}
                  onPress={() => setNewTrack(t)}
                />
              ))}
            </ChipRow>

            <Body style={{ marginTop: space(2) }}>{STR.gmGender}</Body>
            <ChipRow>
              {GROUP_GENDERS.map((g) => (
                <Chip
                  key={g}
                  label={groupGenderLabel(g)}
                  selected={newGender === g}
                  onPress={() => setNewGender(g)}
                />
              ))}
            </ChipRow>

            <Field
              label={STR.gmLevel}
              value={newLevel}
              onChangeText={setNewLevel}
              placeholder={STR.gmLevelHint}
            />
            <Field label={STR.gmNameBn} value={newNameBn} onChangeText={setNewNameBn} />
            <Field
              label={STR.gmCode}
              value={effectiveCode}
              onChangeText={(v) => {
                setCodeEdited(true);
                setNewCode(v);
              }}
              helper={STR.gmCodeHint}
            />

            <Button
              title={STR.gmCreate}
              onPress={() => void runCreateGroup()}
              loading={busy}
              disabled={busy || !newLevel.trim() || !newNameBn.trim() || !effectiveCode.trim()}
              style={{ marginTop: space(2) }}
            />
          </Card>
        ) : null}

        {/* Retire / restore the selected group — the other half of creating one.
            Retiring is refused server-side while members remain (D-#500). */}
        {selectedGroup ? (
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "700" }}>{selectedGroup.nameBn}</Body>
                <Muted>
                  {selectedGroup.code} · {groupGenderLabel(selectedGroup.gender)}
                </Muted>
              </View>
              {selectedGroup.active === false ? (
                <>
                  <Badge text={STR.gmInactive} tone="muted" />
                  <Button title={STR.gmRestore} onPress={() => void runSetActive(true)} disabled={busy} />
                </>
              ) : (
                <Button
                  title={STR.gmRetire}
                  variant="secondary"
                  onPress={() => void runSetActive(false)}
                  disabled={busy}
                />
              )}
            </View>
            {selectedGroup.active !== false && members.length > 0 ? (
              <Muted>{STR.gmRetireBlocked}</Muted>
            ) : null}
          </Card>
        ) : null}

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

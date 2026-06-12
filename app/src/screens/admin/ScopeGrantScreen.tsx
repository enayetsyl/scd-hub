/**
 * ScopeGrantScreen (S15 / J5.4, J5.7) — assign / extend / revoke proxy (cover)
 * grants. Requires user:manage (Principal). The active grants list (proxyGrants,
 * Slice-4 follow-up) drives extend/revoke — no pasted GRANT_IDs; teachers and
 * class/section come from name pickers. Teaching/supervisory grant CRUD needs
 * server mutations not yet exposed — see STATUS follow-ups.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { ASSIGN_PROXY, REVOKE_PROXY, EXTEND_PROXY, CLASSES_QUERY, PROXY_GRANTS_QUERY, TEACHERS_QUERY } from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Button, Field, Select, Notice, Divider, EmptyState, Loader } from "../../components/ui";
import { TeacherSelect, AcademicYearSelect } from "../../components/selects";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "ScopeGrant">;

export default function ScopeGrantScreen(_props: Props): React.ReactElement {
  // Assign
  const [covering, setCovering] = useState("");
  const [absent, setAbsent] = useState("");
  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [duration, setDuration] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignMsg, setAssignMsg] = useState<string | null>(null);
  const [assignErr, setAssignErr] = useState<string | null>(null);

  // Revoke
  const [revokeId, setRevokeId] = useState("");
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeMsg, setRevokeMsg] = useState<string | null>(null);

  // Extend
  const [extendId, setExtendId] = useState("");
  const [addDays, setAddDays] = useState("");
  const [extendBusy, setExtendBusy] = useState(false);
  const [extendMsg, setExtendMsg] = useState<string | null>(null);

  const [, assignProxy] = useMutation(ASSIGN_PROXY);
  const [, revokeProxy] = useMutation(REVOKE_PROXY);
  const [, extendProxy] = useMutation(EXTEND_PROXY);

  // Active grants list (Slice-4 follow-up): pick a grant to extend/revoke.
  const [{ data: grantData, fetching: grantsFetching }, refetchGrants] = useQuery({
    query: PROXY_GRANTS_QUERY,
    variables: {},
  });
  const grants = grantData?.proxyGrants ?? [];
  const [{ data: teacherData }] = useQuery({ query: TEACHERS_QUERY });
  const teacherName = (id: string | null): string => {
    if (!id) return "—";
    return teacherData?.teachers.find((t) => t.id === id)?.name ?? id;
  };
  const reloadGrants = (): void => refetchGrants({ requestPolicy: "network-only" });

  // Class/section cascade: pick year → class → section (no pasting ids).
  const [{ data: classData }] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: yearId },
    pause: yearId === "",
  });
  const classes = classData?.classes ?? [];
  const classOptions = classes.map((c) => ({ label: c.nameBn, value: c.id }));
  const sectionOptions = (classes.find((c) => c.id === classId)?.sections ?? []).map((s) => ({
    label: s.nameBn,
    value: s.id,
    hint: s.code,
  }));
  function onYear(v: string): void {
    setYearId(v);
    setClassId("");
    setSectionId("");
  }
  function onClass(v: string): void {
    setClassId(v);
    setSectionId("");
  }

  async function onAssign(): Promise<void> {
    if (!covering.trim() || !classId.trim() || !sectionId.trim() || !duration.trim() || assignBusy) return;
    const days = Number(duration);
    if (Number.isNaN(days) || days < 1) {
      setAssignErr(STR.errGeneric);
      return;
    }
    let startIso: string;
    if (startDate.trim()) {
      const d = new Date(startDate.trim());
      if (Number.isNaN(d.getTime())) {
        setAssignErr(STR.invalidDate);
        return;
      }
      startIso = d.toISOString();
    } else {
      startIso = new Date().toISOString();
    }
    setAssignBusy(true);
    setAssignErr(null);
    setAssignMsg(null);
    const res = await assignProxy({
      coveringTeacherId: covering.trim(),
      absentTeacherId: absent.trim() || null,
      classId: classId.trim(),
      sectionId: sectionId.trim(),
      startDate: startIso,
      durationDays: days,
    });
    setAssignBusy(false);
    if (res.error || !res.data?.assignProxy) {
      setAssignErr(friendlyError(res.error));
      return;
    }
    setAssignMsg(STR.grantCreated);
    reloadGrants();
  }

  async function onRevoke(grantId: string): Promise<void> {
    if (revokeBusy) return;
    setRevokeId(grantId);
    setRevokeBusy(true);
    setRevokeMsg(null);
    const res = await revokeProxy({ grantId });
    setRevokeBusy(false);
    setRevokeMsg(res.error ? friendlyError(res.error) : STR.actionDone);
    if (!res.error) {
      setRevokeId("");
      reloadGrants();
    }
  }

  async function onExtend(): Promise<void> {
    if (!extendId.trim() || !addDays.trim() || extendBusy) return;
    const days = Number(addDays);
    if (Number.isNaN(days) || days < 1) {
      setExtendMsg(STR.errGeneric);
      return;
    }
    setExtendBusy(true);
    setExtendMsg(null);
    const res = await extendProxy({ grantId: extendId.trim(), additionalDays: days });
    setExtendBusy(false);
    setExtendMsg(res.error ? friendlyError(res.error) : STR.actionDone);
    if (!res.error) {
      setExtendId("");
      setAddDays("");
      reloadGrants();
    }
  }

  return (
    <Screen scroll>
      <H2>{STR.scopeGrants}</H2>

      {/* Assign proxy */}
      <Card>
        <Muted style={{ fontWeight: "700", marginBottom: 8 }}>{STR.assignProxy}</Muted>
        <TeacherSelect label={STR.coveringTeacher} value={covering} onChange={setCovering} />
        <TeacherSelect label={STR.absentTeacher} value={absent} onChange={setAbsent} />
        <AcademicYearSelect label={STR.academicYear} value={yearId} onChange={onYear} />
        <Select
          label={STR.class}
          value={classId === "" ? null : classId}
          options={classOptions}
          onChange={onClass}
          placeholder={STR.selectClass}
        />
        <Select
          label={STR.section}
          value={sectionId === "" ? null : sectionId}
          options={sectionOptions}
          onChange={setSectionId}
          placeholder={STR.selectSection}
        />
        <Field label={`${STR.startDate} (YYYY-MM-DD)`} value={startDate} onChangeText={setStartDate} placeholder="2026-06-10" />
        <Field label={STR.durationDays} value={duration} onChangeText={setDuration} keyboardType="numeric" placeholder="5" />
        {assignErr ? <Notice message={assignErr} tone="danger" /> : null}
        {assignMsg ? <Notice message={assignMsg} tone="ok" /> : null}
        <Button title={assignBusy ? STR.saving : STR.assignProxy} onPress={onAssign} loading={assignBusy} />
      </Card>

      <Divider />

      {/* Active grants — pick one to extend or revoke (no pasted GRANT_IDs) */}
      <H2>{STR.activeProxyGrants}</H2>
      {extendMsg ? <Notice message={extendMsg} tone="ok" /> : null}
      {revokeMsg ? <Notice message={revokeMsg} tone="ok" /> : null}
      {grantsFetching ? (
        <Loader label={STR.loading} />
      ) : grants.length === 0 ? (
        <EmptyState message={STR.noActiveGrants} />
      ) : (
        grants.map((g) => (
          <Card key={g.id}>
            <Body style={{ fontWeight: "700" }}>{teacherName(g.coveringTeacherId)}</Body>
            {g.absentTeacherId ? (
              <Muted>
                {STR.absentTeacher}: {teacherName(g.absentTeacherId)}
              </Muted>
            ) : null}
            <Muted>
              {STR.startDate}: {g.startDate ? g.startDate.slice(0, 10) : "—"} · {STR.durationDays}:{" "}
              {g.durationDays ?? "—"} · {g.proxyStatus ?? ""}
            </Muted>
            {extendId === g.id ? (
              <View style={{ marginTop: space(2) }}>
                <Field
                  label={STR.durationDays}
                  value={addDays}
                  onChangeText={setAddDays}
                  keyboardType="numeric"
                  placeholder="3"
                />
                <Button
                  title={extendBusy ? STR.saving : STR.extend}
                  onPress={onExtend}
                  loading={extendBusy}
                  variant="secondary"
                />
              </View>
            ) : (
              <View style={{ flexDirection: "row", marginTop: space(2) }}>
                <Button
                  title={STR.extend}
                  variant="secondary"
                  style={{ marginRight: space(2) }}
                  onPress={() => {
                    setExtendId(g.id);
                    setAddDays("");
                    setExtendMsg(null);
                  }}
                />
                <Button
                  title={revokeBusy && revokeId === g.id ? STR.saving : STR.revoke}
                  variant="danger"
                  loading={revokeBusy && revokeId === g.id}
                  onPress={() => onRevoke(g.id)}
                />
              </View>
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}

/**
 * ScopeGrantScreen (S15 / J5.4, J5.7) — assign / extend / revoke proxy (cover)
 * grants. Requires user:manage (Principal). IDs are entered directly (the server
 * exposes no teacher/grant list queries yet); class/section prefill from the
 * current section context when available. Teaching/supervisory grant CRUD needs
 * server mutations not yet exposed — see STATUS follow-ups.
 */
import React, { useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation } from "urql";
import { ASSIGN_PROXY, REVOKE_PROXY, EXTEND_PROXY } from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, H2, Muted, Card, Button, Field, Notice, Divider } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";

type Props = NativeStackScreenProps<AdminStackParamList, "ScopeGrant">;

export default function ScopeGrantScreen(_props: Props): React.ReactElement {
  const { selection } = useSectionContext();

  // Assign
  const [covering, setCovering] = useState("");
  const [absent, setAbsent] = useState("");
  const [classId, setClassId] = useState(selection.classId ?? "");
  const [sectionId, setSectionId] = useState(selection.sectionId ?? "");
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
    setAssignMsg(`${STR.grantCreated} (${res.data.assignProxy.grantId})`);
  }

  async function onRevoke(): Promise<void> {
    if (!revokeId.trim() || revokeBusy) return;
    setRevokeBusy(true);
    setRevokeMsg(null);
    const res = await revokeProxy({ grantId: revokeId.trim() });
    setRevokeBusy(false);
    setRevokeMsg(res.error ? friendlyError(res.error) : STR.actionDone);
    if (!res.error) setRevokeId("");
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
    if (!res.error) setExtendId("");
  }

  return (
    <Screen scroll>
      <H2>{STR.scopeGrants}</H2>

      {/* Assign proxy */}
      <Card>
        <Muted style={{ fontWeight: "700", marginBottom: 8 }}>{STR.assignProxy}</Muted>
        <Field label="COVERING_TEACHER_ID" value={covering} onChangeText={setCovering} />
        <Field label="ABSENT_TEACHER_ID (optional)" value={absent} onChangeText={setAbsent} />
        <Field label="CLASS_ID" value={classId} onChangeText={setClassId} />
        <Field label="SECTION_ID" value={sectionId} onChangeText={setSectionId} />
        <Field label="START_DATE (YYYY-MM-DD, default today)" value={startDate} onChangeText={setStartDate} placeholder="2026-06-10" />
        <Field label="DURATION_DAYS" value={duration} onChangeText={setDuration} keyboardType="numeric" placeholder="5" />
        {assignErr ? <Notice message={assignErr} tone="danger" /> : null}
        {assignMsg ? <Notice message={assignMsg} tone="ok" /> : null}
        <Button title={assignBusy ? STR.saving : STR.assignProxy} onPress={onAssign} loading={assignBusy} />
      </Card>

      <Divider />

      {/* Extend */}
      <Card>
        <Muted style={{ fontWeight: "700", marginBottom: 8 }}>{STR.extend}</Muted>
        <Field label="GRANT_ID" value={extendId} onChangeText={setExtendId} />
        <Field label="ADDITIONAL_DAYS" value={addDays} onChangeText={setAddDays} keyboardType="numeric" placeholder="3" />
        {extendMsg ? <Notice message={extendMsg} tone="ok" /> : null}
        <Button title={extendBusy ? STR.saving : STR.extend} onPress={onExtend} loading={extendBusy} variant="secondary" />
      </Card>

      <Divider />

      {/* Revoke */}
      <Card>
        <Muted style={{ fontWeight: "700", marginBottom: 8 }}>{STR.revoke}</Muted>
        <Field label="GRANT_ID" value={revokeId} onChangeText={setRevokeId} />
        {revokeMsg ? <Notice message={revokeMsg} tone="ok" /> : null}
        <Button title={revokeBusy ? STR.saving : STR.revoke} onPress={onRevoke} loading={revokeBusy} variant="danger" />
      </Card>
    </Screen>
  );
}

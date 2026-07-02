/**
 * GuardianCredentialsScreen (D-#59) — provision ONE shared login per family,
 * keyed by the family's contact phone. Both parents use it; it reaches every
 * sibling on that phone. The generated password is shown ONCE; the Principal/
 * Office shares it via WhatsApp (wa.me deep link — manual send, ADR-003).
 * Gated on guardian:link (Principal + Office).
 */
import React, { useMemo, useState } from "react";
import { Linking, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  GUARDIAN_CREDENTIAL_CANDIDATES,
  GUARDIANS_QUERY,
  LINK_GUARDIAN_TO_STUDENT,
  UNLINK_GUARDIAN_FROM_STUDENT,
  PROVISION_GUARDIAN_LOGIN,
  RESET_GUARDIAN_PASSWORD,
  CLASSES_QUERY,
  ROSTER_QUERY,
  type ProvisionedCredentialT,
} from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Row, Badge, Button, Loader, Notice, Divider, Field, Select, EmptyState } from "../../components/ui";
import { AcademicYearSelect } from "../../components/selects";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "GuardianCredentials">;

export default function GuardianCredentialsScreen(_props: Props): React.ReactElement {
  const [{ data, fetching, error }, refetch] = useQuery({ query: GUARDIAN_CREDENTIAL_CANDIDATES });
  const [{ data: guardiansData }, refetchGuardians] = useQuery({ query: GUARDIANS_QUERY });
  const [, linkGuardian] = useMutation(LINK_GUARDIAN_TO_STUDENT);
  const [, unlinkGuardian] = useMutation(UNLINK_GUARDIAN_FROM_STUDENT);
  const [, provision] = useMutation(PROVISION_GUARDIAN_LOGIN);
  const [, reset] = useMutation(RESET_GUARDIAN_PASSWORD);

  const [busyPhone, setBusyPhone] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionedCredentialT | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [manualYearId, setManualYearId] = useState("");
  const [manualClassId, setManualClassId] = useState("");
  const [manualSectionId, setManualSectionId] = useState("");
  const [manualGuardianId, setManualGuardianId] = useState("");
  const [manualStudentId, setManualStudentId] = useState("");
  const [manualRelation, setManualRelation] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const [linkMsg, setLinkMsg] = useState<string | null>(null);
  const [unlinkBusyId, setUnlinkBusyId] = useState<string | null>(null);

  const [{ data: yearData }] = useQuery({ query: CLASSES_QUERY, variables: { academicYearId: manualYearId }, pause: manualYearId === "" });
  const classOptions = (yearData?.classes ?? []).map((c) => ({ label: c.nameBn, value: c.id }));
  const sectionOptions = (yearData?.classes.find((c) => c.id === manualClassId)?.sections ?? []).map((s) => ({
    label: s.nameBn,
    value: s.id,
    hint: s.code,
  }));
  const [{ data: rosterData }, refetchRoster] = useQuery({
    query: ROSTER_QUERY,
    variables: { sectionId: manualSectionId },
    pause: manualSectionId === "",
  });

  const guardianOptions = useMemo(
    () =>
      (guardiansData?.guardians ?? [])
        .filter((g) => g.active)
        .map((g) => ({
          label: g.name,
          value: g.id,
          hint: g.phone ?? g.identifierKind,
        })),
    [guardiansData],
  );
  const studentOptions = useMemo(
    () =>
      (rosterData?.studentsInSection ?? []).map((s) => ({
        label: s.name,
        value: s.id,
        hint: s.schoolId,
      })),
    [rosterData],
  );
  const selectedStudent = rosterData?.studentsInSection.find((s) => s.id === manualStudentId) ?? null;

  async function onGenerate(phone: string, hasLogin: boolean, guardianId: string | null): Promise<void> {
    if (busyPhone) return;
    setBusyPhone(phone);
    setErr(null);
    setResult(null);
    setCopied(false);
    let cred: ProvisionedCredentialT | null = null;
    let resErr;
    if (hasLogin && guardianId) {
      const res = await reset({ guardianId });
      resErr = res.error;
      cred = res.data?.resetGuardianPassword ?? null;
    } else {
      const res = await provision({ phone });
      resErr = res.error;
      cred = res.data?.provisionGuardianLogin ?? null;
    }
    setBusyPhone(null);
    if (resErr || !cred) {
      setErr(friendlyError(resErr));
      return;
    }
    setResult(cred);
    refetch({ requestPolicy: "network-only" });
    refetchGuardians({ requestPolicy: "network-only" });
  }

  async function onLink(): Promise<void> {
    if (linkBusy) return;
    if (!manualGuardianId || !manualStudentId || !manualRelation.trim()) {
      setLinkErr(STR.errGeneric);
      return;
    }
    setLinkBusy(true);
    setLinkErr(null);
    setLinkMsg(null);
    const res = await linkGuardian({ guardianId: manualGuardianId, studentId: manualStudentId, relation: manualRelation.trim() });
    setLinkBusy(false);
    if (res.error || !res.data?.linkGuardianToStudent) {
      setLinkErr(friendlyError(res.error));
      return;
    }
    setLinkMsg(STR.actionDone);
    refetchRoster({ requestPolicy: "network-only" });
    refetchGuardians({ requestPolicy: "network-only" });
  }

  async function onUnlink(studentId: string, guardianId: string): Promise<void> {
    if (unlinkBusyId) return;
    setUnlinkBusyId(`${guardianId}:${studentId}`);
    setLinkErr(null);
    setLinkMsg(null);
    const res = await unlinkGuardian({ guardianId, studentId });
    setUnlinkBusyId(null);
    if (res.error || !res.data?.unlinkGuardianFromStudent) {
      setLinkErr(friendlyError(res.error));
      return;
    }
    setLinkMsg(STR.actionDone);
    refetchRoster({ requestPolicy: "network-only" });
  }

  async function onCopy(): Promise<void> {
    if (!result) return;
    await Clipboard.setStringAsync(`${STR.loginId}: ${result.identifier}\n${STR.generatedPassword}: ${result.password}`);
    setCopied(true);
  }

  const candidates = data?.guardianCredentialCandidates ?? [];

  return (
    <Screen scroll>
      <H2>{STR.guardianCredentials}</H2>
      <Notice message={STR.familyLoginHint} tone="warn" />

      {result ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{result.name}</Body>
          <Row label={STR.loginId} value={result.identifier} />
          <Row label={STR.generatedPassword} value={result.password} />
          <Row label={STR.childrenLabel} value={String(result.studentCount)} />
          <Notice message={STR.credentialOnceWarning} tone="warn" />
          <Button title={STR.shareWhatsApp} onPress={() => Linking.openURL(result.waLink)} style={{ marginTop: space(2) }} />
          <Button title={copied ? STR.copied : STR.copy} onPress={onCopy} variant="secondary" style={{ marginTop: space(1) }} />
        </Card>
      ) : null}

      {err ? <Notice message={err} tone="danger" /> : null}

      <Divider />

      {fetching ? (
        <Loader label={STR.loading} />
      ) : error ? (
        <Notice message={friendlyError(error)} tone="danger" />
      ) : candidates.length === 0 ? (
        <Muted>{STR.noGuardianCandidates}</Muted>
      ) : (
        candidates.map((c) => (
          <Card key={c.phone}>
            <Body style={{ fontWeight: "700" }}>{c.suggestedName}</Body>
            <Row label={STR.loginId} value={c.phone} />
            {c.students.map((s) => (
              <Row key={s.id} label={s.className || STR.studentName} value={s.name} />
            ))}
            <View style={{ marginTop: space(1), flexDirection: "row" }}>
              <Badge text={c.loginEnabled ? STR.loginExistsLabel : STR.noLoginLabel} tone={c.loginEnabled ? "ok" : "muted"} />
            </View>
            <Button
              title={c.loginEnabled ? STR.resetPassword : STR.generateLogin}
              onPress={() => onGenerate(c.phone, c.loginEnabled, c.guardianId)}
              loading={busyPhone === c.phone}
              variant={c.loginEnabled ? "secondary" : "primary"}
              style={{ marginTop: space(2) }}
            />
          </Card>
        ))
      )}

      <Divider />

      <H2>{STR.guardianLinkTitle}</H2>
      <Notice message={STR.guardianLinkHint} tone="info" />
      {linkErr ? <Notice message={linkErr} tone="danger" /> : null}
      {linkMsg ? <Notice message={linkMsg} tone="ok" /> : null}

      <AcademicYearSelect label={STR.academicYear} value={manualYearId} onChange={setManualYearId} />
      <Select
        label={STR.class}
        value={manualClassId === "" ? null : manualClassId}
        options={classOptions}
        onChange={(v) => {
          setManualClassId(v);
          setManualSectionId("");
          setManualStudentId("");
        }}
        placeholder={STR.selectClass}
      />
      <Select
        label={STR.section}
        value={manualSectionId === "" ? null : manualSectionId}
        options={sectionOptions}
        onChange={(v) => {
          setManualSectionId(v);
          setManualStudentId("");
        }}
        placeholder={STR.selectSection}
      />
      <Select
        label={STR.guardianSelect}
        value={manualGuardianId === "" ? null : manualGuardianId}
        options={guardianOptions}
        onChange={setManualGuardianId}
        placeholder={STR.guardianSelect}
        emptyText={STR.noGuardianCandidates}
      />
      <Select
        label={STR.studentSelect}
        value={manualStudentId === "" ? null : manualStudentId}
        options={studentOptions}
        onChange={setManualStudentId}
        placeholder={STR.studentSelect}
        emptyText={STR.noStudents}
      />
      <Field
        label={STR.relationField}
        value={manualRelation}
        onChangeText={setManualRelation}
        placeholder={STR.relationHint}
      />
      <Button
        title={linkBusy ? STR.saving : STR.linkGuardian}
        onPress={onLink}
        loading={linkBusy}
        disabled={linkBusy || !manualGuardianId || !manualStudentId || !manualRelation.trim()}
      />

      <Divider />

      <H2>{STR.guardianLinkedChildren}</H2>
      {!selectedStudent ? (
        <EmptyState message={STR.studentSelect} />
      ) : selectedStudent.guardians.length === 0 ? (
        <Muted>{STR.noGuardians}</Muted>
      ) : (
        <Card>
          <Body style={{ fontWeight: "700" }}>{selectedStudent.name}</Body>
          {selectedStudent.guardians.map((g) => (
            <View
              key={g.id}
              style={{ marginTop: space(2), flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
            >
              <View style={{ flex: 1 }}>
                <Body>{g.name}</Body>
                <Muted>{g.relation}</Muted>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Badge text={g.loginEnabled ? STR.loginExistsLabel : STR.noLoginLabel} tone={g.loginEnabled ? "ok" : "muted"} />
                <Button
                  title={unlinkBusyId === `${g.id}:${selectedStudent.id}` ? STR.saving : STR.unlinkGuardian}
                  onPress={() => onUnlink(selectedStudent.id, g.id)}
                  loading={unlinkBusyId === `${g.id}:${selectedStudent.id}`}
                  variant="danger"
                  style={{ marginTop: space(1) }}
                />
              </View>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

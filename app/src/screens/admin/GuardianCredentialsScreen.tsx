/**
 * GuardianCredentialsScreen (D-#59) — provision ONE shared login per family,
 * keyed by the family's contact phone. Both parents use it; it reaches every
 * sibling on that phone. The generated password is shown ONCE; the Principal/
 * Office shares it via WhatsApp (wa.me deep link — manual send, ADR-003).
 * Gated on guardian:link (Principal + Office).
 */
import React, { useState } from "react";
import { Linking, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  GUARDIAN_CREDENTIAL_CANDIDATES,
  PROVISION_GUARDIAN_LOGIN,
  RESET_GUARDIAN_PASSWORD,
  type ProvisionedCredentialT,
} from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Row, Badge, Button, Loader, Notice, Divider } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "GuardianCredentials">;

export default function GuardianCredentialsScreen(_props: Props): React.ReactElement {
  const [{ data, fetching, error }, refetch] = useQuery({ query: GUARDIAN_CREDENTIAL_CANDIDATES });
  const [, provision] = useMutation(PROVISION_GUARDIAN_LOGIN);
  const [, reset] = useMutation(RESET_GUARDIAN_PASSWORD);

  const [busyPhone, setBusyPhone] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionedCredentialT | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    </Screen>
  );
}

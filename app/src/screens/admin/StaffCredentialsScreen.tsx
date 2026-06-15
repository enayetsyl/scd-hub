/**
 * StaffCredentialsScreen (D-#60) — provision a phone-number login for each
 * teacher / office staff member (role mapped from the HR category). Support
 * staff and phoneless staff are flagged not-provisionable. The generated
 * password is shown ONCE and shared via WhatsApp (wa.me, manual — ADR-003).
 * Gated on user:manage (Principal only).
 */
import React, { useState } from "react";
import { Linking, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  STAFF_CREDENTIAL_CANDIDATES,
  PROVISION_STAFF_LOGIN,
  RESET_STAFF_PASSWORD,
  type ProvisionedCredentialT,
} from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Row, Badge, Button, Loader, Notice, Divider, Field } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "StaffCredentials">;

export default function StaffCredentialsScreen(_props: Props): React.ReactElement {
  const [{ data, fetching, error }, refetch] = useQuery({ query: STAFF_CREDENTIAL_CANDIDATES });
  const [, provision] = useMutation(PROVISION_STAFF_LOGIN);
  const [, reset] = useMutation(RESET_STAFF_PASSWORD);

  const [busyId, setBusyId] = useState<string | null>(null);
  // The freshly-provisioned credential is rendered INLINE on its own card (keyed
  // by staffId) so the list never reorders — the card stays where the user tapped.
  const [result, setResult] = useState<ProvisionedCredentialT | null>(null);
  const [resultStaffId, setResultStaffId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState("");

  async function onGenerate(staffId: string, hasLogin: boolean, userId: string | null): Promise<void> {
    if (busyId) return;
    setBusyId(staffId);
    setErr(null);
    setResult(null);
    setResultStaffId(null);
    setCopied(false);
    let cred: ProvisionedCredentialT | null = null;
    let resErr;
    if (hasLogin && userId) {
      const res = await reset({ userId });
      resErr = res.error;
      cred = res.data?.resetStaffPassword ?? null;
    } else {
      const res = await provision({ staffProfileId: staffId });
      resErr = res.error;
      cred = res.data?.provisionStaffLogin ?? null;
    }
    setBusyId(null);
    if (resErr || !cred) {
      setErr(friendlyError(resErr));
      return;
    }
    setResult(cred);
    setResultStaffId(staffId);
    refetch({ requestPolicy: "network-only" });
  }

  async function onCopy(): Promise<void> {
    if (!result) return;
    await Clipboard.setStringAsync(`${STR.loginId}: ${result.identifier}\n${STR.generatedPassword}: ${result.password}`);
    setCopied(true);
  }

  const allCandidates = data?.staffCredentialCandidates ?? [];
  const q = search.trim().toLowerCase();
  const candidates = q
    ? allCandidates.filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? "").toLowerCase().includes(q))
    : allCandidates;

  return (
    <Screen scroll>
      <H2>{STR.staffCredentials}</H2>
      <Notice message={STR.staffLoginHint} tone="warn" />

      {err ? <Notice message={err} tone="danger" /> : null}

      <Field label={undefined} value={search} onChangeText={setSearch} placeholder={STR.searchStaff} />

      <Divider />

      {fetching ? (
        <Loader label={STR.loading} />
      ) : error ? (
        <Notice message={friendlyError(error)} tone="danger" />
      ) : allCandidates.length === 0 ? (
        <Muted>{STR.noProvisionableStaff}</Muted>
      ) : candidates.length === 0 ? (
        <Muted>{STR.noStaffMatch}</Muted>
      ) : (
        candidates.map((c) => {
          const showCred = result && resultStaffId === c.staffId;
          return (
            <Card key={c.staffId}>
              <Body style={{ fontWeight: "700" }}>{c.name}</Body>
              <Row label={STR.category} value={c.category} />
              {c.phone ? <Row label={STR.loginId} value={c.phone} /> : null}
              {c.mappedRole ? <Row label={STR.role} value={c.mappedRole} /> : null}
              <View style={{ marginTop: space(1), flexDirection: "row" }}>
                <Badge
                  text={c.loginExists ? STR.loginExistsLabel : c.provisionable ? STR.noLoginLabel : (c.reason ?? STR.noLoginLabel)}
                  tone={c.loginExists ? "ok" : c.provisionable ? "muted" : "warn"}
                />
              </View>
              {c.provisionable ? (
                <Button
                  title={c.loginExists ? STR.resetPassword : STR.generateLogin}
                  onPress={() => onGenerate(c.staffId, c.loginExists, c.userId)}
                  loading={busyId === c.staffId}
                  variant={c.loginExists ? "secondary" : "primary"}
                  style={{ marginTop: space(2) }}
                />
              ) : null}

              {showCred ? (
                <View style={{ marginTop: space(2) }}>
                  <Row label={STR.generatedPassword} value={result!.password} />
                  <Notice message={STR.credentialOnceWarning} tone="warn" />
                  <Button title={STR.shareWhatsApp} onPress={() => Linking.openURL(result!.waLink)} style={{ marginTop: space(2) }} />
                  <Button title={copied ? STR.copied : STR.copy} onPress={onCopy} variant="secondary" style={{ marginTop: space(1) }} />
                </View>
              ) : null}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

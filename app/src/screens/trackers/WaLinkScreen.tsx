/**
 * WaLinkScreen (S13 / J4.2, ADR-003) — build a wa.me deep link for a
 * non-submitter's guardian. The server's waLink query is a pure builder (no
 * dispatch); the teacher copies the link and sends it manually. There is no
 * "send" button by design.
 */
import React, { useState } from "react";
import * as Clipboard from "expo-clipboard";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { WA_LINK_QUERY } from "../../graphql/operations";
import type { TrackersStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Row, Button, Field, Loader, Notice } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<TrackersStackParamList, "WaLink">;

export default function WaLinkScreen({ route }: Props): React.ReactElement {
  const { studentName, setTitle } = route.params;
  const [phone, setPhone] = useState("");
  const [copied, setCopied] = useState(false);

  const [{ data, fetching, error }] = useQuery({
    query: WA_LINK_QUERY,
    variables: { guardianPhone: phone.trim(), studentName, setTitle },
    pause: phone.trim() === "",
  });

  const link = data?.waLink ?? null;

  async function onCopy(): Promise<void> {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    setCopied(true);
  }

  return (
    <Screen scroll>
      <H2>{STR.sendReminder}</H2>
      <Notice message={STR.waLinkHint} tone="warn" />

      <Card>
        <Row label={STR.studentName} value={studentName} />
        <Row label={STR.setType} value={setTitle} />
      </Card>

      <Field
        label={STR.guardianPhone}
        value={phone}
        onChangeText={(t) => {
          setPhone(t);
          setCopied(false);
        }}
        keyboardType="phone-pad"
        placeholder="01XXXXXXXXX"
      />

      {phone.trim() === "" ? null : fetching ? (
        <Loader label={STR.loading} />
      ) : error ? (
        <Notice message={friendlyError(error)} tone="danger" />
      ) : link ? (
        <Card>
          <Muted>wa.me</Muted>
          <Body style={{ marginTop: 4 }} >{link}</Body>
          <Button title={copied ? STR.copied : STR.copy} onPress={onCopy} variant="secondary" style={{ marginTop: space(2) }} />
        </Card>
      ) : null}
    </Screen>
  );
}

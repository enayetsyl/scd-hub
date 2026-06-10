/**
 * ImportScreen (S14 / J1.1) — pick or paste an envelope JSON → importEnvelope →
 * show the gate result (verdict + failChecks + warnings + advisories). Requires
 * content:import (Principal/Office). The paste field is the universal path; the
 * file picker fills it on web.
 */
import React, { useState } from "react";
import { View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation } from "urql";
import { IMPORT_ENVELOPE, type ImportResultT } from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Button, Field, Notice, Divider } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "Import">;

function StringList({ title, items }: { title: string; items: string[] }): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <View style={{ marginTop: space(2) }}>
      <Muted style={{ fontWeight: "700" }}>{title}</Muted>
      {items.map((it, i) => (
        <Body key={i} style={{ marginTop: 2 }}>
          • {it}
        </Body>
      ))}
    </View>
  );
}

export default function ImportScreen(_props: Props): React.ReactElement {
  const [envelope, setEnvelope] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResultT | null>(null);
  const [, importEnvelope] = useMutation(IMPORT_ENVELOPE);

  async function pickFile(): Promise<void> {
    setError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "application/json", copyToCacheDirectory: true });
      if (res.canceled) return;
      const asset = res.assets?.[0];
      if (!asset?.uri) return;
      const txt = await fetch(asset.uri).then((r) => r.text());
      setEnvelope(txt);
    } catch {
      setError(STR.errGeneric);
    }
  }

  async function onImport(): Promise<void> {
    if (!envelope.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await importEnvelope({ envelopeJson: envelope });
    setBusy(false);
    if (res.error || !res.data?.importEnvelope) {
      setError(friendlyError(res.error));
      return;
    }
    setResult(res.data.importEnvelope);
  }

  const pass = result?.verdict === "PASS";

  return (
    <Screen scroll>
      <H2>{STR.importContent}</H2>

      <Button title={STR.pickFile} variant="secondary" onPress={pickFile} />
      <View style={{ height: space(2) }} />
      <Field label="ENVELOPE_JSON" value={envelope} onChangeText={setEnvelope} multiline placeholder='{ "doc_type": "session_plan", ... }' />

      {error ? <Notice message={error} tone="danger" /> : null}

      <Button title={busy ? STR.importing : STR.importContent} onPress={onImport} loading={busy} disabled={!envelope.trim()} />

      {result ? (
        <>
          <Divider />
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Muted>{STR.verdict}</Muted>
              <Badge text={result.verdict} tone={pass ? "ok" : "danger"} />
            </View>
            <StringList title={STR.failChecks} items={result.failChecks} />
            <StringList title={STR.warnings} items={result.warnings} />
            <StringList title={STR.advisories} items={result.advisories} />
            {result.artifactId ? <Muted style={{ marginTop: space(2) }}>artifactId: {result.artifactId}</Muted> : null}
            <Muted>batchId: {result.batchId}</Muted>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

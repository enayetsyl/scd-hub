/**
 * ImportScreen (S14 / J1.1) — upload content and run it through the import gate.
 * Accepts a Project-03 plan as a .json + .md pair (the server auto-wraps it into
 * an envelope) or a single built envelope .json; you can also paste a built
 * envelope. Pairs are matched by filename stem server-side; orphans are rejected
 * with a clear message. Requires content:import (Principal/Office).
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation } from "urql";
import { IMPORT_FILES, type ImportResultT, type ImportFileT } from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Button, Chip, ChipRow, Field, Notice, Divider } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "Import">;

const CURATION_OPTIONS: { value: string; label: string }[] = [
  { value: "KEEP_AS_IS", label: STR.curationKeepAsIs },
  { value: "NEEDS_REPLACEMENT", label: STR.curationNeedsReplacement },
  { value: "FLEXIBLE", label: STR.curationFlexible },
];

/** A question bank is a {stimuli,questions} collection — not an envelope or a plan. */
function looksLikeBank(content: string): boolean {
  try {
    const j = JSON.parse(content) as Record<string, unknown>;
    if (!j || typeof j !== "object") return false;
    if ("envelope_version" in j || "plan_type" in j) return false;
    return Array.isArray(j.questions) || Array.isArray(j.stimuli);
  } catch {
    return false;
  }
}

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
  const [files, setFiles] = useState<ImportFileT[]>([]);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResultT | null>(null);
  const [showEnvelope, setShowEnvelope] = useState(false);
  const [curationTag, setCurationTag] = useState("KEEP_AS_IS");
  const [unitTitle, setUnitTitle] = useState("");
  const [, importFiles] = useMutation(IMPORT_FILES);

  // A bank is a single .json collection; questions are app-rendered so any .md is ignored.
  const bankDetected = useMemo(
    () => files.some((f) => looksLikeBank(f.content)) || (paste.trim().length > 0 && looksLikeBank(paste)),
    [files, paste],
  );

  async function pickFiles(): Promise<void> {
    setError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (res.canceled) return;
      const picked = await Promise.all(
        (res.assets ?? []).map(async (a) => ({
          filename: a.name,
          content: await fetch(a.uri).then((r) => r.text()),
        })),
      );
      // Merge with any already-picked files, de-duped by filename.
      setFiles((prev) => {
        const map = new Map(prev.map((f) => [f.filename, f]));
        for (const p of picked) map.set(p.filename, p);
        return Array.from(map.values());
      });
    } catch {
      setError(STR.errGeneric);
    }
  }

  function removeFile(name: string): void {
    setFiles((prev) => prev.filter((f) => f.filename !== name));
  }

  async function onImport(): Promise<void> {
    if (busy) return;
    const payload: ImportFileT[] =
      files.length > 0
        ? files
        : paste.trim()
          ? [{ filename: "envelope.json", content: paste }]
          : [];
    if (payload.length === 0) return;

    setBusy(true);
    setError(null);
    setResult(null);
    setShowEnvelope(false);
    const res = await importFiles({
      files: payload,
      curationTag: bankDetected ? curationTag : undefined,
      unitTitle: bankDetected && unitTitle.trim() ? unitTitle.trim() : undefined,
    });
    setBusy(false);
    if (res.error || !res.data?.importFiles) {
      setError(friendlyError(res.error));
      return;
    }
    setResult(res.data.importFiles);
    if (res.data.importFiles.verdict === "PASS") {
      setFiles([]);
      setPaste("");
    }
  }

  const pass = result?.verdict === "PASS";
  const canImport = files.length > 0 || paste.trim().length > 0;

  return (
    <Screen scroll>
      <H2>{STR.importContent}</H2>
      <Notice message={STR.importHint} tone="warn" />

      <Button title={STR.pickFiles} variant="secondary" onPress={pickFiles} />

      {files.length > 0 ? (
        <Card>
          <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>
            {STR.selectedFiles} ({bnNum(files.length)})
          </Muted>
          {files.map((f) => (
            <View
              key={f.filename}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: space(1) }}
            >
              <Body style={{ flex: 1 }}>{f.filename}</Body>
              <Muted style={{ marginHorizontal: space(2) }}>{bnNum(Math.max(1, Math.round(f.content.length / 1024)))} KB</Muted>
              <Button title={STR.removeFile} variant="ghost" onPress={() => removeFile(f.filename)} />
            </View>
          ))}
          <Button title={STR.clearFiles} variant="ghost" onPress={() => setFiles([])} />
        </Card>
      ) : null}

      <Divider />
      <Field
        label={STR.pasteEnvelopeOptional}
        value={paste}
        onChangeText={setPaste}
        multiline
        placeholder='{ "envelope_version": "1.0", "doc_type": "session_plan", ... }'
      />

      {bankDetected ? (
        <Card>
          <Notice message={STR.questionBankDetected} tone="warn" />
          <Muted style={{ fontWeight: "700", marginTop: space(2), marginBottom: space(1) }}>{STR.curationTagLabel}</Muted>
          <ChipRow>
            {CURATION_OPTIONS.map((o) => (
              <Chip key={o.value} label={o.label} selected={curationTag === o.value} onPress={() => setCurationTag(o.value)} />
            ))}
          </ChipRow>
          <View style={{ marginTop: space(2) }}>
            <Field label={STR.unitTitleLabel} value={unitTitle} onChangeText={setUnitTitle} placeholder="Get Ready to Listen" />
          </View>
        </Card>
      ) : null}

      {error ? <Notice message={error} tone="danger" /> : null}

      <Button title={busy ? STR.importing : STR.importContent} onPress={onImport} loading={busy} disabled={!canImport} />

      {result ? (
        <>
          <Divider />
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Muted>{STR.verdict}</Muted>
              <Badge text={result.verdict} tone={pass ? "ok" : "danger"} />
            </View>
            {result.itemsTotal != null ? (
              <Muted style={{ marginTop: space(2) }}>
                {STR.bankImported}: {bnNum(result.itemsPassed ?? 0)}/{bnNum(result.itemsTotal)} {STR.bankItems}
              </Muted>
            ) : null}
            <StringList title={STR.failChecks} items={result.failChecks} />
            <StringList title={STR.warnings} items={result.warnings} />
            <StringList title={STR.advisories} items={result.advisories} />
            {result.artifactId ? <Muted style={{ marginTop: space(2) }}>artifactId: {result.artifactId}</Muted> : null}
            <Muted>batchId: {result.batchId}</Muted>
            {result.envelopeJson ? (
              <View style={{ marginTop: space(2) }}>
                <Muted style={{ fontWeight: "700" }}>{STR.envelopeAutoBuilt}</Muted>
                <Button
                  title={showEnvelope ? STR.hideEnvelope : STR.viewEnvelope}
                  variant="ghost"
                  onPress={() => setShowEnvelope((s) => !s)}
                />
                {showEnvelope ? <Body style={{ fontSize: 12, marginTop: space(1) }}>{result.envelopeJson}</Body> : null}
              </View>
            ) : null}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

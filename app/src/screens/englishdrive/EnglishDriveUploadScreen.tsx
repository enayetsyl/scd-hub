/**
 * EnglishDriveUploadScreen (D-#344, ED-1) — the Principal/Office import UI:
 * multi-file .md picker + drag-and-drop, per-file metadata parsed from the
 * filename and ALWAYS shown editable (owner override rule #4), a conflict
 * notice when the upload will replace an existing version ("v৫ → v৭
 * প্রতিস্থাপন হবে"), and an upload summary. Content travels as a GraphQL
 * string (the markdown is stored in the doc — class-note precedent).
 */
import React, { useCallback, useState } from "react";
import { Platform, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useMutation, useQuery } from "urql";
import { CLASS_LEVELS } from "@scd/shared";
import { ENGLISH_DRIVE_DOCS, UPLOAD_ENGLISH_DRIVE_DOC } from "../../graphql/englishDrive";
import { Screen, H2, Body, Muted, Card, Badge, Button, Field, Notice, Select, Divider } from "../../components/ui";
import { FileDropZone } from "../../components/FileDropZone";
import {
  ENGLISH_DRIVE_KINDS,
  englishDriveKindLabel,
  parseBlockList,
  parseEnglishDriveFilename,
  titleFromMarkdown,
} from "../../lib/englishDrive";
import { STR, bnNum, classLevelLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

interface StagedDoc {
  filename: string;
  content: string;
  classLevel: string | null;
  blockNumber: string;
  /** PT only (D-#347): the blocks it covers, as raw text ("3-5" / "3,4,5"). */
  blockNumbers: string;
  kind: string | null;
  /** Sequence within (block × kind): HW4 → "4". */
  seq: string;
  version: string;
  title: string;
}

interface UploadOutcome {
  filename: string;
  ok: boolean;
  replacedVersion: number | null;
  error?: string;
}

const intOrNull = (s: string): number | null => {
  const n = Number(s.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
};

export default function EnglishDriveUploadScreen(): React.ReactElement {
  const [staged, setStaged] = useState<StagedDoc[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<UploadOutcome[]>([]);
  const [, upload] = useMutation(UPLOAD_ENGLISH_DRIVE_DOC);

  // P/O see every class — the whole library, for the replace-conflict notice.
  const [existingQ, refetchExisting] = useQuery({ query: ENGLISH_DRIVE_DOCS, variables: {} });
  const existing = existingQ.data?.englishDriveDocs ?? [];

  // Scalar block is part of the identity only when set. PT is always block-less
  // (its blocks live in blockNumbers, never keyed) — AS too (D-#346/#347).
  const blockOf = (s: StagedDoc): number | null =>
    s.kind === "PT" ? null : intOrNull(s.blockNumber);
  // The blocks a PT covers (surfacing only), from the editable "covers blocks" field.
  const blocksOf = (s: StagedDoc): number[] =>
    s.kind === "PT" ? parseBlockList(s.blockNumbers) : [];

  const conflictVersion = (s: StagedDoc): number | null => {
    const cl = s.classLevel ? Number(s.classLevel) : null;
    const sq = intOrNull(s.seq);
    if (cl === null || sq === null || !s.kind) return null;
    const hit = existing.find(
      (d) =>
        d.classLevel === cl && d.blockNumber === blockOf(s) && d.kind === s.kind && d.seq === sq,
    );
    return hit ? hit.version : null;
  };

  // Merge new files (picker OR web drag-drop), de-duped by filename; non-.md rejected.
  const addFiles = useCallback((picked: Array<{ filename: string; content: string }>): void => {
    if (picked.length === 0) return;
    setError(null);
    setOutcomes([]);
    const md = picked.filter((f) => /\.md$/i.test(f.filename));
    setRejected(picked.filter((f) => !/\.md$/i.test(f.filename)).map((f) => f.filename));
    if (md.length === 0) return;
    setStaged((prev) => {
      const map = new Map(prev.map((f) => [f.filename, f]));
      for (const f of md) {
        const parsed = parseEnglishDriveFilename(f.filename);
        map.set(f.filename, {
          filename: f.filename,
          content: f.content,
          classLevel: parsed.classLevel === null ? null : String(parsed.classLevel),
          blockNumber: parsed.blockNumber === null ? "" : String(parsed.blockNumber),
          blockNumbers: parsed.blockNumbers.join(","),
          kind: parsed.kind,
          seq: parsed.seq === null ? "1" : String(parsed.seq),
          version: parsed.version === null ? "1" : String(parsed.version),
          title: titleFromMarkdown(f.content) ?? "",
        });
      }
      return Array.from(map.values());
    });
  }, []);

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
      addFiles(picked);
    } catch {
      setError(STR.errGeneric);
    }
  }

  function patchStaged(filename: string, patch: Partial<StagedDoc>): void {
    setStaged((prev) => prev.map((f) => (f.filename === filename ? { ...f, ...patch } : f)));
  }

  function removeStaged(filename: string): void {
    setStaged((prev) => prev.filter((f) => f.filename !== filename));
  }

  const blockFieldOk = (s: StagedDoc): boolean => {
    if (s.kind === "PT") return blocksOf(s).length >= 1; // covers 1+ blocks (D-#347)
    if (s.kind === "AS") return intOrNull(s.blockNumber) !== null || s.blockNumber.trim() === "";
    return intOrNull(s.blockNumber) !== null;
  };

  const isComplete = (s: StagedDoc): boolean =>
    s.classLevel !== null &&
    s.kind !== null &&
    blockFieldOk(s) &&
    intOrNull(s.seq) !== null &&
    intOrNull(s.version) !== null &&
    s.title.trim() !== "";

  async function onUploadAll(): Promise<void> {
    if (busy || staged.length === 0) return;
    if (!staged.every(isComplete)) {
      setError(STR.edFormIncomplete);
      return;
    }
    // Two staged files must never claim the same identity — the second would
    // silently replace the first (e.g. Assignment_W3 + its AnswerKey both → seq 3).
    const byIdentity = new Map<string, string[]>();
    for (const s of staged) {
      const key = `${s.classLevel}|${blockOf(s) ?? ""}|${s.kind}|${intOrNull(s.seq)}`;
      byIdentity.set(key, [...(byIdentity.get(key) ?? []), s.filename]);
    }
    const dups = [...byIdentity.values()].filter((names) => names.length > 1);
    if (dups.length > 0) {
      setError(`${STR.edDupInBatch}: ${dups.map((names) => names.join(" = ")).join("; ")}`);
      return;
    }
    setBusy(true);
    setError(null);
    const results: UploadOutcome[] = [];
    for (const s of staged) {
      const res = await upload({
        classLevel: Number(s.classLevel),
        blockNumber: blockOf(s),
        blockNumbers: s.kind === "PT" ? blocksOf(s) : undefined,
        kind: s.kind!,
        seq: intOrNull(s.seq)!,
        title: s.title.trim(),
        version: intOrNull(s.version)!,
        contentMd: s.content,
      });
      if (res.error || !res.data?.uploadEnglishDriveDoc) {
        results.push({ filename: s.filename, ok: false, replacedVersion: null, error: friendlyError(res.error) });
      } else {
        results.push({
          filename: s.filename,
          ok: true,
          replacedVersion: res.data.uploadEnglishDriveDoc.replacedVersion,
        });
      }
    }
    setBusy(false);
    setOutcomes(results);
    const okNames = new Set(results.filter((r) => r.ok).map((r) => r.filename));
    setStaged((prev) => prev.filter((f) => !okNames.has(f.filename)));
    refetchExisting({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <H2>{STR.edUploadTitle}</H2>

      <FileDropZone onFiles={addFiles}>
        {Platform.OS === "web" ? (
          <Muted style={{ marginBottom: space(1), textAlign: "center" }}>{STR.edDropHint}</Muted>
        ) : null}
        <Button title={STR.pickFiles} variant="secondary" onPress={pickFiles} />
      </FileDropZone>

      {rejected.length > 0 ? <Notice message={`${STR.edOnlyMd}: ${rejected.join(", ")}`} tone="warn" /> : null}

      {staged.map((s) => {
        const prevVersion = conflictVersion(s);
        const newVersion = intOrNull(s.version);
        return (
          <Card key={s.filename}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Body style={{ fontWeight: "700", flexShrink: 1 }}>{s.filename}</Body>
              <Button title={STR.removeFile} variant="ghost" onPress={() => removeStaged(s.filename)} />
            </View>
            <Select
              label={STR.class}
              value={s.classLevel}
              options={CLASS_LEVELS.map((l) => ({ label: classLevelLabel(l), value: String(l) }))}
              onChange={(v) => patchStaged(s.filename, { classLevel: v })}
              placeholder={STR.vbPickClass}
            />
            <Select
              label={STR.edKindLabel}
              value={s.kind}
              options={ENGLISH_DRIVE_KINDS.map((k) => ({
                label: `${englishDriveKindLabel(k)} (${k})`,
                value: k,
              }))}
              onChange={(v) => patchStaged(s.filename, { kind: v })}
            />
            {s.kind === "PT" ? (
              <Field
                label={STR.edCoversBlocks}
                value={s.blockNumbers}
                onChangeText={(v) => patchStaged(s.filename, { blockNumbers: v })}
                helper={STR.edCoversBlocksHelper}
              />
            ) : (
              <Field
                label={STR.edBlockNumber}
                value={s.blockNumber}
                onChangeText={(v) => patchStaged(s.filename, { blockNumber: v })}
                keyboardType="numeric"
                helper={STR.edBlockOptionalAs}
              />
            )}
            <Field
              label={STR.edSeqLabel}
              value={s.seq}
              onChangeText={(v) => patchStaged(s.filename, { seq: v })}
              keyboardType="numeric"
              helper={STR.edSeqHelper}
            />
            <Field
              label={STR.edVersionLabel}
              value={s.version}
              onChangeText={(v) => patchStaged(s.filename, { version: v })}
              keyboardType="numeric"
            />
            <Field
              label={STR.edTitleLabel}
              value={s.title}
              onChangeText={(v) => patchStaged(s.filename, { title: v })}
            />
            {prevVersion !== null ? (
              <Notice
                message={`v${bnNum(prevVersion)} → v${bnNum(newVersion ?? "?")} ${STR.edWillReplace}`}
                tone="warn"
              />
            ) : (
              <Muted style={{ marginTop: space(1) }}>{STR.edNewDoc}</Muted>
            )}
          </Card>
        );
      })}

      {error ? <Notice message={error} tone="danger" /> : null}

      {staged.length > 0 ? (
        <Button
          title={busy ? STR.edUploading : `${STR.edUploadAll} (${bnNum(staged.length)})`}
          onPress={() => void onUploadAll()}
          loading={busy}
          disabled={busy}
        />
      ) : null}

      {outcomes.length > 0 ? (
        <>
          <Divider />
          <Card>
            <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.edUploadSummary}</Muted>
            {outcomes.map((o) => (
              <View
                key={o.filename}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: space(1),
                }}
              >
                <Body style={{ flex: 1, marginRight: space(2) }}>{o.filename}</Body>
                {o.ok ? (
                  <Badge
                    text={
                      o.replacedVersion !== null
                        ? `${STR.edReplacedOk} (v${bnNum(o.replacedVersion)} →)`
                        : STR.edUploadedOk
                    }
                    tone="ok"
                  />
                ) : (
                  <Badge text={o.error ?? STR.errGeneric} tone="danger" />
                )}
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

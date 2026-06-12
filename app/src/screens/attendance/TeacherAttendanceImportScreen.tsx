/**
 * TeacherAttendanceImportScreen (AT-1, AT1.6) — upload the daily biometric
 * "Employee Attendance Report" .xlsx: pick file → preview (parsed rows +
 * matched/unmatched/skipped) → resolve unmatched names (map to a StaffProfile —
 * remembered as an alias — or explicitly ignore) → commit. A re-upload for an
 * already-imported date REPLACES it (AT1.5). attendance:manage.
 */
import React, { useState } from "react";
import { View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  PREVIEW_TEACHER_ATTENDANCE,
  COMMIT_TEACHER_ATTENDANCE,
  TEACHER_ATTENDANCE_IMPORTS,
  TEACHER_ATTENDANCE_FOR_DATE,
  STAFF_QUERY,
  type AttImportPreviewT,
} from "../../graphql/operations";
import type { AttendanceStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Button, Notice, Divider, Select, Loader } from "../../components/ui";
import { STR, bnNum, teacherAttendanceStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AttendanceStackParamList, "TeacherAttendanceImport">;

/** Binary file → base64 without Node Buffer / web btoa (cross-platform). */
async function uriToBase64(uri: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(uri)).arrayBuffer());
  const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += ABC[a >> 2] + ABC[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? ABC[((b & 15) << 2) | (c >> 6)] : "=";
    out += i + 2 < bytes.length ? ABC[c & 63] : "=";
  }
  return out;
}

export default function TeacherAttendanceImportScreen(_props: Props): React.ReactElement {
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<AttImportPreviewT | null>(null);
  const [mappings, setMappings] = useState<Record<string, string>>({}); // name → staffProfileId
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [rosterDate, setRosterDate] = useState<string | null>(null);

  const [, runPreview] = useMutation(PREVIEW_TEACHER_ATTENDANCE);
  const [, runCommit] = useMutation(COMMIT_TEACHER_ATTENDANCE);
  const [importsQ, refetchImports] = useQuery({ query: TEACHER_ATTENDANCE_IMPORTS });
  const [staffQ] = useQuery({ query: STAFF_QUERY, variables: {} });
  const [rosterQ] = useQuery({
    query: TEACHER_ATTENDANCE_FOR_DATE,
    variables: { dateKey: rosterDate ?? "" },
    pause: !rosterDate,
  });

  const staffOptions = (staffQ.data?.staff ?? []).map((s) => ({ label: s.name, value: s.id, hint: s.designation ?? undefined }));

  async function pickFile(): Promise<void> {
    setError(null);
    setOk(null);
    setPreview(null);
    setMappings({});
    setIgnored(new Set());
    try {
      const res = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/octet-stream",
        ],
      });
      if (res.canceled || !res.assets?.[0]) return;
      setFileName(res.assets[0].name);
      setFileBase64(await uriToBase64(res.assets[0].uri));
    } catch {
      setError(STR.errGeneric);
    }
  }

  async function onPreview(): Promise<void> {
    if (!fileBase64) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await runPreview({ fileBase64 });
    setBusy(false);
    if (res.error || !res.data?.previewTeacherAttendanceImport) {
      setError(friendlyError(res.error));
      return;
    }
    setPreview(res.data.previewTeacherAttendanceImport);
  }

  const unresolved = (preview?.rows ?? []).filter(
    (r) => !r.skipped && !r.staffProfileId && !mappings[r.name] && !ignored.has(r.name),
  );

  async function onCommit(): Promise<void> {
    if (!fileBase64 || !preview) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await runCommit({
      fileBase64,
      mappings: Object.entries(mappings).map(([name, staffProfileId]) => ({ name, staffProfileId })),
      ignoreNames: [...ignored],
    });
    setBusy(false);
    if (res.error || !res.data?.commitTeacherAttendanceImport) {
      setError(friendlyError(res.error));
      return;
    }
    const r = res.data.commitTeacherAttendanceImport;
    setOk(`${STR.attImported} ${r.dateKey} · ${bnNum(r.imported)} ${STR.attRecordsWord}`);
    setPreview(null);
    setFileBase64(null);
    setFileName(null);
    refetchImports({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <Notice message={STR.attUploadHint} tone="info" />
      <Button title={STR.attPickXlsx} variant="secondary" onPress={pickFile} />
      {fileName ? <Muted style={{ marginTop: space(2) }}>📄 {fileName}</Muted> : null}
      {fileBase64 && !preview ? (
        <View style={{ marginTop: space(2) }}>
          <Button title={STR.attPreview} onPress={onPreview} loading={busy} />
        </View>
      ) : null}

      {error ? <Notice message={error} tone="danger" /> : null}
      {ok ? <Notice message={ok} tone="ok" /> : null}

      {preview ? (
        <>
          <Divider />
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>{preview.dateKey}</Body>
              <Muted>
                {STR.attMatchedCount}: {bnNum(preview.matched)} · {STR.attUnmatchedCount}: {bnNum(preview.unmatched)} ·{" "}
                {STR.attSkippedCount}: {bnNum(preview.skipped)}
              </Muted>
            </View>
            {preview.alreadyImported ? <Notice message={STR.attAlreadyImported} tone="warn" /> : null}
          </Card>

          {preview.unmatched > 0 ? <Notice message={STR.attUnmatchedHint} tone="warn" /> : null}
          {preview.rows
            .filter((r) => !r.skipped && !r.staffProfileId)
            .map((r) => (
              <Card key={r.name}>
                <Body style={{ fontWeight: "700" }}>{r.name}</Body>
                <Muted>{teacherAttendanceStatusLabel(r.status)}{r.punchIn ? ` · ${r.punchIn}` : ""}</Muted>
                {ignored.has(r.name) ? (
                  <View style={{ marginTop: space(2), flexDirection: "row", alignItems: "center", gap: space(2) }}>
                    <Badge text={STR.attIgnored} tone="muted" />
                    <Button
                      title={STR.attMapTo}
                      variant="ghost"
                      onPress={() => setIgnored((prev) => { const n = new Set(prev); n.delete(r.name); return n; })}
                    />
                  </View>
                ) : (
                  <>
                    <Select
                      label={STR.attMapTo}
                      value={(mappings[r.name] ?? null) as string | null}
                      options={staffOptions}
                      onChange={(v) => setMappings((m) => ({ ...m, [r.name]: v }))}
                      placeholder={STR.attMapTo}
                    />
                    <Button
                      title={STR.attIgnoreRow}
                      variant="ghost"
                      onPress={() => {
                        setIgnored((prev) => new Set(prev).add(r.name));
                        setMappings((m) => { const { [r.name]: _drop, ...rest } = m; return rest; });
                      }}
                    />
                  </>
                )}
              </Card>
            ))}

          {/* Matched rows — compact list */}
          <Card>
            {preview.rows
              .filter((r) => !r.skipped && (r.staffProfileId || mappings[r.name]))
              .map((r) => (
                <View key={r.name} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: space(1) }}>
                  <Body style={{ flex: 1 }} >{r.staffName ?? r.name}</Body>
                  <Muted>
                    {teacherAttendanceStatusLabel(r.status)}
                    {r.punchIn ? ` · ${r.punchIn}` : ""}
                    {r.punchOut ? ` → ${r.punchOut}` : ""}
                  </Muted>
                </View>
              ))}
          </Card>

          <Button title={STR.attCommit} onPress={onCommit} loading={busy} disabled={unresolved.length > 0} />
          {unresolved.length > 0 ? (
            <Muted style={{ marginTop: space(1) }}>
              {STR.attUnmatchedCount}: {bnNum(unresolved.length)}
            </Muted>
          ) : null}
        </>
      ) : null}

      <Divider />
      <H2>{STR.attPastImports}</H2>
      {(importsQ.data?.teacherAttendanceImports ?? []).map((d) => (
        <Card key={d.dateKey} onPress={() => setRosterDate(rosterDate === d.dateKey ? null : d.dateKey)}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Body style={{ fontWeight: "700" }}>{d.dateKey}</Body>
            <Muted>{bnNum(d.records)} {STR.attRecordsWord}</Muted>
          </View>
          {rosterDate === d.dateKey ? (
            rosterQ.fetching ? (
              <Loader label={STR.loading} />
            ) : (
              <View style={{ marginTop: space(2) }}>
                {(rosterQ.data?.teacherAttendanceForDate ?? []).map((rec) => (
                  <View key={rec.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 }}>
                    <Body style={{ flex: 1 }}>{rec.staffName}</Body>
                    <Badge
                      text={teacherAttendanceStatusLabel(rec.status)}
                      tone={rec.status === "PRESENT" ? "ok" : rec.status === "LATE" ? "warn" : rec.status === "LEAVE" ? "info" : "danger"}
                    />
                  </View>
                ))}
              </View>
            )
          ) : null}
        </Card>
      ))}
      <View style={{ height: space(4) }} />
    </Screen>
  );
}

/**
 * ব্যাচ প্রক্রিয়া — Mode B (docs/prd-child-support-profile.md §9.8, §6.11, §6.13). New batch → download
 * the pack (no names, codes only) → the one line for the chat + the privacy reminder → paste the result
 * and name the chat → the preview (valid · back to the teacher · rejected with reasons · safety) →
 * প্রয়োগ করুন. The evaluation pack has the same round-trip. The server keeps no copy of either file.
 */
import React, { useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  APPLY_SUPPORT_IMPORT,
  CANCEL_SUPPORT_BATCH,
  CREATE_SUPPORT_BATCH,
  DISCARD_SUPPORT_IMPORT,
  DOWNLOAD_SUPPORT_EVAL_PACK,
  DOWNLOAD_SUPPORT_PACK,
  RECORD_SUPPORT_EVALUATION,
  SUPPORT_BATCHES,
  SUPPORT_METHOD_INFO,
  UPLOAD_SUPPORT_RESULT,
} from "../../graphql/supportProfile";
import type { HomeStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Field, Chip, ChipRow, Loader, Notice } from "../../components/ui";
import { useToast } from "../../state/ToastContext";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeStackParamList, "SupportBatch">;
interface PreviewRow { reportId: string; studentName: string; occurredOn: string; questions?: string[] }
interface Preview {
  importId: string;
  warnings: string[];
  backToQueue: number;
  ok: PreviewRow[];
  returns: PreviewRow[];
  safeguarding: PreviewRow[];
  drafts: { studentName: string; items: number }[];
  rejected: { itemRef: string; reasonBn: string; text: string | null }[];
}

/** The file goes straight to the device: a download on the web; elsewhere the text is shown to copy. */
function saveFile(fileName: string, content: string): boolean {
  if (Platform.OS !== "web" || typeof document === "undefined") return false;
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export default function SupportBatchScreen(_props: Props): React.ReactElement {
  const toast = useToast();
  const [batches, refetch] = useQuery<{ supportBatchesPage: { rows: { id: string; code: string; status: string; reportCount: number; childCount: number; methodVersion: string; producer: string | null }[] } }>({
    query: SUPPORT_BATCHES,
    variables: { page: 1, pageSize: 10 },
    requestPolicy: "cache-and-network",
  });
  const [method] = useQuery<{ supportMethodInfo: { version: string; sha256: string; passedChats: string[] } }>({ query: SUPPORT_METHOD_INFO });
  const [, create] = useMutation(CREATE_SUPPORT_BATCH);
  const [, cancel] = useMutation(CANCEL_SUPPORT_BATCH);
  const [, download] = useMutation(DOWNLOAD_SUPPORT_PACK);
  const [upState, upload] = useMutation(UPLOAD_SUPPORT_RESULT);
  const [, apply] = useMutation(APPLY_SUPPORT_IMPORT);
  const [, discard] = useMutation(DISCARD_SUPPORT_IMPORT);
  const [, evalDownload] = useMutation(DOWNLOAD_SUPPORT_EVAL_PACK);
  const [, evalRecord] = useMutation(RECORD_SUPPORT_EVALUATION);
  const [chat, setChat] = useState("");
  const [text, setText] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [untick, setUntick] = useState<string[]>([]);
  const [evalText, setEvalText] = useState("");
  const [evalOk, setEvalOk] = useState(false);
  const open = batches.data?.supportBatchesPage.rows.find((b) => b.status === "OPEN" || b.status === "RESULT_PENDING");
  const passed = method.data?.supportMethodInfo.passedChats ?? [];
  const err = (e?: Parameters<typeof friendlyError>[0]) => (e ? (toast.show(friendlyError(e), "danger"), true) : false);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        {method.data ? <Muted>{`${STR.supMethod}: ${method.data.supportMethodInfo.version} · ${method.data.supportMethodInfo.sha256.slice(0, 12)} · ${STR.supPassedChats}: ${passed.join(", ") || "—"}`}</Muted> : null}
        {batches.fetching && !batches.data ? <Loader /> : null}
        {!open ? (
          <Button
            title={STR.supNewBatch}
            onPress={async () => {
              const r = await create({ mode: "MANUAL" });
              if (!err(r.error)) refetch({ requestPolicy: "network-only" });
            }}
          />
        ) : (
          <Card>
            <Body style={{ fontWeight: "700" }}>{`${open.code} · ${bnNum(open.reportCount)} ${STR.supReports} · ${bnNum(open.childCount)}`}</Body>
            <Body>{`1. ${STR.supDownloadPack} — ${STR.supPackNoNames}`}</Body>
            <Button
              title={STR.supDownloadPack}
              variant="secondary"
              onPress={async () => {
                const r = await download({ batchId: open.id });
                if (err(r.error)) return;
                const f = r.data?.downloadSupportPack;
                if (!saveFile(f.fileName, f.content)) setShown(f.content);
              }}
            />
            {shown ? <Field value={shown} onChangeText={() => undefined} multiline editable={false} /> : null}
            <Body>{`2. ${STR.supChatLine}`}</Body>
            <Muted>{STR.supPrivacy}</Muted>
            <Body>{`3. ${STR.supUpload}`}</Body>
            <ChipRow>
              {passed.map((c) => (
                <Chip key={c} label={c} selected={chat === c} onPress={() => setChat(c)} />
              ))}
            </ChipRow>
            <Field label={STR.supChatLabel} value={chat} onChangeText={setChat} />
            <Field label={STR.supPasteResult} value={text} onChangeText={setText} multiline />
            <Button
              title={STR.supUpload}
              loading={upState.fetching}
              onPress={async () => {
                const r = await upload({ batchId: open.id, text, chatLabel: chat });
                if (err(r.error)) return;
                setPreview(r.data?.uploadSupportResult);
                setUntick([]);
              }}
            />
            <Button title={STR.supCancelBatch} variant="ghost" onPress={async () => !err((await cancel({ batchId: open.id })).error) && refetch({ requestPolicy: "network-only" })} />
          </Card>
        )}
        {preview ? (
          <Card>
            {preview.warnings.map((w) => (
              <Notice key={w} message={w} tone="warn" />
            ))}
            <Body style={{ fontWeight: "700" }}>{`${STR.supPreviewOk}: ${bnNum(preview.ok.length)}`}</Body>
            <Body style={{ fontWeight: "700", marginTop: space(2) }}>{`${STR.supPreviewReturns}: ${bnNum(preview.returns.length)}`}</Body>
            {preview.returns.map((r) => (
              <View key={r.reportId}>
                <Muted>{`${r.studentName} · ${r.occurredOn}: ${(r.questions ?? []).join(" / ")}`}</Muted>
                <Chip label={STR.supKeepForMe} selected={untick.includes(r.reportId)} onPress={() => setUntick(untick.includes(r.reportId) ? untick.filter((x) => x !== r.reportId) : [...untick, r.reportId])} />
              </View>
            ))}
            {preview.safeguarding.length ? <Notice message={`${STR.supPreviewSafeguarding}: ${preview.safeguarding.map((s) => s.studentName).join(", ")}`} tone="danger" /> : null}
            <Body style={{ fontWeight: "700", marginTop: space(2) }}>{`${STR.supPreviewDrafts}: ${preview.drafts.map((d) => `${d.studentName} (${bnNum(d.items)})`).join(", ") || "—"}`}</Body>
            <Body style={{ fontWeight: "700", marginTop: space(2) }}>{`${STR.supPreviewRejected}: ${bnNum(preview.rejected.length)}`}</Body>
            {preview.rejected.map((r, i) => (
              <Muted key={`${r.itemRef}-${i}`}>{`${r.itemRef}: ${r.reasonBn}${r.text ? ` — ${r.text}` : ""}`}</Muted>
            ))}
            <View style={{ gap: space(2), marginTop: space(2) }}>
              <Button
                title={STR.supApply}
                onPress={async () => {
                  const r = await apply({ importId: preview.importId, untickReportIds: untick });
                  if (err(r.error)) return;
                  setPreview(null);
                  setText("");
                  refetch({ requestPolicy: "network-only" });
                }}
              />
              <Button title={STR.supDiscard} variant="ghost" onPress={async () => !err((await discard({ importId: preview.importId })).error) && setPreview(null)} />
            </View>
          </Card>
        ) : null}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.supEvalPack}</Body>
          <Button
            title={STR.supEvalDownload}
            variant="secondary"
            onPress={async () => {
              const r = await evalDownload({});
              if (err(r.error)) return;
              const f = r.data?.downloadSupportEvalPack;
              if (!saveFile(f.fileName, f.content)) setShown(f.content);
            }}
          />
          <Field label={STR.supChatLabel} value={chat} onChangeText={setChat} />
          <Field label={STR.supPasteResult} value={evalText} onChangeText={setEvalText} multiline />
          <Chip label={STR.supEvalSuggestionsOk} selected={evalOk} onPress={() => setEvalOk(!evalOk)} />
          <Button
            title={STR.supEvalRecord}
            onPress={async () => {
              const r = await evalRecord({ kind: "CHAT", chatLabel: chat, resultText: evalText, suggestionsChecked: evalOk });
              if (err(r.error)) return;
              toast.show(r.data?.recordSupportEvaluation.passed ? STR.supEvalPassed : STR.supEvalFailed, r.data?.recordSupportEvaluation.passed ? "ok" : "danger");
            }}
          />
        </Card>
        {batches.data?.supportBatchesPage.rows.map((b) => (
          <Muted key={b.id}>{`${b.code} · ${b.status} · ${bnNum(b.reportCount)} · ${b.methodVersion}${b.producer ? ` · ${b.producer}` : ""}`}</Muted>
        ))}
      </ScrollView>
    </Screen>
  );
}

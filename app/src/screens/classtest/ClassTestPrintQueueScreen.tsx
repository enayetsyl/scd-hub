/**
 * ClassTestPrintQueueScreen (CT-5 / J2, Office roster:manage) — the pending print
 * requests. The Office opens the paper (export the CT-set PDF via /pdf/set, or
 * download the uploaded paper via GET /files/:id), prints it, then taps Mark printed
 * (→ the official exam) or cancels. markClassTestPrinted/cancelClassTest are gated
 * roster:manage server-side — the Bangla deny surfaces inline.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useMutation } from "urql";
import {
  CLASS_TEST_PRINT_QUEUE_QUERY,
  MARK_CLASS_TEST_PRINTED,
  CANCEL_CLASS_TEST,
} from "../../graphql/classTest";
import { Screen, Card, Body, Muted, Button, Loader, Notice } from "../../components/ui";
import { STR, hwSubjectLabel, classTestSourceLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import { openStoredFile, FILE_VIEW_SUPPORTED, FileUploadError } from "../../lib/files";
import { space } from "../../theme/tokens";

export default function ClassTestPrintQueueScreen(): React.ReactElement {
  const [queueQ, refetch] = useQuery({ query: CLASS_TEST_PRINT_QUEUE_QUERY, variables: {} });
  const queue = queueQ.data?.classTestPrintQueue ?? [];
  const [, markPrinted] = useMutation(MARK_CLASS_TEST_PRINTED);
  const [, cancel] = useMutation(CANCEL_CLASS_TEST);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function openPaper(setId: string | null, questionFileId: string | null): Promise<void> {
    setError(null);
    try {
      if (setId) await openPdf(`/pdf/set/${setId}`);
      else if (questionFileId) await openStoredFile(questionFileId);
    } catch (e) {
      setError(e instanceof FileUploadError || e instanceof Error ? e.message : STR.errGeneric);
    }
  }

  async function onMark(id: string): Promise<void> {
    setError(null);
    setOk(null);
    setBusyId(id);
    const res = await markPrinted({ id });
    setBusyId(null);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.ctMarkedPrinted);
    refetch({ requestPolicy: "network-only" });
  }

  async function onCancel(id: string): Promise<void> {
    setError(null);
    setOk(null);
    setBusyId(id);
    const res = await cancel({ id });
    setBusyId(null);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.ctCancelled);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}
        {queueQ.fetching ? (
          <Loader label={STR.loading} />
        ) : queue.length === 0 ? (
          <Card>
            <Muted>{STR.ctNoQueue}</Muted>
          </Card>
        ) : (
          queue.map((t) => {
            const viewable = t.setId ? PDF_SUPPORTED : FILE_VIEW_SUPPORTED;
            return (
              <Card key={t.id}>
                <Body style={{ fontWeight: "700" }}>
                  {hwSubjectLabel(t.subject)} · {STR.ctTestNumber} {bnNum(t.testNumber)}
                </Body>
                <Muted>
                  {t.ctId} · {new Date(t.examDate).toLocaleDateString()} · {STR.ctTotalMarks} {bnNum(t.totalMarks)} ·{" "}
                  {classTestSourceLabel(t.source)}
                </Muted>
                {t.notes ? <Muted>{t.notes}</Muted> : null}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                  {viewable ? (
                    <Button
                      title={t.setId ? STR.ctExportSetPdf : STR.ctViewPaper}
                      variant="secondary"
                      onPress={() => openPaper(t.setId, t.questionFileId)}
                    />
                  ) : null}
                  <Button title={STR.ctMarkPrinted} onPress={() => onMark(t.id)} loading={busyId === t.id} disabled={busyId === t.id} />
                  <Button title={STR.ctCancelRequest} variant="ghost" onPress={() => onCancel(t.id)} disabled={busyId === t.id} />
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

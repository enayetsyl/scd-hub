/**
 * EnglishDriveDocScreen (D-#344, ED-1) — renders one English Drive document's
 * stored markdown with the existing renderer, plus "PDF তৈরি করুন" through the
 * existing server-side A4 engine (GET /pdf/english-drive/:id). Read access is
 * re-gated server-side (the doc query and the PDF route share the same scope).
 */
import React, { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { ENGLISH_DRIVE_DOC } from "../../graphql/englishDrive";
import type { EnglishDriveStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import Markdown from "../../components/Markdown";
import { englishDriveKindLabel } from "../../lib/englishDrive";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import { STR, bnNum, classLevelLabel, isoDateLabel } from "../../lib/labels";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<EnglishDriveStackParamList, "EnglishDriveDoc">;

export default function EnglishDriveDocScreen({ route }: Props): React.ReactElement {
  const { docId } = route.params;
  const [docQ, refetch] = useQuery({ query: ENGLISH_DRIVE_DOC, variables: { id: docId } });
  const doc = docQ.data?.englishDriveDoc ?? null;

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState<string | null>(null);

  const retry = (): void => refetch({ requestPolicy: "network-only" });
  const { refreshing, onRefresh } = usePullRefresh(docQ.fetching, retry);

  async function onExport(): Promise<void> {
    if (pdfBusy) return;
    setPdfBusy(true);
    setPdfErr(null);
    try {
      await openPdf(`/pdf/english-drive/${docId}`);
    } catch {
      setPdfErr(STR.pdfError);
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <QueryGate result={docQ} onRetry={retry} loaderLabel={STR.loading}>
          {doc ? (
            <>
              <Card>
                <View
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                >
                  <Body style={{ fontWeight: "700", flexShrink: 1 }}>
                    {classLevelLabel(doc.classLevel)} · {STR.edBlock} {bnNum(doc.blockNumber)} ·{" "}
                    {englishDriveKindLabel(doc.kind)}
                  </Body>
                  <Badge text={`v${bnNum(doc.version)}`} tone="muted" />
                </View>
                <Muted style={{ marginTop: 2 }}>{doc.title}</Muted>
                <Muted style={{ marginTop: 2 }}>
                  {STR.edUploadedBy}: {doc.uploadedByName ?? "—"} · {isoDateLabel(doc.uploadedAt)}
                </Muted>
                <View style={{ marginTop: space(2) }}>
                  {PDF_SUPPORTED ? (
                    <Button
                      title={pdfBusy ? STR.preparingPdf : STR.exportPdf}
                      variant="secondary"
                      onPress={() => void onExport()}
                      loading={pdfBusy}
                    />
                  ) : (
                    <Muted>{STR.pdfWebOnly}</Muted>
                  )}
                </View>
                {pdfErr ? <Notice message={pdfErr} tone="danger" /> : null}
              </Card>

              <Card>
                <Markdown source={doc.contentMd ?? ""} />
              </Card>
            </>
          ) : null}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}

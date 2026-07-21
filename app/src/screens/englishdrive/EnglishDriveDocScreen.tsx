/**
 * EnglishDriveDocScreen (D-#344, ED-1) — renders one English Drive document's
 * stored markdown with the existing renderer, plus "PDF তৈরি করুন" through the
 * existing server-side A4 engine (GET /pdf/english-drive/:id). Read access is
 * re-gated server-side (the doc query and the PDF route share the same scope).
 */
import React, { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  PRINT_COLOURS,
  PRINT_COLOUR_LABELS_EN,
  PRINT_SIDES,
  PRINT_SIDES_LABELS_EN,
} from "@scd/shared";
import { ENGLISH_DRIVE_DOC, SEND_ENGLISH_DRIVE_TO_PRINT } from "../../graphql/englishDrive";
import type { EnglishDriveStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Chip, ChipRow, Field, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import Markdown from "../../components/Markdown";
import { englishDriveKindLabel } from "../../lib/englishDrive";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import { friendlyError } from "../../lib/errors";
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

  // ED-2: "প্রিন্টে পাঠান" — the colour/sides/copies form folds out of the button;
  // the server renders the PDF and files it through the existing print queue.
  const [, sendToPrint] = useMutation(SEND_ENGLISH_DRIVE_TO_PRINT);
  const [printing, setPrinting] = useState(false);
  const [colour, setColour] = useState<string | null>(null);
  const [sides, setSides] = useState<string | null>(null);
  const [copies, setCopies] = useState("1");
  const [printBusy, setPrintBusy] = useState(false);
  const [printErr, setPrintErr] = useState<string | null>(null);
  const [printOk, setPrintOk] = useState<string | null>(null);

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

  async function onSendToPrint(): Promise<void> {
    const n = Number(copies);
    if (printBusy || !colour || !sides || !Number.isInteger(n) || n < 1) return;
    setPrintBusy(true);
    setPrintErr(null);
    setPrintOk(null);
    const res = await sendToPrint({ id: docId, colour, sides, copies: n });
    setPrintBusy(false);
    if (res.error || !res.data?.sendEnglishDriveDocToPrint) {
      setPrintErr(friendlyError(res.error));
      return;
    }
    setPrintOk(STR.edSentToPrint);
    setPrinting(false);
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

                <View style={{ marginTop: space(2) }}>
                  {!printing ? (
                    <Button
                      title={`🖨️ ${STR.cqSendToPrint}`}
                      onPress={() => {
                        setPrinting(true);
                        setPrintOk(null);
                      }}
                      disabled={printBusy}
                    />
                  ) : (
                    <>
                      <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.prColour} *</Body>
                      <ChipRow>
                        {PRINT_COLOURS.map((c) => (
                          <Chip
                            key={c}
                            label={PRINT_COLOUR_LABELS_EN[c]}
                            selected={colour === c}
                            onPress={() => setColour(c)}
                          />
                        ))}
                      </ChipRow>
                      <Body style={{ fontWeight: "700", marginVertical: space(1) }}>{STR.prSides} *</Body>
                      <ChipRow>
                        {PRINT_SIDES.map((sd) => (
                          <Chip
                            key={sd}
                            label={PRINT_SIDES_LABELS_EN[sd]}
                            selected={sides === sd}
                            onPress={() => setSides(sd)}
                          />
                        ))}
                      </ChipRow>
                      <Field
                        label={STR.prCopies}
                        value={copies}
                        onChangeText={setCopies}
                        keyboardType="number-pad"
                      />
                      <Button
                        title={STR.cqSendToPrint}
                        onPress={() => void onSendToPrint()}
                        loading={printBusy}
                        disabled={printBusy || !colour || !sides || !(Number(copies) >= 1)}
                        style={{ marginTop: space(1) }}
                      />
                    </>
                  )}
                </View>
                {printOk ? <Notice message={printOk} tone="ok" /> : null}
                {printErr ? <Notice message={printErr} tone="danger" /> : null}
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

/**
 * EnglishDriveDocScreen (D-#344, ED-1) — renders one English Drive document's
 * stored markdown with the existing renderer, plus "PDF তৈরি করুন" through the
 * existing server-side A4 engine (GET /pdf/english-drive/:id). Read access is
 * re-gated server-side (the doc query and the PDF route share the same scope).
 *
 * ED-3b (D-#347): a "সম্পর্কিত ফাইল" strip cross-links the same block's other
 * materials — computed client-side from the already-scoped englishDriveDocs read
 * (no new resolver, no new permission). A block doc links its block's BLOCK/TN/
 * CW/HW/CLUE + any PT covering it; a PT links every doc in the blocks it covers.
 */
import React, { useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  PRINT_COLOURS,
  PRINT_COLOUR_LABELS_EN,
  PRINT_SIDES,
  PRINT_SIDES_LABELS_EN,
} from "@scd/shared";
import {
  ENGLISH_DRIVE_DOC,
  ENGLISH_DRIVE_DOCS,
  SEND_ENGLISH_DRIVE_TO_PRINT,
  type EnglishDriveDocT,
} from "../../graphql/englishDrive";
import type { EnglishDriveStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Chip, ChipRow, Field, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import Markdown from "../../components/Markdown";
import { RichWorksheetEditor } from "../../components/RichWorksheetEditor";
import {
  ENGLISH_DRIVE_KINDS,
  englishDriveKindLabel,
  formatBlocksBn,
} from "../../lib/englishDrive";
import { openPdf, openPdfPost, PDF_SUPPORTED } from "../../lib/pdf";
import { openStoredFile, FileUploadError } from "../../lib/files";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum, classLevelLabel, isoDateLabel } from "../../lib/labels";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<EnglishDriveStackParamList, "EnglishDriveDoc">;

/** The blocks a doc touches: a PT its whole coverage, else its single block. */
function blocksOf(d: Pick<EnglishDriveDocT, "kind" | "blockNumber" | "blockNumbers">): number[] {
  if (d.kind === "PT") return d.blockNumbers;
  return d.blockNumber !== null ? [d.blockNumber] : [];
}

function relatedChipLabel(d: EnglishDriveDocT): string {
  if (d.kind === "PT") {
    return d.blockNumbers.length
      ? `${englishDriveKindLabel(d.kind)} ${formatBlocksBn(d.blockNumbers)}`
      : englishDriveKindLabel(d.kind);
  }
  return `${englishDriveKindLabel(d.kind)}${d.seq > 1 ? ` ${bnNum(d.seq)}` : ""}`;
}

export default function EnglishDriveDocScreen({ route, navigation }: Props): React.ReactElement {
  const { docId } = route.params;
  const [docQ, refetch] = useQuery({ query: ENGLISH_DRIVE_DOC, variables: { id: docId } });
  const doc = docQ.data?.englishDriveDoc ?? null;

  // ED-3b: siblings in the same class, once the doc (and its class) is known. Same
  // scoped read the library uses — server re-gates; metadata only (contentMd null).
  const [siblingsQ] = useQuery({
    query: ENGLISH_DRIVE_DOCS,
    variables: { classLevel: doc?.classLevel ?? null },
    pause: !doc,
  });
  const related = useMemo(() => {
    if (!doc) return [] as EnglishDriveDocT[];
    const blocks = new Set(blocksOf(doc));
    if (blocks.size === 0) return []; // block-less (AS) — nothing to cross-link
    const all = siblingsQ.data?.englishDriveDocs ?? [];
    return all
      .filter((d) => d.id !== doc.id && blocksOf(d).some((b) => blocks.has(b)))
      .sort(
        (a, b) =>
          ENGLISH_DRIVE_KINDS.indexOf(a.kind as (typeof ENGLISH_DRIVE_KINDS)[number]) -
            ENGLISH_DRIVE_KINDS.indexOf(b.kind as (typeof ENGLISH_DRIVE_KINDS)[number]) ||
          (a.blockNumber ?? Infinity) - (b.blockNumber ?? Infinity) ||
          a.seq - b.seq,
      );
  }, [doc, siblingsQ.data]);

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

  // D-#349: the web WYSIWYG worksheet editor (browser print). Web only; native
  // falls back to the D-#348 markdown edit mode below.
  const [richOpen, setRichOpen] = useState(false);

  // D-#348 edit-before-print: a one-off edit (content + layout knobs) that feeds
  // the PDF preview + send-to-print. NOT persisted to the stored doc.
  const [editMode, setEditMode] = useState(false);
  const [editedMd, setEditedMd] = useState("");
  const [fontScale, setFontScale] = useState(1);
  const [lineSpacing, setLineSpacing] = useState(1);
  const [margin, setMargin] = useState(50);

  // PDF/DOCX docs (owner 2026-07-25) are binaries — opened/downloaded via the
  // authed /files/:id, not markdown-rendered/edited/office-printed.
  const isBinary = !!doc && (doc.format ?? "MD") !== "MD";
  const [openBusy, setOpenBusy] = useState(false);
  const [openErr, setOpenErr] = useState<string | null>(null);
  async function onOpenFile(): Promise<void> {
    if (openBusy || !doc?.fileId) return;
    setOpenBusy(true);
    setOpenErr(null);
    try {
      await openStoredFile(doc.fileId);
    } catch (e) {
      setOpenErr(e instanceof FileUploadError ? e.message : STR.errGeneric);
    } finally {
      setOpenBusy(false);
    }
  }

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

  function enterEdit(): void {
    setEditedMd(doc?.contentMd ?? "");
    setEditMode(true);
    setPrintOk(null);
  }

  async function onPreviewEdited(): Promise<void> {
    if (pdfBusy) return;
    setPdfBusy(true);
    setPdfErr(null);
    try {
      await openPdfPost("/pdf/english-drive/render", {
        markdown: editedMd,
        title: doc?.title,
        fontScale,
        lineSpacing,
        margin,
      });
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
    const res = await sendToPrint({
      id: docId,
      colour,
      sides,
      copies: n,
      // Edit-before-print: print the edited version + layout when in edit mode.
      ...(editMode ? { contentMd: editedMd, fontScale, lineSpacing, margin } : {}),
    });
    setPrintBusy(false);
    if (res.error || !res.data?.sendEnglishDriveDocToPrint) {
      setPrintErr(friendlyError(res.error));
      return;
    }
    setPrintOk(STR.edSentToPrint);
    setPrinting(false);
  }

  // Layout presets (D-#348). Defaults (1.0 / 1.0 / 50) reproduce the current PDF.
  const FONT_PRESETS = [
    { label: STR.edFontSmall, v: 0.9 },
    { label: STR.edFontMed, v: 1.0 },
    { label: STR.edFontLarge, v: 1.15 },
    { label: STR.edFontXL, v: 1.3 },
  ];
  // Google-Docs line-height presets (single / 1.15 / 1.5 / double).
  const SPACING_PRESETS = [
    { label: STR.edSpaceSingle, v: 1.0 },
    { label: "1.15", v: 1.15 },
    { label: "1.5", v: 1.5 },
    { label: STR.edSpaceDouble, v: 2.0 },
  ];
  const MARGIN_PRESETS = [
    { label: STR.edMarginNarrow, v: 35 },
    { label: STR.edMarginNormal, v: 50 },
    { label: STR.edMarginWide, v: 70 },
  ];

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
                    {classLevelLabel(doc.classLevel)}
                    {doc.kind === "PT" && doc.blockNumbers.length
                      ? ` · ${STR.edBlock} ${formatBlocksBn(doc.blockNumbers)}`
                      : doc.blockNumber !== null
                        ? ` · ${STR.edBlock} ${bnNum(doc.blockNumber)}`
                        : ""}{" "}
                    · {englishDriveKindLabel(doc.kind)}
                    {doc.kind !== "PT" && doc.seq > 1 ? ` ${bnNum(doc.seq)}` : ""}
                  </Body>
                  <Badge text={`v${bnNum(doc.version)}`} tone="muted" />
                </View>
                <Muted style={{ marginTop: 2 }}>{doc.title}</Muted>
                <Muted style={{ marginTop: 2 }}>
                  {STR.edUploadedBy}: {doc.uploadedByName ?? "—"} · {isoDateLabel(doc.uploadedAt)}
                </Muted>

                {isBinary ? (
                  <View style={{ marginTop: space(2) }}>
                    <Badge text={doc.format} tone="info" />
                    <View style={{ marginTop: space(2) }}>
                      <Button
                        title={openBusy ? STR.loading : doc.format === "PDF" ? STR.edOpenFile : STR.edDownloadFile}
                        onPress={() => void onOpenFile()}
                        loading={openBusy}
                      />
                    </View>
                    <Muted style={{ marginTop: space(2) }}>{STR.edBinaryHint}</Muted>
                    {openErr ? <Notice message={openErr} tone="danger" /> : null}
                  </View>
                ) : (
                <>
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
                  {editMode ? (
                    <View style={{ flexDirection: "row", gap: space(2) }}>
                      {PDF_SUPPORTED ? (
                        <View style={{ flex: 1 }}>
                          <Button
                            title={pdfBusy ? STR.preparingPdf : STR.edPreviewPdf}
                            variant="secondary"
                            onPress={() => void onPreviewEdited()}
                            loading={pdfBusy}
                          />
                        </View>
                      ) : null}
                      <View style={{ flex: 1 }}>
                        <Button title={STR.edEditClose} variant="ghost" onPress={() => setEditMode(false)} />
                      </View>
                    </View>
                  ) : richOpen ? null : (
                    <Button
                      title={`✎ ${STR.edEditPrint}`}
                      variant="ghost"
                      // Web → the WYSIWYG editor (D-#349); native → the markdown edit mode (D-#348).
                      onPress={() => (PDF_SUPPORTED ? setRichOpen(true) : enterEdit())}
                    />
                  )}
                </View>

                <View style={{ marginTop: space(2) }}>
                  {editMode ? (
                    <Muted style={{ marginBottom: space(1) }}>{STR.edEditedWillPrint}</Muted>
                  ) : null}
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
                </>
                )}
              </Card>

              {!isBinary && richOpen ? (
                <View style={{ marginTop: space(3) }}>
                  <RichWorksheetEditor
                    sourceMd={doc.contentMd ?? ""}
                    title={`${classLevelLabel(doc.classLevel)} · ${englishDriveKindLabel(doc.kind)} — ${doc.title}`}
                    onDone={() => setRichOpen(false)}
                    // Save-as-PDF → office queue bridge: jump to the Print tab's upload
                    // form (source defaults to UPLOAD) with the worksheet title prefilled.
                    onSendToQueue={() =>
                      (
                        navigation.getParent() as unknown as
                          | { navigate: (r: string, p?: unknown) => void }
                          | undefined
                      )?.navigate("PrintTab", {
                        screen: "NewPrintRequest",
                        params: {
                          title: `${classLevelLabel(doc.classLevel)} · ${englishDriveKindLabel(doc.kind)} — ${doc.title}`,
                        },
                      })
                    }
                    // Class-test channel: jump to the Class Test "Request" flow (upload the
                    // saved PDF as the exam paper → tracked exam + results + publish).
                    onSendToClassTest={() =>
                      (
                        navigation.getParent() as unknown as
                          | { navigate: (r: string, p?: unknown) => void }
                          | undefined
                      )?.navigate("ClassTestTab", { screen: "RequestClassTest" })
                    }
                  />
                </View>
              ) : null}

              {!isBinary && editMode ? (
                <Card>
                  <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.edLayoutTitle}</Muted>
                  <Muted style={{ marginBottom: space(2) }}>{STR.edEditHint}</Muted>

                  {/* On a wide screen the three groups sit in one row; they wrap on a phone. */}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(5) }}>
                    <View>
                      <Body style={{ fontWeight: "700", marginBottom: 4 }}>{STR.edLayoutFont}</Body>
                      <ChipRow>
                        {FONT_PRESETS.map((p) => (
                          <Chip key={p.label} label={p.label} selected={fontScale === p.v} onPress={() => setFontScale(p.v)} />
                        ))}
                      </ChipRow>
                    </View>
                    <View>
                      <Body style={{ fontWeight: "700", marginBottom: 4 }}>{STR.edLayoutSpacing}</Body>
                      <ChipRow>
                        {SPACING_PRESETS.map((p) => (
                          <Chip key={p.label} label={p.label} selected={lineSpacing === p.v} onPress={() => setLineSpacing(p.v)} />
                        ))}
                      </ChipRow>
                    </View>
                    <View>
                      <Body style={{ fontWeight: "700", marginBottom: 4 }}>{STR.edLayoutMargin}</Body>
                      <ChipRow>
                        {MARGIN_PRESETS.map((p) => (
                          <Chip key={p.label} label={p.label} selected={margin === p.v} onPress={() => setMargin(p.v)} />
                        ))}
                      </ChipRow>
                    </View>
                  </View>

                  <View style={{ marginTop: space(3) }}>
                    <Field
                      label={STR.edContentLabel}
                      value={editedMd}
                      onChangeText={setEditedMd}
                      multiline
                      inputStyle={{ minHeight: 340, textAlignVertical: "top" }}
                      helper={STR.edLsBlockHint}
                    />
                  </View>
                </Card>
              ) : null}

              {related.length > 0 ? (
                <Card>
                  <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.edRelated}</Muted>
                  <ChipRow>
                    {related.map((r) => (
                      <Chip
                        key={r.id}
                        label={relatedChipLabel(r)}
                        selected={false}
                        onPress={() =>
                          navigation.push("EnglishDriveDoc", { docId: r.id, title: r.title })
                        }
                      />
                    ))}
                  </ChipRow>
                </Card>
              ) : null}

              {!isBinary ? (
                <Card>
                  <Markdown
                    source={(editMode ? editedMd : doc.contentMd ?? "").replace(
                      /^[ \t]*\{ls:[^}]*\}[ \t]*$/gim,
                      "",
                    )}
                  />
                </Card>
              ) : null}
            </>
          ) : null}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}

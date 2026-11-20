/**
 * BookPdfPages (PB-2, D-#1661) — the real printed pages `fromPage..toPage` of a school book, one
 * under the other (the host scrolls), each fitted to the pane width. Tap a page to open it large
 * (zoom steps, sideways + up/down scroll). Pages load one after another so a long chapter does not
 * fire every request at once. View only: the image sits under a transparent cover, no save control.
 * Used by the plan Book tab and the teachers' book viewer.
 */
import React from "react";
import { Image, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "urql";
import { BOOK_PDF_PAGE } from "../graphql/bookPdf";
import { Button, ErrorBanner, Muted } from "./ui";
import { friendlyError } from "../lib/errors";
import { STR, bnNum } from "../lib/labels";
import { radius, space, typeScale, useColors } from "../theme";

const ZOOMS = [1, 1.5, 2, 3];
const MAX_PAGE_WIDTH = 820;

function usePageUri(pdfId: string, page: number, pause: boolean) {
  const [q, refetch] = useQuery({ query: BOOK_PDF_PAGE, variables: { pdfId, page }, pause });
  const uri = q.data?.bookPdfPage?.page === page ? q.data.bookPdfPage.dataUri : undefined;
  return { uri, error: q.error, refetch };
}

function PageItem({
  pdfId,
  page,
  width,
  aspect,
  enabled,
  onLoaded,
  onOpen,
}: {
  pdfId: string;
  page: number;
  width: number;
  aspect: number;
  enabled: boolean;
  onLoaded: () => void;
  onOpen: () => void;
}): React.ReactElement {
  const colors = useColors();
  const { uri, error, refetch } = usePageUri(pdfId, page, !enabled);
  const doneRef = React.useRef(false);
  React.useEffect(() => {
    if ((uri || error) && !doneRef.current) {
      doneRef.current = true;
      onLoaded();
    }
  }, [uri, error, onLoaded]);
  const height = Math.round(width * aspect);
  return (
    <View style={{ marginBottom: space(3) }}>
      <Pressable
        onPress={onOpen}
        disabled={!uri}
        accessibilityRole="button"
        accessibilityLabel={`${STR.bpdPrintedPages} ${bnNum(page)}`}
        style={{
          width,
          height,
          backgroundColor: "#FFFFFF",
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: "center",
          justifyContent: "center",
          ...(Platform.OS === "web" ? ({ userSelect: "none" } as object) : null),
        }}
      >
        {uri ? <Image source={{ uri }} style={{ width, height }} resizeMode="contain" /> : <Muted>{error ? "" : STR.loading}</Muted>}
      </Pressable>
      {error ? <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} /> : null}
      <Text style={{ ...typeScale.caption, color: colors.textSecondary, textAlign: "center", marginTop: space(1) }}>{bnNum(page)}</Text>
    </View>
  );
}

function ZoomModal({ pdfId, page, aspect, onClose }: { pdfId: string; page: number; aspect: number; onClose: () => void }): React.ReactElement {
  const colors = useColors();
  const [zoomIdx, setZoomIdx] = React.useState(0);
  const [boxW, setBoxW] = React.useState(0);
  const { uri } = usePageUri(pdfId, page, false);
  const fit = Math.min(Math.max(boxW - space(4) * 2, 200), MAX_PAGE_WIDTH);
  const w = Math.round(fit * ZOOMS[zoomIdx]);
  const h = Math.round(w * aspect);
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} transparent={false}>
      <View style={{ flex: 1, backgroundColor: colors.bg }} onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: space(2), padding: space(3) }}>
          <Button title={`− ${STR.cbZoomOut}`} variant="ghost" disabled={zoomIdx === 0} onPress={() => setZoomIdx(zoomIdx - 1)} />
          <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>{bnNum(page)}</Text>
          <Button title={`＋ ${STR.cbZoomIn}`} variant="ghost" disabled={zoomIdx === ZOOMS.length - 1} onPress={() => setZoomIdx(zoomIdx + 1)} />
          <Button title={STR.bpdClose} variant="secondary" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ padding: space(4), alignItems: zoomIdx === 0 ? "center" : "flex-start" }}>
          <ScrollView horizontal scrollEnabled={zoomIdx > 0}>
            <View style={{ width: w, height: h, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm }}>
              {uri ? <Image source={{ uri }} style={{ width: w, height: h }} resizeMode="contain" /> : <Muted>{STR.loading}</Muted>}
              <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
            </View>
          </ScrollView>
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function BookPdfPages({
  pdfId,
  fromPage,
  toPage,
  pageAspect,
}: {
  pdfId: string;
  fromPage: number;
  toPage: number;
  pageAspect: number;
}): React.ReactElement {
  const [boxW, setBoxW] = React.useState(0);
  const [ready, setReady] = React.useState(0);
  const [zoomPage, setZoomPage] = React.useState<number | null>(null);
  // A new chapter / book starts loading from its first page again.
  React.useEffect(() => setReady(0), [pdfId, fromPage, toPage]);
  const onLoaded = React.useCallback(() => setReady((n) => n + 1), []);
  const pages: number[] = [];
  for (let p = fromPage; p <= toPage; p += 1) pages.push(p);
  const width = Math.min(Math.max(boxW, 0), MAX_PAGE_WIDTH);
  return (
    <View onLayout={(e) => setBoxW(Math.floor(e.nativeEvent.layout.width))} style={{ alignItems: "center" }}>
      {width > 0
        ? pages.map((p, i) => (
            <PageItem
              key={`${pdfId}-${p}`}
              pdfId={pdfId}
              page={p}
              width={width}
              aspect={pageAspect || 1.357}
              enabled={i <= ready + 1}
              onLoaded={onLoaded}
              onOpen={() => setZoomPage(p)}
            />
          ))
        : null}
      <Muted style={{ textAlign: "center" }}>{STR.bpdTapZoom}</Muted>
      {zoomPage !== null ? <ZoomModal pdfId={pdfId} page={zoomPage} aspect={pageAspect || 1.357} onClose={() => setZoomPage(null)} /> : null}
    </View>
  );
}

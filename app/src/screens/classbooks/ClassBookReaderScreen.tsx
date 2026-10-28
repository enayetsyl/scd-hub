/**
 * ClassBookReaderScreen (D-#870) — one class book, one page at a time, view only.
 *
 * The server hands out a single page image per request (never the PDF), so there is
 * nothing to download here: no share/save/print control, the image sits under a
 * transparent cover so the browser offers no "save image", and on the web the
 * right-click menu is off while the reader is open. (A screenshot can't be stopped —
 * that is the honest limit.)
 *
 * Paging (all controls under the page; the position rides in the header): ‹ / › buttons (also ← / → keys on the web, and a sideways swipe), a "go to
 * page" box, and zoom steps that let a small phone read the small print. The next page
 * is fetched ahead so turning a page is instant.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Image, PanResponder, Platform, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useClient, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CLASS_BOOK_PAGE_QUERY } from "../../graphql/classBooks";
import { Button, ErrorBanner, Muted, Screen } from "../../components/ui";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum } from "../../lib/labels";
import type { ClassBooksStackParamList } from "../../navigation/types";
import { radius, space, typeScale, useColors } from "../../theme";

type Props = NativeStackScreenProps<ClassBooksStackParamList, "ClassBookReader">;

const ZOOMS = [1, 1.5, 2, 2.5];
const MAX_PAGE_WIDTH = 820;

export default function ClassBookReaderScreen({ route, navigation }: Props): React.ReactElement {
  const { bookId, title, pageCount, pageAspect } = route.params;
  const colors = useColors();
  const client = useClient();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(1);
  const [zoomIdx, setZoomIdx] = useState(0);
  const [goTo, setGoTo] = useState("");

  const [q, refetch] = useQuery({ query: CLASS_BOOK_PAGE_QUERY, variables: { bookId, page } });
  const uri = q.data?.classBookPage?.page === page ? q.data.classBookPage.dataUri : undefined;
  const total = q.data?.classBookPage?.pageCount ?? pageCount;
  const position = STR.cbPageOf.replace("{p}", bnNum(page)).replace("{n}", bnNum(total));

  // The page position rides in the header (owner: a control bar above the page took
  // space for nothing); every control sits under the page.
  useLayoutEffect(() => {
    navigation.setOptions({ title: `${title} · ${position}` });
  }, [navigation, title, position]);

  // A new page opens at its top — the page-turn buttons sit under the page.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [page]);

  // Fetch the neighbours ahead (cache-first), so the next tap shows at once.
  useEffect(() => {
    for (const p of [page + 1, page - 1]) {
      if (p >= 1 && p <= total) void client.query(CLASS_BOOK_PAGE_QUERY, { bookId, page: p }).toPromise();
    }
  }, [client, bookId, page, total]);

  const go = (p: number): void => setPage(Math.min(Math.max(1, p), Math.max(1, total)));
  const goRef = useRef(go);
  goRef.current = go;
  const pageRef = useRef(page);
  pageRef.current = page;

  // Web: ← / → turn pages; no right-click menu while the book is open.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") goRef.current(pageRef.current + 1);
      if (e.key === "ArrowLeft") goRef.current(pageRef.current - 1);
    };
    const noMenu = (e: Event): void => e.preventDefault();
    document.addEventListener("keydown", onKey);
    document.addEventListener("contextmenu", noMenu);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("contextmenu", noMenu);
    };
  }, []);

  const zoom = ZOOMS[zoomIdx];
  // A sideways swipe turns the page — only at the fitted size, where nothing scrolls sideways.
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => zoom === 1 && Math.abs(g.dx) > 24 && Math.abs(g.dy) < 24,
        onPanResponderRelease: (_e, g) => {
          if (g.dx < -60) goRef.current(pageRef.current + 1);
          else if (g.dx > 60) goRef.current(pageRef.current - 1);
        },
      }),
    [zoom],
  );

  const fitWidth = Math.min(width - space(4) * 2, MAX_PAGE_WIDTH);
  const pageWidth = Math.round(fitWidth * zoom);
  const pageHeight = Math.round(pageWidth * (pageAspect || 1.357));

  const pager = (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space(2), flexWrap: "wrap" }}>
      <Button title={STR.cbPrev} variant="secondary" disabled={page <= 1} onPress={() => go(page - 1)} />
      <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary, minWidth: 110, textAlign: "center" }}>
        {position}
      </Text>
      <Button title={STR.cbNext} variant="secondary" disabled={page >= total} onPress={() => go(page + 1)} />
    </View>
  );

  return (
    <Screen padded={false} bleed>
      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: space(4), alignItems: zoom === 1 ? "center" : "flex-start" }}>
        {q.error ? <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} /> : null}
        <ScrollView horizontal scrollEnabled={zoom > 1} contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}>
          <View
            {...swipe.panHandlers}
            style={{
              width: pageWidth,
              height: pageHeight,
              backgroundColor: "#FFFFFF",
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
              justifyContent: "center",
              ...(Platform.OS === "web" ? ({ userSelect: "none" } as object) : null),
            }}
          >
            {uri ? (
              <Image source={{ uri }} style={{ width: pageWidth, height: pageHeight }} resizeMode="contain" />
            ) : (
              <Muted>{STR.loading}</Muted>
            )}
            {/* Transparent cover: a long-press / right-click lands here, not on the image. */}
            <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          </View>
        </ScrollView>
        <View style={{ marginTop: space(4), alignSelf: "stretch" }}>{pager}</View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space(2), flexWrap: "wrap", marginTop: space(2), alignSelf: "stretch" }}>
          <TextInput
            value={goTo}
            onChangeText={(t) => setGoTo(t.replace(/[^0-9০-৯]/g, ""))}
            placeholder={STR.cbGoToPh}
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            onSubmitEditing={() => {
              const n = Number(goTo.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))));
              if (n) go(n);
              setGoTo("");
            }}
            style={{
              width: 90,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.sm,
              paddingHorizontal: space(2),
              paddingVertical: space(1),
              color: colors.textPrimary,
              backgroundColor: colors.bg,
            }}
          />
          <Button
            title={STR.cbGoTo}
            variant="ghost"
            onPress={() => {
              const n = Number(goTo.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))));
              if (n) go(n);
              setGoTo("");
            }}
          />
          <Button title={`− ${STR.cbZoomOut}`} variant="ghost" disabled={zoomIdx === 0} onPress={() => setZoomIdx(zoomIdx - 1)} />
          <Button title={`＋ ${STR.cbZoomIn}`} variant="ghost" disabled={zoomIdx === ZOOMS.length - 1} onPress={() => setZoomIdx(zoomIdx + 1)} />
        </View>
        <Muted style={{ textAlign: "center", marginTop: space(3), alignSelf: "stretch" }}>{STR.cbViewOnly}</Muted>
      </ScrollView>
    </Screen>
  );
}

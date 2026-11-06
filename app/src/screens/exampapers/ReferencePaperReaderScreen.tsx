/**
 * ReferencePaperReaderScreen (D-#1030) — one Mohammadpur paper, every page stacked (a paper is
 * a few pages, so scrolling beats paging), with zoom steps and the original file one tap away.
 */
import React, { useLayoutEffect, useState } from "react";
import { Image, ScrollView, View, useWindowDimensions } from "react-native";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { REFERENCE_PAPER_PAGE_QUERY } from "../../graphql/examPapers";
import { Button, ErrorBanner, Muted, Screen } from "../../components/ui";
import { openStoredFile } from "../../lib/files";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum } from "../../lib/labels";
import type { ExamPapersStackParamList } from "../../navigation/types";
import { space, useColors } from "../../theme";

type Props = NativeStackScreenProps<ExamPapersStackParamList, "ReferencePaperReader">;

const ZOOMS = [1, 1.5, 2];
const MAX_PAGE_WIDTH = 820;

function Page({ paperId, page, width, aspect }: { paperId: string; page: number; width: number; aspect: number }): React.ReactElement {
  const colors = useColors();
  const [q, refetch] = useQuery({ query: REFERENCE_PAPER_PAGE_QUERY, variables: { paperId, page } });
  const uri = q.data?.referencePaperPage?.dataUri;
  const height = Math.round(width * (aspect || 1.414));
  return (
    <View style={{ marginBottom: space(3) }}>
      {q.error ? <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} /> : null}
      <View
        style={{
          width,
          height,
          backgroundColor: "#FFFFFF",
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {uri ? <Image source={{ uri }} style={{ width, height }} resizeMode="contain" /> : <Muted>{STR.loading}</Muted>}
      </View>
      <Muted style={{ textAlign: "center", marginTop: space(1) }}>{bnNum(page)}</Muted>
    </View>
  );
}

export default function ReferencePaperReaderScreen({ route, navigation }: Props): React.ReactElement {
  const { paperId, title, pageCount, pageAspect, sourceFileId } = route.params;
  const { width } = useWindowDimensions();
  const [zoomIdx, setZoomIdx] = useState(0);
  useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);
  const zoom = ZOOMS[zoomIdx];
  const pageWidth = Math.round(Math.min(width - space(4) * 2, MAX_PAGE_WIDTH) * zoom);
  return (
    <Screen padded={false} bleed>
      <ScrollView contentContainerStyle={{ padding: space(4), alignItems: zoom === 1 ? "center" : "flex-start" }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginBottom: space(3), alignSelf: "stretch", justifyContent: "center" }}>
          {sourceFileId ? <Button title={STR.epOpenOriginal} variant="secondary" onPress={() => void openStoredFile(sourceFileId)} /> : null}
          <Button title="−" variant="ghost" disabled={zoomIdx === 0} onPress={() => setZoomIdx(zoomIdx - 1)} />
          <Button title="＋" variant="ghost" disabled={zoomIdx === ZOOMS.length - 1} onPress={() => setZoomIdx(zoomIdx + 1)} />
        </View>
        <ScrollView horizontal scrollEnabled={zoom > 1}>
          <View>
            {Array.from({ length: Math.max(1, pageCount) }, (_, i) => (
              <Page key={i} paperId={paperId} page={i + 1} width={pageWidth} aspect={pageAspect} />
            ))}
          </View>
        </ScrollView>
      </ScrollView>
    </Screen>
  );
}

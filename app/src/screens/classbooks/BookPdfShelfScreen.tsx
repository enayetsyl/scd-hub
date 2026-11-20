/**
 * BookPdfShelfScreen (PB-2, D-#1657; nov-ops F4) — the teachers' viewer of the printed book PDFs:
 * a book, its chapter list, and tapping a chapter opens that chapter's real pages. Teachers only
 * (the server refuses guardians); view only.
 */
import React from "react";
import { RefreshControl, Text, View } from "react-native";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BOOK_PDF_SHELF, type BookPdfT } from "../../graphql/bookPdf";
import { Body, Button, Card, EmptyState, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { usePullRefresh } from "../../lib/useRefresh";
import { STR, bnNum, classLevelLabel, subjectLabel } from "../../lib/labels";
import type { ClassBooksStackParamList } from "../../navigation/types";
import { space, typeScale, useColors } from "../../theme";

type Props = NativeStackScreenProps<ClassBooksStackParamList, "BookPdfShelf">;

export default function BookPdfShelfScreen({ navigation }: Props): React.ReactElement {
  const colors = useColors();
  const [q, refetch] = useQuery({ query: BOOK_PDF_SHELF, requestPolicy: "cache-and-network" });
  const pull = usePullRefresh(q.fetching, () => refetch({ requestPolicy: "network-only" }));
  const books = q.data?.bookPdfShelf ?? [];

  const open = (b: BookPdfT, title: string, fromPage: number, toPage: number): void =>
    navigation.navigate("BookPdfReader", { pdfId: b.id, title, fromPage, toPage, pageAspect: b.pageAspect });

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}>
      <Notice tone="info" message={STR.bpdShelfHint} />
      <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} isEmpty={books.length === 0} empty={<EmptyState message={STR.bpdEmpty} />}>
        {books.map((b) => {
          const chapters = [...b.chapters].sort((a, c) => a.fromPage - c.fromPage);
          return (
            <Card key={b.id} style={{ marginBottom: space(3) }}>
              <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>{b.titleBn}</Text>
              <Muted>
                {classLevelLabel(b.classLevel)} · {subjectLabel(b.subject)}
                {b.versionLabel ? ` · ${b.versionLabel}` : ""} · {STR.bpdPageCount.replace("{n}", bnNum(b.pageCount))}
              </Muted>
              <View style={{ marginTop: space(2), gap: space(2) }}>
                {chapters.map((c) => (
                  <Button
                    key={c.key}
                    title={`${c.title || c.key} · ${STR.bpdPages.replace("{a}", bnNum(c.fromPage)).replace("{b}", bnNum(Math.min(c.toPage, b.pageCount)))}`}
                    variant="secondary"
                    onPress={() => open(b, c.title || c.key, c.fromPage, Math.min(c.toPage, b.pageCount))}
                  />
                ))}
                {chapters.length === 0 ? <Body>{STR.bpdNoRange}</Body> : null}
                <Button title={STR.bpdWholeBook} variant="ghost" onPress={() => open(b, b.titleBn, 1, b.pageCount)} />
              </View>
            </Card>
          );
        })}
      </QueryGate>
    </Screen>
  );
}

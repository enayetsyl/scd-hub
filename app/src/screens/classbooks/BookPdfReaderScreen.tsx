/**
 * BookPdfReaderScreen (PB-2, D-#1661) — one chapter (or the whole book) of the printed PDF, page
 * images one under the other; tap a page to enlarge. Teachers only; view only.
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import BookPdfPages from "../../components/BookPdfPages";
import { Screen } from "../../components/ui";
import type { ClassBooksStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ClassBooksStackParamList, "BookPdfReader">;

export default function BookPdfReaderScreen({ route, navigation }: Props): React.ReactElement {
  const { pdfId, title, fromPage, toPage, pageAspect } = route.params;
  React.useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);
  return (
    <Screen scroll>
      <BookPdfPages pdfId={pdfId} fromPage={fromPage} toPage={toPage} pageAspect={pageAspect} />
    </Screen>
  );
}

/**
 * The Office's picture picker for an oral picture question (D-#1282): the worksheet picture
 * bank (ছবির ভাণ্ডার) of one book, as a grid. Tapping a picture adds it to the question (its
 * number shows in the corner); tapping again takes it out. Pictures hidden from worksheets
 * are shown dimmed but can still be chosen.
 */
import React from "react";
import { Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "urql";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WORKSHEET_PICTURE_BOOKS, WORKSHEET_PICTURE_BOOK_LABELS_BN, type WorksheetPictureBook } from "@scd/shared";
import { VIVA_PICTURE_BANK, type VivaPictureT } from "../../graphql/viva";
import { Body, Button, Chip, ChipRow, H2, Muted } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum } from "../../lib/labels";
import { space, useColors } from "../../theme";

/** The picture book that fits a paper's subject and class (Nursery আরবি → book 1). */
export function defaultPictureBook(subject: string, classLevel: number): WorksheetPictureBook {
  if (subject === "ARABIC") return classLevel >= 0 ? "ARABIC_KG" : "ARABIC";
  if (subject === "ENG") return "ENG";
  if (subject === "MATH") return "MATH_B";
  return "BAN";
}

export function PicturePicker({
  visible,
  initialBook,
  selected,
  onToggle,
  onSeen,
  onClose,
}: {
  visible: boolean;
  initialBook: WorksheetPictureBook;
  selected: string[];
  onToggle: (id: string) => void;
  /** Hands the shown pictures back so the editor can draw their thumbnails. */
  onSeen: (pics: VivaPictureT[]) => void;
  onClose: () => void;
}): React.ReactElement {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [book, setBook] = React.useState<WorksheetPictureBook>(initialBook);
  const [q, reexec] = useQuery({ query: VIVA_PICTURE_BANK, variables: { book }, pause: !visible });
  const pics = q.data?.vivaPictureBank ?? [];
  React.useEffect(() => {
    if (pics.length) onSeen(pics);
  }, [pics, onSeen]);
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top + space(3), paddingBottom: insets.bottom + space(3), gap: space(2) }}>
        <View style={{ paddingHorizontal: space(4), gap: space(1) }}>
          <H2>{STR.vivaPickPictures}</H2>
          <Muted>{STR.vivaPickHelp.replace("{n}", bnNum(selected.length))}</Muted>
          <ChipRow>
            {WORKSHEET_PICTURE_BOOKS.map((b) => (
              <Chip key={b} label={WORKSHEET_PICTURE_BOOK_LABELS_BN[b]} selected={b === book} onPress={() => setBook(b)} />
            ))}
          </ChipRow>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space(4), flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
          <QueryGate result={q} onRetry={() => reexec({ requestPolicy: "network-only" })}>
            {pics.map((p) => {
              const n = selected.indexOf(p.id);
              return (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.word} ${p.wordEn}`}
                  onPress={() => onToggle(p.id)}
                  style={{
                    width: 100,
                    borderRadius: 12,
                    borderWidth: n >= 0 ? 3 : 1,
                    borderColor: n >= 0 ? colors.primary : colors.border,
                    padding: space(1),
                    opacity: p.active ? 1 : 0.55,
                    backgroundColor: "#ffffff",
                  }}
                >
                  <Image source={{ uri: p.uri }} style={{ width: "100%", height: 80 }} resizeMode="contain" />
                  <Text style={{ textAlign: "center", fontSize: 16, color: "#222" }} numberOfLines={1}>
                    {p.word}
                  </Text>
                  <Text style={{ textAlign: "center", fontSize: 11, color: "#666" }} numberOfLines={1}>
                    {p.active ? p.wordEn : `${p.wordEn} · ${STR.vivaPicHidden}`}
                  </Text>
                  {n >= 0 ? (
                    <View style={{ position: "absolute", top: 4, left: 4, minWidth: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
                      <Body style={{ color: "#ffffff", fontWeight: "700" }}>{bnNum(n + 1)}</Body>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </QueryGate>
        </ScrollView>
        <View style={{ paddingHorizontal: space(4) }}>
          <Button title={STR.vivaPickDone.replace("{n}", bnNum(selected.length))} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

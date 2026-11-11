/**
 * Picture questions on the oral mark sheet (D-#1282, docs/prd-viva.md §9.6).
 *
 * The examiner opens a child's pictures and holds the phone up: one big picture at a time,
 * "৩/১০" at the top. The answer word is hidden until the examiner taps উত্তর দেখুন, so the
 * child never sees it. ✓ gives the picture's marks, ✗ gives ০; either moves to the next
 * picture. Every tap is saved at once (the same setVivaMark as letters: `<key>:<index>`).
 *
 * On the child's card the pictures show as numbered chips (✓ / ✗ once marked); a chip opens
 * the viewer at that picture, so a wrong tap is corrected there.
 */
import React from "react";
import { Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { VivaItemT, VivaPictureT } from "../../graphql/viva";
import { vivaNum } from "../../graphql/viva";
import { Body, Button, Chip, ChipRow, Muted } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { space, useColors } from "../../theme";

/** The child's card: one chip per picture; tapping one opens the viewer there. */
export function PictureChips({
  item,
  byKey,
  onOpen,
}: {
  item: VivaItemT;
  byKey: Map<string, number>;
  onOpen: (index: number) => void;
}): React.ReactElement {
  const first = item.parts.findIndex((_, i) => !byKey.has(`${item.key}:${i}`));
  return (
    <View style={{ gap: space(2) }}>
      <ChipRow>
        {item.parts.map((_, i) => {
          const v = byKey.get(`${item.key}:${i}`);
          const mark = v == null ? "" : v > 0 ? " ✓" : " ✗";
          return <Chip key={i} label={`${bnNum(i + 1)}${mark}`} selected={v != null && v > 0} onPress={() => onOpen(i)} />;
        })}
      </ChipRow>
      <Button title={first < 0 ? STR.vivaPicReview : STR.vivaShowPictures} variant={first < 0 ? "secondary" : "primary"} onPress={() => onOpen(Math.max(0, first))} />
    </View>
  );
}

/** Full-screen: one picture, hidden answer, ✓ / ✗, next / previous. */
export function PictureViewer({
  visible,
  childName,
  item,
  pictures,
  byKey,
  start,
  disabled,
  onMark,
  onClose,
}: {
  visible: boolean;
  childName: string;
  item: VivaItemT | null;
  pictures: Map<string, VivaPictureT>;
  byKey: Map<string, number>;
  start: number;
  disabled: boolean;
  onMark: (key: string, v: number | null) => void;
  onClose: () => void;
}): React.ReactElement | null {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [i, setI] = React.useState(start);
  const [answer, setAnswer] = React.useState(false);
  React.useEffect(() => {
    setI(start);
    setAnswer(false);
  }, [start, item?.key, visible]);
  if (!item) return null;
  const n = item.parts.length;
  const pic = pictures.get(item.pictureIds[i] ?? "");
  const k = `${item.key}:${i}`;
  const v = byKey.has(k) ? byKey.get(k)! : null;
  const total = item.parts.reduce((a, _, j) => a + (byKey.get(`${item.key}:${j}`) ?? 0), 0);
  const marked = item.parts.filter((_, j) => byKey.has(`${item.key}:${j}`)).length;
  const go = (to: number) => {
    setAnswer(false);
    setI(Math.max(0, Math.min(n - 1, to)));
  };
  const give = (value: number) => {
    if (disabled) return;
    onMark(k, v === value ? null : value);
    // Move on after a fresh mark; stay put when clearing.
    if (v !== value && i < n - 1) go(i + 1);
  };
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top + space(2), paddingBottom: insets.bottom + space(3) }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space(4), gap: space(2) }}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: "700" }}>{childName}</Body>
            <Muted>{STR.vivaPicDone.replace("{d}", bnNum(marked)).replace("{n}", bnNum(n)).replace("{t}", vivaNum(total))}</Muted>
          </View>
          <Text style={{ fontSize: 22, fontWeight: "700", color: colors.textPrimary }}>
            {bnNum(i + 1)}/{bnNum(n)}
          </Text>
        </View>
        <View style={{ flex: 1, margin: space(4), borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: "hidden", backgroundColor: "#ffffff" }}>
          {pic?.uri ? (
            <Image source={{ uri: pic.uri }} style={{ width: "100%", height: "100%" }} resizeMode="contain" accessibilityLabel={STR.vivaPicN.replace("{n}", bnNum(i + 1))} />
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Muted>{STR.vivaPicLoading}</Muted>
            </View>
          )}
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: space(4), gap: space(3) }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAnswer((a) => !a)}
            style={{ alignItems: "center", paddingVertical: space(2), borderRadius: 12, backgroundColor: colors.surfaceAlt }}
          >
            {answer ? (
              <View style={{ alignItems: "center" }}>
                <Text style={{ fontSize: 30, color: colors.textPrimary }}>{item.parts[i]}</Text>
                {pic?.wordEn ? <Muted>{pic.wordEn}</Muted> : null}
                <Muted>{STR.vivaHideAnswer}</Muted>
              </View>
            ) : (
              <Body style={{ fontWeight: "700" }}>{STR.vivaShowAnswer}</Body>
            )}
          </Pressable>
          <View style={{ flexDirection: "row", gap: space(3) }}>
            <View style={{ flex: 1 }}>
              <Button
                title={`${STR.vivaPicRight} (${vivaNum(item.partMarks)})${v != null && v > 0 ? " ●" : ""}`}
                variant={v != null && v > 0 ? "primary" : "secondary"}
                disabled={disabled}
                onPress={() => give(item.partMarks)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={`${STR.vivaPicWrong} (০)${v === 0 ? " ●" : ""}`}
                variant={v === 0 ? "danger" : "secondary"}
                disabled={disabled}
                onPress={() => give(0)}
              />
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: space(2), justifyContent: "space-between" }}>
            <Button title={STR.vivaPicPrev} variant="ghost" disabled={i === 0} onPress={() => go(i - 1)} />
            <Button title={STR.vivaPicClose} variant="ghost" onPress={onClose} />
            <Button title={STR.vivaPicNext} variant="ghost" disabled={i >= n - 1} onPress={() => go(i + 1)} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

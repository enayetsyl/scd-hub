/**
 * MeetingCommentGuideLink (D-#850) — "📖 read the comment-writing guideline", at the top
 * of both meeting-comment write screens. Both live in the Home stack, as does the guide.
 */
import React from "react";
import { Pressable, Text } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { STR } from "../lib/labels";
import { useColors } from "../theme";
import type { HomeStackParamList } from "../navigation/types";

export function MeetingCommentGuideLink(): React.ReactElement {
  const c = useColors();
  const nav = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  return (
    <Pressable
      onPress={() => nav.navigate("MeetingCommentGuide")}
      accessibilityRole="link"
      hitSlop={8}
      style={{ alignSelf: "flex-start", minHeight: 32, justifyContent: "center" }}
    >
      <Text style={{ color: c.primary, fontWeight: "600", textDecorationLine: "underline" }}>{STR.mcGuideLink}</Text>
    </Pressable>
  );
}

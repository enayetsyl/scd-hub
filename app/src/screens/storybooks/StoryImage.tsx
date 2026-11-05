/**
 * A storybook cover / preview page (SB-1, D-#986), fetched one image at a time through the
 * shelf gate (`storybookImage`). Storybooks are landscape A4, so the box defaults to that
 * shape. A transparent cover sits on top, as in class books, so the web offers no
 * "save image".
 */
import React from "react";
import { Image, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useQuery } from "urql";
import { STORYBOOK_IMAGE_QUERY } from "../../graphql/storybooks";
import { radius, useColors } from "../../theme";

/** height / width of a landscape A4 page. */
export const STORYBOOK_ASPECT = 595 / 842;

export function StoryImage({
  fileId,
  aspect = STORYBOOK_ASPECT,
  style,
}: {
  fileId: string | null | undefined;
  aspect?: number;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const colors = useColors();
  const [q] = useQuery({ query: STORYBOOK_IMAGE_QUERY, variables: { fileId: fileId ?? "" }, pause: !fileId });
  const uri = q.data?.storybookImage;
  return (
    <View
      style={[
        {
          width: "100%",
          aspectRatio: 1 / aspect,
          borderRadius: radius.sm,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: "#FFFFFF",
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      {uri ? <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : <Text style={{ fontSize: 28 }}>📖</Text>}
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
    </View>
  );
}

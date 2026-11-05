/**
 * An activity bank's sample page (AS-1), one image at a time through the file gate
 * (`activityImage`). Sheets are portrait A4. A transparent cover sits on top so the web
 * offers no "save image".
 */
import React from "react";
import { Image, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useQuery } from "urql";
import { ACTIVITY_IMAGE_QUERY } from "../../graphql/activitySheets";
import { radius, useColors } from "../../theme";

export function ActivityImage({ fileId, style }: { fileId: string | null | undefined; style?: StyleProp<ViewStyle> }): React.ReactElement {
  const colors = useColors();
  const [q] = useQuery({ query: ACTIVITY_IMAGE_QUERY, variables: { fileId: fileId ?? "" }, pause: !fileId });
  const uri = q.data?.activityImage;
  return (
    <View
      style={[
        {
          width: "100%",
          aspectRatio: 595 / 842,
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
      {uri ? <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="contain" /> : <Text style={{ fontSize: 28 }}>🧩</Text>}
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
    </View>
  );
}

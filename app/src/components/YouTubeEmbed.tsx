/**
 * YouTubeEmbed — renders an embedded YouTube player on web (iframe) or an
 * "Open in YouTube" button on native (no WebView installed). Accepts a bare
 * 11-char video ID (callers extract it from the full URL before passing here).
 */
import React from "react";
import { Linking, Platform, View } from "react-native";
import { Button, Muted } from "./ui";
import { STR } from "../lib/labels";
import { space } from "../theme/tokens";

interface Props {
  videoId: string;
  /** Pixel height of the embed (web only). Defaults to 315. */
  height?: number;
}

export function YouTubeEmbed({ videoId, height = 315 }: Props): React.ReactElement {
  if (Platform.OS === "web") {
    // React Native Web allows native HTML element tags via string casts.
    const IFrame = "iframe" as unknown as React.ComponentType<
      React.IframeHTMLAttributes<HTMLIFrameElement> & { style?: React.CSSProperties }
    >;
    return (
      <View style={{ width: "100%", marginVertical: space(2) }}>
        <IFrame
          src={`https://www.youtube.com/embed/${videoId}`}
          style={{ width: "100%", height, border: "none" }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </View>
    );
  }

  // Native: no WebView installed — open in YouTube app / browser
  return (
    <View style={{ marginVertical: space(2) }}>
      <Muted>{STR.obsVideoPlayer}</Muted>
      <Button
        title={STR.obsOpenVideo}
        variant="secondary"
        onPress={() => void Linking.openURL(`https://www.youtube.com/watch?v=${videoId}`)}
      />
    </View>
  );
}

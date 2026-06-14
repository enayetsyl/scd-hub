/**
 * RecordingPlayer (CO-2) — play a YouTube-unlisted session recording on ANY platform.
 *
 * An unlisted video is link-viewable (no sign-in, no OAuth), so playback needs only
 * the id: tapping opens the watch URL — a new browser tab on web, the YouTube app /
 * browser on native (expo handles the intent). This is intentionally independent of
 * the web-only UPLOAD path, so mobile users can always watch (the CO-2 design point).
 *
 * Reusable: CO-3 embeds this in the observation detail once footage is released.
 */
import React from "react";
import { Linking } from "react-native";
import { Button, Muted } from "./ui";
import { STR } from "../lib/labels";
import { space } from "../theme";

export function RecordingPlayer({
  youtubeVideoId,
  label,
}: {
  youtubeVideoId: string;
  label?: string;
}): React.ReactElement {
  const url = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
  return (
    <>
      <Button title={label ?? STR.coWatch} variant="secondary" onPress={() => void Linking.openURL(url)} />
      <Muted style={{ marginTop: space(1) }}>{STR.coVideoId}: {youtubeVideoId}</Muted>
    </>
  );
}

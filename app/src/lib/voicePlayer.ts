/**
 * Playback of a stored voice clip (VN-1, D-#1658) — the counterpart of voiceRecorder.ts.
 *
 * WEB: the clip is fetched with the sign-in token into a blob URL and played with an <audio>
 * element (WAV from the web recorder; AAC from a phone recording plays in current browsers).
 * ANDROID: downloaded to the cache, then played with expo-av. expo-av is a NATIVE module: an APK
 * built before 1.1.7 has no `ExponentAV`, and importing the package there throws at load, so it
 * is only `require`d after `requireOptionalNativeModule` confirms it (the voiceRecorder pattern).
 *
 * One clip plays at a time: starting another stops the first.
 */
import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import { localUriForStoredFile } from "./files";

const nativeAudio: boolean = Platform.OS === "android" && !!requireOptionalNativeModule("ExponentAV");

/** This build can play a clip (web, or an Android APK with the audio module). */
export function canPlayHere(): boolean {
  if (Platform.OS === "web") return typeof Audio !== "undefined";
  return nativeAudio;
}

export interface ClipPlayback {
  stop(): void;
}

let current: ClipPlayback | null = null;

/** Stop whatever clip is playing (a screen calls it on unmount). */
export function stopAllClips(): void {
  current?.stop();
  current = null;
}

type AvLib = typeof import("expo-av");

/**
 * Start playing the clip stored as `fileId`. `onEnd` fires once when it finishes or is stopped.
 * Throws if the bytes cannot be fetched or this build cannot play audio.
 */
export async function playClip(fileId: string, mime: string, onEnd: () => void): Promise<ClipPlayback> {
  if (!canPlayHere()) throw new Error("playback not supported");
  stopAllClips();
  const ext = mime.includes("aac") ? "aac" : "wav";
  const uri = await localUriForStoredFile(fileId, ext);
  let ended = false;
  const finish = (): void => {
    if (ended) return;
    ended = true;
    if (current === playback) current = null;
    // The web copy is a blob URL: free it when playback ends or is stopped (unmount stops it too).
    if (Platform.OS === "web") URL.revokeObjectURL(uri);
    onEnd();
  };

  let playback: ClipPlayback;
  if (Platform.OS === "web") {
    const el = new Audio(uri);
    el.onended = finish;
    el.onerror = finish;
    playback = {
      stop() {
        el.pause();
        finish();
      },
    };
    current = playback;
    try {
      await el.play();
    } catch (e) {
      current = null;
      URL.revokeObjectURL(uri);
      throw e;
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Audio: AV } = require("expo-av") as AvLib;
    await AV.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
    const { sound } = await AV.Sound.createAsync({ uri }, { shouldPlay: true }, (status) => {
      if (status.isLoaded && status.didJustFinish) {
        void sound.unloadAsync().catch(() => undefined);
        finish();
      }
    });
    playback = {
      stop() {
        void sound.stopAsync().catch(() => undefined);
        void sound.unloadAsync().catch(() => undefined);
        finish();
      },
    };
    current = playback;
  }
  return playback;
}

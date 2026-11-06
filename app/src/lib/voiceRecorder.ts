/**
 * Voice recorder for the 🎤 on the work board (VT-2, D-#965; Android VT-5).
 *
 * WEB: the browser records in its own format (Chrome: WebM/Opus, Safari: MP4/AAC). WebM is
 * not on Gemini's documented audio list and the server has no transcoder, so the
 * recording is decoded here and re-encoded as 16 kHz mono 16-bit WAV — small enough
 * (~32 KB/s) and a format every model accepts.
 *
 * ANDROID (VT-5): expo-av records 16 kHz mono AAC in an ADTS stream (`audio/aac`, on
 * Gemini's list, ~4 KB/s). expo-av is a NATIVE module: an APK built before 1.1.7 has no
 * `ExponentAV`, and importing the package there throws at load. The same JS reaches old
 * phones by OTA, so the package is only `require`d after `requireOptionalNativeModule`
 * confirms it — old APKs keep `canRecordHere() === false` and show the "new app" notice.
 */
import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

export const MAX_RECORD_SECONDS = 90;
const RATE = 16000;

export interface Recording {
  base64: string;
  mimeType: string;
  seconds: number;
}

export interface Recorder {
  /** Stop and encode. */
  stop(): Promise<Recording>;
  /** Stop and throw the audio away. */
  cancel(): void;
}

/** The phone has the recorder module (APK 1.1.7+). */
const nativeAudio: boolean = Platform.OS === "android" && !!requireOptionalNativeModule("ExponentAV");

export function canRecordHere(): boolean {
  if (Platform.OS !== "web") return nativeAudio;
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined" &&
    typeof OfflineAudioContext !== "undefined"
  );
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

/** PCM samples (−1..1, mono) → a 16-bit WAV file. */
export function encodeWav(samples: Float32Array, rate = RATE): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

async function toWav(blob: Blob): Promise<Recording> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const seconds = Math.min(decoded.duration, MAX_RECORD_SECONDS);
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * RATE)), RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return { base64: toBase64(encodeWav(rendered.getChannelData(0))), mimeType: "audio/wav", seconds };
  } finally {
    void ctx.close();
  }
}

type AvLib = typeof import("expo-av");
type FsLib = typeof import("expo-file-system");

/** Android: record AAC with expo-av, hand it over as base64. */
async function startNativeRecording(): Promise<Recorder> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Audio } = require("expo-av") as AvLib;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FileSystem = require("expo-file-system") as FsLib;
  const perm = await Audio.requestPermissionsAsync();
  if (!perm.granted) throw new Error("microphone refused");
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  const rec = new Audio.Recording();
  await rec.prepareToRecordAsync({
    isMeteringEnabled: false,
    android: {
      extension: ".aac",
      outputFormat: Audio.AndroidOutputFormat.AAC_ADTS,
      audioEncoder: Audio.AndroidAudioEncoder.AAC,
      sampleRate: RATE,
      numberOfChannels: 1,
      bitRate: 32000,
    },
    ios: Audio.RecordingOptionsPresets.LOW_QUALITY.ios,
    web: {},
  });
  await rec.startAsync();
  const discard = async (uri: string | null) => {
    if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  };
  return {
    async stop() {
      const status = await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (!uri) throw new Error("no recording");
      try {
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const seconds = Math.min((status.durationMillis ?? 0) / 1000, MAX_RECORD_SECONDS);
        return { base64, mimeType: "audio/aac", seconds };
      } finally {
        await discard(uri);
      }
    },
    cancel() {
      void rec
        .stopAndUnloadAsync()
        .catch(() => undefined)
        .then(() => discard(rec.getURI()));
    },
  };
}

/** Ask for the microphone and start recording. Throws if the person refuses it. */
export async function startRecording(): Promise<Recorder> {
  if (Platform.OS !== "web") return startNativeRecording();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
  });
  const release = () => stream.getTracks().forEach((t) => t.stop());
  rec.start();
  return {
    async stop() {
      if (rec.state !== "inactive") rec.stop();
      await stopped;
      release();
      return toWav(new Blob(chunks, { type: rec.mimeType }));
    },
    cancel() {
      if (rec.state !== "inactive") rec.stop();
      release();
    },
  };
}

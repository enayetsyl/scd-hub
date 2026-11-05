/**
 * Voice recorder for the 🎤 on the work board (VT-2, D-#965) — WEB ONLY for now.
 *
 * The browser records in its own format (Chrome: WebM/Opus, Safari: MP4/AAC). WebM is
 * not on Gemini's documented audio list and the server has no transcoder, so the
 * recording is decoded here and re-encoded as 16 kHz mono 16-bit WAV — small enough
 * (~32 KB/s) and a format every model accepts. The native app needs a recorder module
 * in a new APK (VT-5); until then `canRecordHere()` is false there.
 */
import { Platform } from "react-native";

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

export function canRecordHere(): boolean {
  return (
    Platform.OS === "web" &&
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

/** Ask for the microphone and start recording. Throws if the person refuses it. */
export async function startRecording(): Promise<Recorder> {
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

/**
 * ReviewVoiceTranscriptService — automatic transcripts of review voice notes (VN-T1, D-#1662).
 *
 * When a reviewer SENDS a review, each clip is queued for ONE Gemini call that writes down what was
 * said (verbatim, Bangla/English mix, no summary). The audio stays the source of truth; the transcript
 * is an aid. Fire-and-forget: a failure here never blocks or fails the submit.
 *
 * Status on the clip: PENDING | DONE | FAILED | QUOTA (Gemini 429 or our own cap) | NO_KEY | OFF.
 * A retry sweep (scheduler tick, in the background) retries PENDING / FAILED clips idle 10 minutes (max
 * 3 attempts) and QUOTA clips idle 60 minutes (a QUOTA never uses up an attempt). Calls are cap-checked
 * with the same assertWithinCaps the other capped AI features use, and metered through
 * `meteredGeminiFetch` (feature `voice_transcript`) so tokens and cost show on the AI usage screen.
 *
 * Who sees the text: only callers who can already hear the clip — the DTO is built by
 * ReviewVoiceNoteService.listReviewVoiceNotes, which row-scopes the clips; this file adds no read path.
 */
import { randomUUID } from "crypto";
import { Types } from "mongoose";
import { ReviewVoiceNote, type IReviewVoiceNote, type TranscriptStatus } from "../models/ReviewVoiceNote";
import { StoredFile } from "../../platform/models/StoredFile";
import { downloadFromDrive } from "../../platform/services/DriveStore";
import { aiRouteFor, refreshAiConfig } from "../../platform/services/AiSettingService";
import { AiCapError, assertWithinCaps, alertIfBudget } from "../../platform/services/AiUsageService";
import { meteredGeminiFetch } from "../../platform/ai/meteredFetch";

export const MAX_TRANSCRIPT_TRIES = 3;
export const TRANSCRIPT_RETRY_AFTER_MS = 10 * 60 * 1000;
/** A QUOTA clip (Gemini 429 or our own cap) waits an hour and does not use up a try. */
export const TRANSCRIPT_QUOTA_RETRY_AFTER_MS = 60 * 60 * 1000;
/** A PENDING clip out of tries and idle this long becomes FAILED (the app never shows "writing…" forever). */
export const TRANSCRIPT_STALE_PENDING_MS = 30 * 60 * 1000;
const SWEEP_PER_RUN = 2;
const REQUEUE_PER_RUN = 20;
const MAX_TRANSCRIPT_CHARS = 8000;

export const TRANSCRIPT_PROMPT =
  "Transcribe this voice note word for word, in the language spoken (Bangla, English, or a mix — keep each " +
  "word in the language it was spoken; write Bangla in Bangla script). Do NOT summarise, translate, correct, " +
  "explain or add anything. Output only the transcript text. If there is no speech, output nothing.";

/** A Gemini HTTP refusal; 429 becomes QUOTA, anything else FAILED. */
export class TranscriptHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Gemini transcription answered ${status}`);
    this.name = "TranscriptHttpError";
  }
}

/** The transport seam — tests replace it; production posts to Gemini. */
export interface TranscriptModel {
  readonly name: string;
  transcribe(audio: { mimeType: string; data: string }, ref: { noteId: string }): Promise<string>;
}

export class GeminiTranscriber implements TranscriptModel {
  constructor(
    private readonly apiKey: string,
    readonly name: string,
  ) {}

  async transcribe(audio: { mimeType: string; data: string }, ref: { noteId: string }): Promise<string> {
    const res = await meteredGeminiFetch(
      "voice_transcript",
      this.name,
      `https://generativelanguage.googleapis.com/v1beta/models/${this.name}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: TRANSCRIPT_PROMPT }, { inline_data: { mime_type: audio.mimeType, data: audio.data } }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: AbortSignal.timeout(60_000),
      },
      { refType: "review_voice_note", refId: ref.noteId },
    );
    if (!res.ok) throw new TranscriptHttpError(res.status);
    const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
    return (json.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("")
      .trim()
      .slice(0, MAX_TRANSCRIPT_CHARS);
  }
}

export interface Resolved {
  model: TranscriptModel | null;
  why: "OFF" | "NO_KEY" | null;
}

/** Resolve the transcriber from the feature switch + the saved key. `why` says why not, when model is null. */
export async function resolveTranscriber(): Promise<Resolved> {
  await refreshAiConfig();
  const route = await aiRouteFor("voice_transcript");
  if (!route.enabled) return { model: null, why: "OFF" };
  if (route.primary.provider !== "gemini" || !route.primary.key) return { model: null, why: "NO_KEY" };
  return { model: new GeminiTranscriber(route.primary.key, route.primary.model), why: null };
}

type Clock = () => Date;
const wallClock: Clock = () => new Date();

/** Atomically take one clip for an attempt (no two workers transcribe the same clip). */
async function claim(filter: Record<string, unknown>, nowFn: Clock): Promise<IReviewVoiceNote | null> {
  return (await ReviewVoiceNote.findOneAndUpdate(
    filter,
    { $set: { transcriptStatus: "PENDING", transcriptAttemptAt: nowFn() }, $inc: { transcriptTries: 1 } },
    { new: true },
  )) as IReviewVoiceNote | null;
}

async function finish(
  noteId: Types.ObjectId,
  set: Record<string, unknown>,
  nowFn: Clock,
  inc?: Record<string, number>,
): Promise<void> {
  await ReviewVoiceNote.updateOne({ _id: noteId }, { $set: { ...set, transcriptAttemptAt: nowFn() }, ...(inc ? { $inc: inc } : {}) });
}

/**
 * Transcribe one claimed clip. Never throws. `resolved` is the transcriber resolved ONCE per run
 * (undefined = resolve now). Before each Gemini call the same cap check the other capped features use
 * runs; a cap refusal or a 429 sets QUOTA and gives the try back.
 */
export async function transcribeClaimed(note: IReviewVoiceNote, resolved?: Resolved, nowFn: Clock = wallClock): Promise<TranscriptStatus> {
  const id = note._id;
  try {
    const r = resolved ?? (await resolveTranscriber());
    if (!r.model) {
      await finish(id, { transcriptStatus: r.why }, nowFn);
      return r.why!;
    }
    const model = r.model;
    try {
      await assertWithinCaps({
        feature: "voice_transcript",
        callId: randomUUID(),
        provider: "gemini",
        model: model.name,
        refType: "review_voice_note",
        refId: id.toString(),
      });
    } catch (err) {
      if (err instanceof AiCapError) {
        await finish(id, { transcriptStatus: "QUOTA" }, nowFn, { transcriptTries: -1 });
        return "QUOTA";
      }
      throw err;
    }
    const stored = (await StoredFile.findById(note.fileId).lean()) as unknown as { driveFileId?: string } | null;
    if (!stored?.driveFileId) throw new Error("voice note file missing");
    const bytes = await downloadFromDrive(stored.driveFileId);
    const text = await model.transcribe({ mimeType: note.mime, data: bytes.toString("base64") }, { noteId: id.toString() });
    await finish(id, { transcriptStatus: "DONE", transcript: text, transcriptModel: model.name, transcribedAt: nowFn() }, nowFn);
    await alertIfBudget("voice_transcript", nowFn()).catch(() => 0);
    return "DONE";
  } catch (err) {
    const quota = err instanceof TranscriptHttpError && err.status === 429;
    console.error(`[voice-transcript] clip ${id.toString()} ${quota ? "QUOTA" : "FAILED"}:`, err instanceof Error ? err.message : err);
    await finish(id, { transcriptStatus: quota ? "QUOTA" : "FAILED" }, nowFn, quota ? { transcriptTries: -1 } : undefined).catch(() => undefined);
    return quota ? "QUOTA" : "FAILED";
  }
}

/**
 * On submit: every SENT clip of the round that has no transcript status yet is queued (PENDING) and the
 * first attempt starts in the background. Never throws, never awaits Gemini.
 */
export async function queueVoiceTranscripts(
  assignmentId: string,
  reviewerId: string,
  kick: (assignmentId: string) => void = defaultKick,
): Promise<number> {
  try {
    const res = await ReviewVoiceNote.updateMany(
      {
        assignmentId: new Types.ObjectId(assignmentId),
        reviewerId: new Types.ObjectId(reviewerId),
        submitted: true,
        transcriptStatus: { $exists: false },
      },
      { $set: { transcriptStatus: "PENDING", transcriptTries: 0, transcriptAttemptAt: new Date() } },
    );
    const queued = res?.modifiedCount ?? 0;
    if (queued > 0) kick(assignmentId);
    return queued;
  } catch (err) {
    console.error("[voice-transcript] could not queue clips (the submit is unaffected):", err);
    return 0;
  }
}

function defaultKick(assignmentId: string): void {
  // Jest runs the submit path against mocks/in-memory DBs; a dangling background call there only adds noise.
  if (process.env.NODE_ENV === "test") return;
  void runFirstAttempts(assignmentId).catch((e) => console.error("[voice-transcript] first attempt failed:", e));
}

/** First attempt for the round's fresh PENDING clips, one at a time. The first QUOTA stops the run. */
export async function runFirstAttempts(assignmentId: string, resolvedIn?: Resolved, nowFn: Clock = wallClock): Promise<number> {
  const resolved = resolvedIn ?? (await resolveTranscriber());
  let n = 0;
  for (;;) {
    const note = await claim(
      { assignmentId: new Types.ObjectId(assignmentId), submitted: true, transcriptStatus: "PENDING", transcriptTries: 0 },
      nowFn,
    );
    if (!note) return n;
    n++;
    if ((await transcribeClaimed(note, resolved, nowFn)) === "QUOTA") return n;
  }
}

/**
 * The retry sweep (a few clips per run):
 *  - PENDING with no tries left and idle 30 min becomes FAILED;
 *  - when the transcriber resolves (switch on + key), OFF / NO_KEY clips are re-queued (bounded);
 *  - PENDING / FAILED clips idle 10 min (fewer than 3 tries) and QUOTA clips idle 60 min are retried;
 *  - the first QUOTA (429 or cap) ends the run.
 */
export async function sweepVoiceTranscripts(nowFn: Clock = wallClock, resolvedIn?: Resolved, max: number = SWEEP_PER_RUN): Promise<number> {
  const t0 = nowFn();
  await ReviewVoiceNote.updateMany(
    {
      submitted: true,
      transcriptStatus: "PENDING",
      transcriptTries: { $gte: MAX_TRANSCRIPT_TRIES },
      transcriptAttemptAt: { $lte: new Date(t0.getTime() - TRANSCRIPT_STALE_PENDING_MS) },
    },
    { $set: { transcriptStatus: "FAILED" } },
  );

  const resolved = resolvedIn ?? (await resolveTranscriber());
  if (resolved.model) {
    const idle = (await ReviewVoiceNote.find({ submitted: true, transcriptStatus: { $in: ["OFF", "NO_KEY"] } })
      .limit(REQUEUE_PER_RUN)
      .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
    if (idle.length > 0) {
      await ReviewVoiceNote.updateMany(
        { _id: { $in: idle.map((d) => d._id) } },
        { $set: { transcriptStatus: "PENDING", transcriptTries: 0, transcriptAttemptAt: new Date(0) } },
      );
    }
  }

  const retryCutoff = new Date(t0.getTime() - TRANSCRIPT_RETRY_AFTER_MS);
  const quotaCutoff = new Date(t0.getTime() - TRANSCRIPT_QUOTA_RETRY_AFTER_MS);
  const due = {
    submitted: true,
    $or: [
      { transcriptStatus: { $in: ["PENDING", "FAILED"] }, transcriptTries: { $lt: MAX_TRANSCRIPT_TRIES }, transcriptAttemptAt: { $lte: retryCutoff } },
      { transcriptStatus: { $in: ["PENDING", "FAILED"] }, transcriptTries: { $lt: MAX_TRANSCRIPT_TRIES }, transcriptAttemptAt: { $exists: false } },
      { transcriptStatus: "QUOTA", transcriptAttemptAt: { $lte: quotaCutoff } },
    ],
  };
  let n = 0;
  for (let i = 0; i < max; i++) {
    const note = await claim(due, nowFn);
    if (!note) break;
    n++;
    if ((await transcribeClaimed(note, resolved, nowFn)) === "QUOTA") break;
  }
  return n;
}

let sweepRunning = false;

/**
 * Called at the END of each scheduler tick: starts a sweep in the background and returns at once. A sweep
 * still running (Gemini is slow) means this tick skips. Never throws.
 */
export function startVoiceTranscriptSweep(): boolean {
  if (sweepRunning) return false;
  sweepRunning = true;
  void sweepVoiceTranscripts()
    .catch((e) => console.error("[voice-transcript] sweep failed (next tick retries):", e))
    .finally(() => {
      sweepRunning = false;
    });
  return true;
}

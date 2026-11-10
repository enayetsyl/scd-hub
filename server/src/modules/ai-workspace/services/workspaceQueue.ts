/**
 * The AI Workspace's in-process off-peak queue (W-2 chat turns, W-3 draft revisions).
 * Once a minute, while DeepSeek is off-peak, it answers what was queued for then. The API is
 * one process (systemd), like the notification ticker, so one timer is enough. Batch jobs
 * (W-4) run in their own worker process instead.
 */
import { AiDraft } from "../models/AiDraft";
import { failOrphanedAnswers, processQueuedChats } from "./ProjectChatService";
import { processQueuedRevisions } from "./DraftService";

let timer: ReturnType<typeof setInterval> | null = null;

/** Revisions left "running" by a restart become failed, so the draft is not stuck. */
async function failOrphanedRevisions(): Promise<void> {
  await AiDraft.updateMany({ "revise.status": "running" }, { $set: { "revise.status": "failed", "revise.error": "সার্ভার আবার চালু হওয়ায় সংশোধন থেমে গেছে — আবার চালান" } });
}

export async function workspaceQueueTick(now: Date = new Date()): Promise<{ chats: number; revisions: number }> {
  const chats = await processQueuedChats(now);
  const revisions = await processQueuedRevisions(now);
  return { chats, revisions };
}

export function startWorkspaceQueue(): void {
  if (timer) return;
  void failOrphanedAnswers().catch(() => undefined);
  void failOrphanedRevisions().catch(() => undefined);
  timer = setInterval(() => {
    void workspaceQueueTick().catch((e) => console.warn("[ai-workspace] queue tick failed:", (e as Error)?.message));
  }, 60_000);
  timer.unref?.();
}

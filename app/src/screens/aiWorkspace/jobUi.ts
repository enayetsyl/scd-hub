/** Batch-job label helpers (AI Workspace W-4). */
import { STR } from "../../lib/labels";

export const jobStatusLabel = (s: string): string =>
  ({
    queued: STR.awJobStatusQueued,
    running: STR.awJobStatusRunning,
    done: STR.awJobStatusDone,
    partial: STR.awJobStatusPartial,
    failed: STR.awJobStatusFailed,
    cancelled: STR.awJobStatusCancelled,
  })[s] ?? s;

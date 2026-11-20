/**
 * VoiceNotes — recorded clips on a review (VN-1, D-#1658; VN-2 reuses it for question review).
 *
 *   <VoiceNoteRecorder clips spots onAdd onDelete />  — the reviewer's editor: record a clip (90 s
 *       cap), optionally tag the spot it is about, play it back, delete it. Clips are saved by the
 *       caller (`onAdd`) the moment they are recorded, so nothing is lost before Submit.
 *   <VoiceNoteList clips />                           — read-only: a play button, the length and the
 *       spot of each clip (the plan author's / thread view).
 *
 * The component holds no server knowledge: the caller passes `onAdd` / `onDelete` and the clip
 * list, so any review kind can plug its own mutations in. AUDIO is the source of truth; an automatic transcript (VN-T1) shows under a sent clip.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { Badge, Button, Muted, Notice, Select } from "./ui";
import { STR, bnNum } from "../lib/labels";
import { fill } from "../lib/reviewSupervision";
import { canRecordHere, MAX_RECORD_SECONDS, startRecording, type Recorder, type Recording } from "../lib/voiceRecorder";
import { canPlayHere, playClip, stopAllClips, type ClipPlayback } from "../lib/voicePlayer";
import { makeStyles, space, typeScale } from "../theme";

export const MAX_VOICE_CLIPS = 10;

/** One clip as the component needs it (a subset of ReviewVoiceNoteT). */
export interface VoiceClip {
  id: string;
  fileId: string;
  mime: string;
  seconds: number;
  spot: string | null;
  /** True once the review was submitted. A sent clip cannot be deleted; a draft (false) shows "not sent yet". */
  submitted?: boolean;
  /** VN-T1 (D-#1662): automatic transcript. Shown only when DONE (non-empty) or PENDING; any other status shows nothing. */
  transcript?: string | null;
  transcriptStatus?: string | null;
}

/** Length as "12 সেকেন্ড" — whole seconds, never "0". */
function secondsText(seconds: number): string {
  return fill(STR.vnSeconds, { s: bnNum(Math.max(1, Math.round(seconds))) });
}

function ClipRow({
  clip,
  index,
  onDelete,
  deleting,
}: {
  clip: VoiceClip;
  index: number;
  onDelete?: (id: string) => void;
  deleting?: boolean;
}): React.ReactElement {
  const styles = useStyles();
  const [playing, setPlaying] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const handle = React.useRef<ClipPlayback | null>(null);

  React.useEffect(
    () => () => {
      handle.current?.stop();
    },
    [],
  );

  async function toggle(): Promise<void> {
    if (playing) {
      handle.current?.stop();
      return;
    }
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      handle.current = await playClip(clip.fileId, clip.mime, () => setPlaying(false));
      setPlaying(true);
    } catch {
      setErr(STR.vnPlayFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.rowTitle}>{fill(STR.vnClipN, { n: bnNum(index + 1) })}</Text>
        <Muted>{secondsText(clip.seconds)}</Muted>
      </View>
      {clip.submitted === false ? (
        <View style={styles.spotLine}>
          <Badge text={STR.vnUnsent} tone="warn" maxWidthPct={100} />
        </View>
      ) : null}
      {clip.spot ? (
        <View style={styles.spotLine}>
          <Badge text={clip.spot} tone="info" maxWidthPct={100} />
        </View>
      ) : null}
      <View style={styles.actions}>
        {canPlayHere() ? (
          <Button
            title={playing ? STR.vnPause : STR.vnPlay}
            onPress={() => void toggle()}
            variant="secondary"
            loading={busy}
            style={styles.actionBtn}
          />
        ) : null}
        {onDelete && clip.submitted !== true ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={STR.vnDelete}
            disabled={deleting}
            onPress={() => onDelete(clip.id)}
            hitSlop={6}
            style={({ pressed }) => [styles.delete, (pressed || deleting) && styles.pressed]}
          >
            <Text style={styles.deleteText}>{STR.vnDelete}</Text>
          </Pressable>
        ) : null}
      </View>
      {clip.transcriptStatus === "DONE" && clip.transcript ? (
        <View style={styles.transcript}>
          <Text style={styles.transcriptText} selectable>
            {clip.transcript}
          </Text>
          <Text style={styles.transcriptNote}>{STR.vnTranscriptNote}</Text>
        </View>
      ) : clip.transcriptStatus === "PENDING" ? (
        <Text style={styles.transcriptNote}>{STR.vnTranscriptPending}</Text>
      ) : null}
      {err ? <Notice message={err} tone="danger" /> : null}
    </View>
  );
}

/** Read-only clips (the plan author / thread view). Renders nothing when there are none. */
export function VoiceNoteList({ clips }: { clips: VoiceClip[] }): React.ReactElement | null {
  const styles = useStyles();
  React.useEffect(() => stopAllClips, []);
  if (clips.length === 0) return null;
  return (
    <View style={styles.list}>
      <Text style={styles.heading}>{STR.vnTitle}</Text>
      {!canPlayHere() ? <Notice message={STR.vnNoPlay} tone="info" /> : null}
      {clips.map((c, i) => (
        <ClipRow key={c.id} clip={c} index={i} />
      ))}
    </View>
  );
}

type Phase = "idle" | "recording" | "saving";

/**
 * The reviewer's editor. `onAdd` saves one finished recording (with its optional spot) and resolves
 * to an error message, or null when saved; `onDelete` removes a clip and resolves the same way.
 * The caller re-supplies `clips` after each change.
 */
export function VoiceNoteRecorder({
  clips,
  spots,
  onAdd,
  onDelete,
  maxClips = MAX_VOICE_CLIPS,
  disabled = false,
  roundSubmitted = false,
}: {
  clips: VoiceClip[];
  /** Spot choices (plan step / section labels); empty hides the picker. */
  spots: string[];
  onAdd: (rec: Recording, spot: string | null) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  maxClips?: number;
  disabled?: boolean;
  /** The round already has a submitted verdict: new clips go out with the next resubmit (a notice says so). */
  roundSubmitted?: boolean;
}): React.ReactElement {
  const styles = useStyles();
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [seconds, setSeconds] = React.useState(0);
  const [spot, setSpot] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const recorder = React.useRef<Recorder | null>(null);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const spotRef = React.useRef<string | null>(null);
  spotRef.current = spot;

  const stopTimer = (): void => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  React.useEffect(
    () => () => {
      stopTimer();
      recorder.current?.cancel();
      stopAllClips();
    },
    [],
  );

  const canRecord = canRecordHere();
  const full = clips.length >= maxClips;

  async function stop(): Promise<void> {
    stopTimer();
    const r = recorder.current;
    recorder.current = null;
    if (!r) return;
    setPhase("saving");
    try {
      const rec = await r.stop();
      const problem = await onAdd(rec, spotRef.current);
      if (problem) setError(problem);
      else setSpot(null);
    } catch {
      setError(STR.vnSaveFailed);
    }
    setPhase("idle");
  }

  async function record(): Promise<void> {
    setError(null);
    stopAllClips();
    try {
      recorder.current = await startRecording();
    } catch {
      setError(STR.vtMicDenied);
      return;
    }
    setSeconds(0);
    setPhase("recording");
    const started = Date.now();
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setSeconds(s);
      if (s >= MAX_RECORD_SECONDS) void stop();
    }, 250);
  }

  async function remove(id: string): Promise<void> {
    if (deletingId) return;
    setError(null);
    setDeletingId(id);
    const problem = await onDelete(id);
    setDeletingId(null);
    if (problem) setError(problem);
  }

  const spotOptions = spots.map((s) => ({ label: s, value: s }));

  return (
    <View style={styles.box}>
      <Text style={styles.heading}>{STR.vnTitle}</Text>
      <Muted>{STR.vnHint}</Muted>

      {!canRecord ? <Notice message={STR.vnNativeUpdate} tone="info" /> : null}
      {roundSubmitted ? <Notice message={STR.vnResubmitNote} tone="info" /> : null}

      {canRecord && spots.length > 0 && phase === "idle" && !full ? (
        <View style={styles.spotPick}>
          <Select
            label={STR.vnSpotLabel}
            value={spot}
            options={[{ label: STR.vnSpotNone, value: "" }, ...spotOptions]}
            onChange={(v) => setSpot(v === "" ? null : v)}
            placeholder={STR.vnSpotNone}
          />
        </View>
      ) : null}

      {canRecord ? (
        phase === "recording" ? (
          <View style={styles.recBlock}>
            <Notice message={fill(STR.vnRecording, { s: bnNum(seconds) })} tone="info" />
            <Button title={STR.vnStop} onPress={() => void stop()} variant="danger" />
          </View>
        ) : (
          <Button
            title={phase === "saving" ? STR.vnSaving : STR.vnRecord}
            onPress={() => void record()}
            loading={phase === "saving"}
            disabled={disabled || full}
            variant="secondary"
            style={styles.recBtn}
          />
        )
      ) : null}

      {full ? <Muted>{fill(STR.vnMax, { n: bnNum(maxClips) })}</Muted> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      {clips.map((c, i) => (
        <ClipRow key={c.id} clip={c} index={i} onDelete={(id) => void remove(id)} deleting={deletingId === c.id} />
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  box: { marginTop: space(3), gap: space(2) },
  list: { marginTop: space(2), gap: space(2) },
  heading: { ...typeScale.bodyStrong, color: colors.textPrimary },
  spotPick: { marginTop: space(1) },
  recBtn: { marginTop: space(1) },
  recBlock: { gap: space(2) },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: space(3),
    gap: space(2),
    backgroundColor: colors.surfaceAlt,
  },
  rowTop: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const, gap: space(2) },
  rowTitle: { ...typeScale.bodyStrong, color: colors.textPrimary, flexShrink: 1 },
  spotLine: { flexDirection: "row" as const, flexWrap: "wrap" as const },
  // Wraps rather than overflows at ~360 dp: the play button grows, the delete link drops below if tight.
  actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: space(3) },
  actionBtn: { minWidth: 120 },
  delete: { paddingVertical: space(2), paddingHorizontal: space(2) },
  deleteText: { ...typeScale.body, color: colors.error },
  pressed: { opacity: 0.6 },
  transcript: { gap: space(1) },
  transcriptText: { ...typeScale.body, color: colors.textPrimary },
  transcriptNote: { ...typeScale.caption, color: colors.textSecondary },
}));

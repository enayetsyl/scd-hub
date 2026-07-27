/**
 * RosterChipPass (RP-2, D-#355; inverted per owner 2026-07-27) — a roster of
 * student chips that DEFAULT OFF. The teacher taps only the students who ACTUALLY
 * did the action (submitted / were returned), which light up (✓); every untapped
 * chip counts as the "not done" side. A live counter reads
 * "{onLabel}: N · {offLabel}: M"; one commit button emits `[{id, on}]` for the
 * whole roster.
 *
 * (Originally attendance-style — default ON, tap the exceptions. The owner flipped
 * it so the teacher marks the affirmative minority, not the exceptions.)
 *
 * Purely presentational — it knows nothing about lifecycle states. The parent maps
 * `on → submitted/returned` and calls the pass mutation. Used four times across
 * homework + assignment (submit/return each), which is the reuse that makes the
 * assignment workspace cheap.
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { Body, Muted, Chip, ChipRow, Button } from "./ui";
import { bnNum } from "../lib/labels";
import { space } from "../theme/tokens";

export interface RosterChipStudent {
  id: string;
  name: string;
  /** Optional trailing hint on the chip (e.g. a chase count) — display only. */
  badge?: string;
}

export function RosterChipPass({
  students,
  onLabel,
  offLabel,
  commitLabel,
  busy = false,
  onCommit,
}: {
  students: RosterChipStudent[];
  onLabel: string;
  offLabel: string;
  commitLabel: string;
  busy?: boolean;
  onCommit: (entries: { id: string; on: boolean }[]) => void;
}): React.ReactElement {
  // "on" = ticked (the affirmative action — submitted/returned). Everyone starts OFF.
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  // Prune stale ids when the roster shrinks (e.g. after a refetch drops submitted
  // students) so a ticked id can't linger across passes.
  const present = useMemo(() => new Set(students.map((s) => s.id)), [students]);
  const live = useMemo(() => {
    const next = new Set<string>();
    for (const id of ticked) if (present.has(id)) next.add(id);
    return next;
  }, [ticked, present]);

  const onCount = live.size;
  const offCount = students.length - onCount;

  function toggle(id: string): void {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function commit(): void {
    onCommit(students.map((s) => ({ id: s.id, on: live.has(s.id) })));
    setTicked(new Set());
  }

  return (
    <View>
      <Muted style={{ marginBottom: space(1) }}>
        {onLabel}: <Body style={{ fontWeight: "700" }}>{bnNum(onCount)}</Body>
        {"  ·  "}
        {offLabel}: <Body style={{ fontWeight: "700" }}>{bnNum(offCount)}</Body>
      </Muted>
      <ChipRow>
        {students.map((s) => {
          const isTicked = live.has(s.id);
          const label = `${s.name}${s.badge ? ` ${s.badge}` : ""}${isTicked ? " ✓" : ""}`;
          return <Chip key={s.id} label={label} selected={isTicked} onPress={() => toggle(s.id)} />;
        })}
      </ChipRow>
      <View style={{ marginTop: space(2) }}>
        <Button title={commitLabel} onPress={commit} loading={busy} disabled={busy || students.length === 0} />
      </View>
    </View>
  );
}

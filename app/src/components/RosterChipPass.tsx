/**
 * RosterChipPass (RP-2, D-#355) — the attendance idiom (MarkAttendanceScreen,
 * D-#63) generalised for the two roster-shaped tracker stages. Every student is a
 * chip that DEFAULTS ON (the good outcome); the teacher taps only the exceptions,
 * which cross out (✗); a live counter reads "{onLabel}: N · {offLabel}: M"; one
 * commit button emits `[{id, on}]` for the whole roster.
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
  // "off" = crossed (the exception). Everyone starts ON.
  const [crossed, setCrossed] = useState<Set<string>>(new Set());

  // Prune stale ids when the roster shrinks (e.g. after a refetch drops submitted
  // students) so a crossed id can't linger across passes.
  const present = useMemo(() => new Set(students.map((s) => s.id)), [students]);
  const live = useMemo(() => {
    const next = new Set<string>();
    for (const id of crossed) if (present.has(id)) next.add(id);
    return next;
  }, [crossed, present]);

  const offCount = live.size;
  const onCount = students.length - offCount;

  function toggle(id: string): void {
    setCrossed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function commit(): void {
    onCommit(students.map((s) => ({ id: s.id, on: !live.has(s.id) })));
    setCrossed(new Set());
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
          const isCrossed = live.has(s.id);
          const label = `${s.name}${s.badge ? ` ${s.badge}` : ""}${isCrossed ? " ✗" : ""}`;
          return <Chip key={s.id} label={label} selected={!isCrossed} onPress={() => toggle(s.id)} />;
        })}
      </ChipRow>
      <View style={{ marginTop: space(2) }}>
        <Button title={commitLabel} onPress={commit} loading={busy} disabled={busy || students.length === 0} />
      </View>
    </View>
  );
}

/**
 * VivaSheetScreen (D-#1082, mockup screens 6–7) — one oral paper's children, every question
 * under each child's name. One tap = one mark, saved at once (live); tapping the chosen
 * mark again clears it. অনুপস্থিত hides the questions and counts the oral 0.
 *
 * The examiner sees only their own children; the Office (view / edit_all) sees everyone,
 * each with their examiner, and the list refreshes itself every 15 seconds so progress is
 * live. Questions up to 2 marks show every half step; larger ones show whole numbers and a
 * "+½" switch, so a 10-mark question stays one row.
 *
 * Question sets (D-#1275–#1277): on a paper with sets, a child shows only their name until the
 * examiner taps it — that tap draws the child's set (evenly, final) and the set's questions
 * appear under the name with a set badge. Letter questions mark each letter on its own.
 */
import React from "react";
import { Pressable, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  VIVA_DRAW_SET,
  VIVA_SET_ABSENT,
  VIVA_SET_MARK,
  VIVA_SHEET,
  vivaItemValue,
  vivaItemsOf,
  vivaNum,
  vivaSetLabel,
  vivaSteps,
  type VivaItemT,
  type VivaPaperT,
  type VivaRowT,
} from "../../graphql/viva";
import { Badge, Body, Button, Card, Chip, ChipRow, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum, fullDateLabel } from "../../lib/labels";
import type { VivaStackParamList } from "../../navigation/types";
import { space } from "../../theme";

type Props = NativeStackScreenProps<VivaStackParamList, "VivaSheet">;
type Filter = "all" | "left" | "done" | "absent";

/** The mark buttons of one question. `value` null = not marked yet. */
export function MarkPicker({
  max,
  value,
  disabled,
  onPick,
}: {
  max: number;
  value: number | null;
  disabled: boolean;
  onPick: (v: number | null) => void;
}): React.ReactElement {
  const pick = (v: number) => !disabled && onPick(value === v ? null : v);
  if (max <= 2) {
    return (
      <ChipRow>
        {vivaSteps(max).map((v) => (
          <Chip key={v} label={vivaNum(v)} selected={value === v} onPress={() => pick(v)} />
        ))}
      </ChipRow>
    );
  }
  const whole = value == null ? null : Math.floor(value);
  const half = value != null && value - Math.floor(value) >= 0.5;
  const wholes: number[] = [];
  for (let n = 0; n <= Math.floor(max); n++) wholes.push(n);
  return (
    <ChipRow>
      {wholes.map((n) => (
        <Chip
          key={n}
          label={bnNum(n)}
          selected={whole === n}
          onPress={() => {
            if (disabled) return;
            const v = half && n + 0.5 <= max ? n + 0.5 : n;
            onPick(value === v ? null : v);
          }}
        />
      ))}
      <Chip
        label={STR.vivaHalf}
        selected={half}
        onPress={() => {
          if (disabled) return;
          if (value == null) return onPick(0.5);
          const base = Math.floor(value);
          if (half) onPick(base);
          else if (base + 0.5 <= max) onPick(base + 0.5);
        }}
      />
    </ChipRow>
  );
}

/** A set's badge colour, by its place on the paper. */
export const SET_TONES = ["brand", "info", "gold", "warn", "ok", "muted"] as const;
export const setTone = (paper: VivaPaperT, setKey: string | null) =>
  SET_TONES[Math.max(0, paper.sets.findIndex((s) => s.key === setKey)) % SET_TONES.length]!;

/**
 * A letter question (D-#1277): one control per letter, the letter shown large so the teacher
 * can read it out. ½-mark letters (one word each) are one chip that cycles
 * not-yet → ✓ (½) → ✗ (০) → not-yet; bigger letters (two words, up to ১) get a 0 … max row.
 */
function LetterPicker({
  item,
  byKey,
  disabled,
  onMark,
}: {
  item: VivaItemT;
  byKey: Map<string, number>;
  disabled: boolean;
  onMark: (key: string, v: number | null) => void;
}): React.ReactElement {
  if (item.partMarks <= 0.5) {
    return (
      <ChipRow>
        {item.parts.map((letter, i) => {
          const k = `${item.key}:${i}`;
          const v = byKey.has(k) ? byKey.get(k)! : null;
          const mark = v == null ? "" : v > 0 ? " ✓" : " ✗";
          return (
            <Chip
              key={k}
              label={`${letter}${mark}`}
              selected={v != null && v > 0}
              onPress={() => !disabled && onMark(k, v == null ? item.partMarks : v > 0 ? 0 : null)}
            />
          );
        })}
      </ChipRow>
    );
  }
  return (
    <View style={{ gap: space(1) }}>
      {item.parts.map((letter, i) => {
        const k = `${item.key}:${i}`;
        return (
          <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
            <Body style={{ fontWeight: "700", fontSize: 20, width: 32, textAlign: "center" }}>{letter}</Body>
            <View style={{ flex: 1 }}>
              <MarkPicker max={item.partMarks} value={byKey.has(k) ? byKey.get(k)! : null} disabled={disabled} onPick={(v) => onMark(k, v)} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ChildCard({
  row,
  paper,
  showExaminer,
  busy,
  onMark,
  onAbsent,
  onDraw,
}: {
  row: VivaRowT;
  paper: VivaPaperT;
  showExaminer: boolean;
  busy: boolean;
  onMark: (key: string, v: number | null) => void;
  onAbsent: (absent: boolean) => void;
  onDraw: () => void;
}): React.ReactElement {
  const fullMarks = paper.fullMarks;
  const items = vivaItemsOf(paper, row);
  const setLabel = vivaSetLabel(paper, row.setKey);
  const byKey = new Map(row.marks.map((m) => [m.key, m.value]));
  const filled = items.filter((i) => vivaItemValue(i, byKey) != null).length;
  const waiting = row.needsDraw && !row.absent;
  const state = row.absent
    ? STR.vivaAbsentNote
    : waiting
      ? row.canEdit
        ? STR.vivaTapToDraw
        : STR.vivaNotDrawn
      : row.done
        ? STR.vivaStateDone
        : filled || row.marks.length
          ? STR.vivaStateStarted.replace("{f}", bnNum(filled)).replace("{n}", bnNum(items.length))
          : STR.vivaStateNone;
  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
      <Muted style={{ width: 28 }}>{row.roll ? bnNum(row.roll) : ""}</Muted>
      <View style={{ flex: 1 }}>
        <Body style={{ fontWeight: "700" }}>{row.name}</Body>
        <Muted>{state}</Muted>
        {showExaminer ? <Muted>{row.examinerName ? STR.vivaExaminerOf.replace("{name}", row.examinerName) : STR.vivaNoExaminer}</Muted> : null}
      </View>
      {setLabel ? <Badge text={setLabel} tone={setTone(paper, row.setKey)} /> : null}
      {!row.absent && row.marks.length ? <Badge text={`${vivaNum(row.total)}/${vivaNum(fullMarks)}`} tone={row.done ? "ok" : "warn"} /> : null}
    </View>
  );
  return (
    <Card>
      {waiting && row.canEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${row.name} — ${STR.vivaTapToDraw}`}
          disabled={busy}
          onPress={onDraw}
        >
          {header}
        </Pressable>
      ) : (
        header
      )}
      {row.canEdit ? (
        <Button
          title={row.absent ? STR.vivaMakePresent : STR.vivaAbsent}
          variant={row.absent ? "secondary" : "ghost"}
          disabled={busy}
          onPress={() => onAbsent(!row.absent)}
        />
      ) : null}
      {waiting && row.canEdit ? <Button title={STR.vivaDrawSet} variant="secondary" disabled={busy} onPress={onDraw} /> : null}
      {row.absent || waiting ? null : (
        <View style={{ gap: space(2), marginTop: space(1) }}>
          {items.map((it) => (
            <View key={it.key} style={{ gap: space(1) }}>
              <Body>
                {it.label}
                {it.ref ? ` (${it.ref})` : ""} <Muted>· {vivaNum(it.marks)}</Muted>
              </Body>
              {it.parts.length ? (
                <LetterPicker item={it} byKey={byKey} disabled={!row.canEdit} onMark={onMark} />
              ) : (
                <MarkPicker max={it.marks} value={byKey.has(it.key) ? byKey.get(it.key)! : null} disabled={!row.canEdit} onPick={(v) => onMark(it.key, v)} />
              )}
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

export default function VivaSheetScreen({ route }: Props): React.ReactElement {
  const { paperId } = route.params;
  const [q, reexec] = useQuery({ query: VIVA_SHEET, variables: { paperId } });
  const refetch = React.useCallback(() => reexec({ requestPolicy: "network-only" }), [reexec]);
  const [rows, setRows] = React.useState<VivaRowT[]>([]);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [, setMark] = useMutation(VIVA_SET_MARK);
  const [, setAbsent] = useMutation(VIVA_SET_ABSENT);
  const [, drawSet] = useMutation(VIVA_DRAW_SET);
  const sheet = q.data?.vivaSheet;

  React.useEffect(() => {
    if (sheet) setRows(sheet.rows);
  }, [sheet]);

  // Office watches live: refresh every 15 s while the screen is open.
  React.useEffect(() => {
    if (!sheet?.seesAll) return;
    const id = setInterval(refetch, 15_000);
    return () => clearInterval(id);
  }, [sheet?.seesAll, refetch]);

  const replace = (r: VivaRowT) => setRows((xs) => xs.map((x) => (x.studentId === r.studentId ? r : x)));

  const onMark = async (row: VivaRowT, key: string, value: number | null) => {
    setErr(null);
    // Optimistic: show the tap at once; the server's row replaces it.
    const before = row;
    replace({ ...row, marks: value == null ? row.marks.filter((m) => m.key !== key) : [...row.marks.filter((m) => m.key !== key), { key, value }] });
    const res = await setMark({ paperId, studentId: row.studentId, key, value });
    if (res.error || !res.data) {
      replace(before);
      setErr(friendlyError(res.error));
      return;
    }
    replace(res.data.setVivaMark);
  };

  const onDraw = async (row: VivaRowT) => {
    setErr(null);
    setBusy(row.studentId);
    const res = await drawSet({ paperId, studentId: row.studentId });
    setBusy(null);
    if (res.error || !res.data) return setErr(friendlyError(res.error));
    replace(res.data.drawVivaSet);
  };

  const onAbsent = async (row: VivaRowT, absent: boolean) => {
    setErr(null);
    setBusy(row.studentId);
    const res = await setAbsent({ paperId, studentId: row.studentId, absent });
    setBusy(null);
    if (res.error || !res.data) return setErr(friendlyError(res.error));
    replace(res.data.setVivaAbsent);
  };

  const counts = {
    all: rows.length,
    done: rows.filter((r) => r.done && !r.absent).length,
    absent: rows.filter((r) => r.absent).length,
  };
  const left = counts.all - counts.done - counts.absent;
  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "done" ? r.done && !r.absent : filter === "absent" ? r.absent : !r.done && !r.absent,
  );

  return (
    <Screen scroll>
      <QueryGate result={q} onRetry={refetch}>
        {sheet ? (
          <View style={{ gap: space(3) }}>
            <View style={{ gap: space(1) }}>
              <Body style={{ fontWeight: "700" }}>
                {sheet.paper.classLabelBn} · {sheet.paper.subjectLabelBn}
              </Body>
              <Muted>
                {STR.vivaOnDate.replace("{d}", fullDateLabel(sheet.paper.dateKey))} · {STR.vivaFull.replace("{n}", vivaNum(sheet.paper.fullMarks))}
              </Muted>
              <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                <Badge text={STR.vivaLive} tone="ok" />
                {sheet.paper.lockedAt ? <Badge text={STR.vivaLockedBadge} tone="danger" /> : null}
              </View>
            </View>
            <Notice tone="info" message={STR.vivaLiveHint} />
            <ChipRow>
              <Chip label={STR.vivaFilterAll.replace("{n}", bnNum(counts.all))} selected={filter === "all"} onPress={() => setFilter("all")} />
              <Chip label={STR.vivaFilterLeft.replace("{n}", bnNum(left))} selected={filter === "left"} onPress={() => setFilter("left")} />
              <Chip label={STR.vivaFilterDone.replace("{n}", bnNum(counts.done))} selected={filter === "done"} onPress={() => setFilter("done")} />
              <Chip label={STR.vivaFilterAbsent.replace("{n}", bnNum(counts.absent))} selected={filter === "absent"} onPress={() => setFilter("absent")} />
            </ChipRow>
            {err ? <Notice tone="danger" message={err} /> : null}
            {shown.map((r) => (
              <ChildCard
                key={r.studentId}
                row={r}
                paper={sheet.paper}
                showExaminer={sheet.seesAll}
                busy={busy === r.studentId}
                onMark={(key, v) => void onMark(r, key, v)}
                onAbsent={(a) => void onAbsent(r, a)}
                onDraw={() => void onDraw(r)}
              />
            ))}
          </View>
        ) : null}
      </QueryGate>
    </Screen>
  );
}

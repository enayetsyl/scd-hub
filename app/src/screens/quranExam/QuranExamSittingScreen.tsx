/**
 * QuranExamSittingScreen (D-#874/#876, mockup screens 7 and 10) — one student's sitting:
 * present/absent, then the marks exactly as the paper is laid out.
 *
 *  - ITEMS: every question of every section; small marks (≤ 5) are tapped as chips,
 *    larger ones typed or stepped. The total updates as you go.
 *  - HIFZ_DEDUCTION: তানবীহ and ফাত্হ per para of THIS sitting; the student's other
 *    sittings show read-only; the mark (full − floor(T/4) − 2F over all of them) is
 *    computed here as a preview and on the server for real.
 *  The examiner edits their own sitting; Office (edit_all) any; nobody once locked.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { QX_SAVE_RESULT, QX_SITTING, type QxDetailT } from "../../graphql/quranExam";
import { Badge, Body, Button, Card, Chip, ChipRow, Field, H2, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum, fullDateLabel } from "../../lib/labels";
import { qxHifzMark, qxLevelLabel, qxRange } from "../../lib/quranExam";
import type { QuranExamStackParamList } from "../../navigation/types";
import { space } from "../../theme";

type Props = NativeStackScreenProps<QuranExamStackParamList, "QuranExamSitting">;

const REASONS = ["UNKNOWN", "SICK", "GUARDIAN_INFORMED", "OTHER"] as const;
const REASON_LABEL = (r: string) =>
  r === "SICK" ? STR.qxReasonSick : r === "GUARDIAN_INFORMED" ? STR.qxReasonInformed : r === "OTHER" ? STR.qxReasonOther : STR.qxReasonUnknown;

/** A count (তানবীহ/ফাত্হ) has no meaningful ceiling, so it shows no "/ max". */
function Stepper({ value, max, onChange, disabled, label, count = false }: { value: number; max: number; onChange: (v: number) => void; disabled: boolean; label: string; count?: boolean }): React.ReactElement {
  if (max <= 5) {
    return (
      <ChipRow>
        {Array.from({ length: max + 1 }, (_, n) => (
          <Chip key={n} label={bnNum(n)} selected={n === value} onPress={() => !disabled && onChange(n)} />
        ))}
      </ChipRow>
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(1) }}>
      <Chip label="−" onPress={() => !disabled && onChange(Math.max(0, value - 1))} />
      <View style={{ width: 64 }}>
        <Field
          label={label}
          value={String(value)}
          onChangeText={(t) => {
            if (disabled) return;
            const n = Number(t.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))));
            if (Number.isFinite(n)) onChange(Math.min(max, Math.max(0, Math.round(n))));
          }}
        />
      </View>
      <Chip label="+" onPress={() => !disabled && onChange(Math.min(max, value + 1))} />
      {count ? null : <Muted>/ {bnNum(max)}</Muted>}
    </View>
  );
}

function Editor({ d, onSaved }: { d: QxDetailT; onSaved: (next: QxDetailT) => void }): React.ReactElement {
  const s = d.sitting;
  const p = d.paper;
  const ro = !d.canEdit;
  const [present, setPresent] = React.useState(s.status !== "ABSENT");
  const [marks, setMarks] = React.useState<number[]>(() => {
    const n = p.sections.reduce((a, x) => a + x.items.length, 0);
    return s.itemMarks && s.itemMarks.length === n ? s.itemMarks : Array(n).fill(0);
  });
  const [counts, setCounts] = React.useState(() =>
    s.paras.map((para) => s.hifzCounts.find((c) => c.para === para) ?? { para, tanbih: 0, fath: 0 }),
  );
  const [reason, setReason] = React.useState<string>(s.absenceReason ?? "UNKNOWN");
  const [comment, setComment] = React.useState(s.comment ?? "");
  const [saveState, save] = useMutation(QX_SAVE_RESULT);
  const saving = saveState.fetching;
  const [msg, setMsg] = React.useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const total = marks.reduce((a, v) => a + v, 0);
  const others = d.otherSittings.filter((x) => x.status === "DONE").flatMap((x) => x.hifzCounts);
  const T = [...others, ...counts].reduce((a, c) => a + c.tanbih, 0);
  const F = [...others, ...counts].reduce((a, c) => a + c.fath, 0);
  const hifz = p.scheme === "HIFZ_DEDUCTION" ? qxHifzMark(p.fullMarks, p.tanbihPerMark ?? 4, p.fathCost ?? 2, T, F) : null;

  async function submit() {
    const r = await save({
      id: s.id,
      present,
      itemMarks: present && p.scheme === "ITEMS" ? marks : null,
      hifzCounts: present && p.scheme === "HIFZ_DEDUCTION" ? counts : null,
      absenceReason: present ? null : reason,
      comment: comment.trim() || null,
    });
    if (r.error) setMsg({ tone: "danger", text: friendlyError(r.error) });
    else {
      setMsg({ tone: "ok", text: STR.qxSaved });
      if (r.data) onSaved(r.data.saveQuranExamResult);
    }
  }

  let at = 0;
  return (
    <View style={{ gap: space(3) }}>
      {d.locked ? <Notice tone="info" message={STR.qxLockedNote} /> : ro ? <Notice tone="info" message={STR.qxReadOnly} /> : null}
      <Body style={{ fontWeight: "700" }}>{STR.qxWasPresent}</Body>
      <ChipRow>
        <Chip label={STR.qxPresent} selected={present} onPress={() => !ro && setPresent(true)} />
        <Chip label={STR.qxAbsent} selected={!present} onPress={() => !ro && setPresent(false)} />
      </ChipRow>

      {present && p.scheme === "ITEMS"
        ? p.sections.map((sec) => {
            const from = at;
            at += sec.items.length;
            const got = marks.slice(from, at).reduce((a, v) => a + v, 0);
            const max = sec.items.reduce((a, i) => a + i.marks, 0);
            return (
              <Card key={sec.title}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Body style={{ fontWeight: "700" }}>{sec.title}</Body>
                  <Body style={{ fontWeight: "700" }}>
                    {bnNum(got)} / {bnNum(max)}
                  </Body>
                </View>
                {sec.items.map((it, i) => (
                  <View key={i} style={{ gap: space(1), marginTop: space(2) }}>
                    <Body>{it.label}</Body>
                    <Stepper
                      value={marks[from + i] ?? 0}
                      max={it.marks}
                      disabled={ro}
                      label={it.label}
                      onChange={(v) => setMarks((m) => m.map((x, k) => (k === from + i ? v : x)))}
                    />
                  </View>
                ))}
              </Card>
            );
          })
        : null}

      {present && p.scheme === "HIFZ_DEDUCTION" ? (
        <>
          {d.otherSittings.length ? (
            <Card>
              <Muted>{STR.qxEarlier}</Muted>
              {d.otherSittings.map((o) => (
                <View key={o.id} style={{ marginTop: space(1) }}>
                  <Body>
                    {fullDateLabel(o.dateKey)} · {o.examinerName}
                  </Body>
                  {o.status === "DONE" ? (
                    o.hifzCounts.map((c) => (
                      <Muted key={c.para}>
                        {STR.qxParaN.replace("{n}", bnNum(c.para))}: {STR.qxTanbih} {bnNum(c.tanbih)} · {STR.qxFath} {bnNum(c.fath)}
                      </Muted>
                    ))
                  ) : (
                    <Muted>{o.status === "ABSENT" ? STR.qxAbsent : STR.qxNotYet}</Muted>
                  )}
                </View>
              ))}
            </Card>
          ) : null}
          {counts.map((c, i) => (
            <Card key={c.para}>
              <Body style={{ fontWeight: "700" }}>{STR.qxParaN.replace("{n}", bnNum(c.para))}</Body>
              <View style={{ gap: space(2), marginTop: space(2) }}>
                <Stepper count value={c.tanbih} max={99} disabled={ro} label={STR.qxTanbih} onChange={(v) => setCounts((cs) => cs.map((x, k) => (k === i ? { ...x, tanbih: v } : x)))} />
                <Stepper count value={c.fath} max={99} disabled={ro} label={STR.qxFath} onChange={(v) => setCounts((cs) => cs.map((x, k) => (k === i ? { ...x, fath: v } : x)))} />
              </View>
            </Card>
          ))}
          {hifz ? (
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.qxHifzCalc}</Body>
              <Muted>{STR.qxTanbihTotal.replace("{n}", bnNum(T))} · {STR.qxFathTotal.replace("{n}", bnNum(F))}</Muted>
              <Muted>
                {STR.qxTanbihCut.replace("{t}", bnNum(p.tanbihPerMark ?? 4)).replace("{n}", bnNum(T))}: −{bnNum(hifz.tanbihCut)}
              </Muted>
              <Muted>
                {STR.qxFathCut.replace("{f}", bnNum(p.fathCost ?? 2)).replace("{n}", bnNum(F))}: −{bnNum(hifz.fathCut)}
              </Muted>
            </Card>
          ) : null}
        </>
      ) : null}

      {!present ? (
        <>
          <Notice tone="warn" message={STR.qxAbsentNote} />
          <Body style={{ fontWeight: "700" }}>{STR.qxReason}</Body>
          <ChipRow>
            {REASONS.map((r) => (
              <Chip key={r} label={REASON_LABEL(r)} selected={reason === r} onPress={() => !ro && setReason(r)} />
            ))}
          </ChipRow>
        </>
      ) : null}

      <Field label={STR.qxComment} value={comment} onChangeText={(t) => !ro && setComment(t)} />

      {present ? (
        <Card>
          <Muted>{p.scheme === "HIFZ_DEDUCTION" ? STR.qxObtained : STR.qxTotal}</Muted>
          <H2>
            {bnNum(p.scheme === "HIFZ_DEDUCTION" ? hifz?.mark ?? 0 : total)} / {bnNum(p.fullMarks)}
          </H2>
        </Card>
      ) : null}
      {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
      {!ro ? <Button title={STR.qxSave} loading={saving} onPress={submit} /> : null}
    </View>
  );
}

export default function QuranExamSittingScreen({ route }: Props): React.ReactElement {
  const { id } = route.params;
  const [q, reexec] = useQuery({ query: QX_SITTING, variables: { id }, requestPolicy: "cache-and-network" });
  const refetch = React.useCallback(() => reexec({ requestPolicy: "network-only" }), [reexec]);
  const [detail, setDetail] = React.useState<QxDetailT | null>(null);
  const d = detail ?? q.data?.quranExamSitting ?? null;
  return (
    <Screen scroll>
      <QueryGate result={q} onRetry={refetch}>
        {d ? (
          <View style={{ gap: space(3) }}>
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: "700" }}>{d.sitting.studentName}</Body>
                  <Muted>
                    {d.sitting.classLabelBn ? `${d.sitting.classLabelBn} · ` : ""}
                    {qxLevelLabel(d.sitting.level)} · {d.sitting.portionLabel}
                  </Muted>
                  <Muted>
                    {fullDateLabel(d.sitting.dateKey)} · {qxRange(d.sitting.start, d.sitting.end)} · {STR.qxExaminer}: {d.sitting.examinerName}
                  </Muted>
                </View>
                <Badge text={STR.qxFullMarks.replace("{n}", bnNum(d.paper.fullMarks))} tone="brand" />
              </View>
            </Card>
            <Editor key={d.sitting.id} d={d} onSaved={setDetail} />
          </View>
        ) : null}
      </QueryGate>
    </Screen>
  );
}

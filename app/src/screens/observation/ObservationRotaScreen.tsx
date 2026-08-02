/**
 * ObservationRotaScreen (CO-14, D-#426, observation:manage) — write an instruction, get
 * a validated dated review rota.
 *
 * The screen mirrors the server's division of labour so the user can see it: they type
 * prose, and what comes back is (1) the model's RESTATEMENT of the constraints and only
 * then (2) the table. The echo is deliberately rendered first and given its own card —
 * "did it understand me?" is a question the user should answer from the screen rather
 * than by auditing 22 rows.
 *
 * On a rule breach the server refuses and returns the named violations; they surface in
 * the error notice unchanged. There is no fallback table by design, so this screen never
 * shows a rota that failed validation.
 *
 * Saving stores the rota + its instruction and assigns NOBODY (CO-6's guardrail) — the
 * screen says so next to the button rather than leaving it to be discovered.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  GENERATE_OBSERVATION_ROTA,
  SAVE_OBSERVATION_ROTA,
  OBSERVATION_ROTAS_QUERY,
  type RotaDraftT,
} from "../../graphql/observation";
import { Screen, Card, Body, Muted, Button, Field, Badge, Divider, Notice } from "../../components/ui";
import { STR, hwSubjectLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

/** YYYY-MM-DD for the first/last day of the month containing `d`. */
function monthBounds(d: Date): { from: string; to: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(y, m + 1, 0).getDate();
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` };
}

export default function ObservationRotaScreen(): React.ReactElement {
  const initial = monthBounds(new Date());
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<RotaDraftT | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [, generate] = useMutation(GENERATE_OBSERVATION_ROTA);
  const [, save] = useMutation(SAVE_OBSERVATION_ROTA);
  const [rotasQ, refetchRotas] = useQuery({ query: OBSERVATION_ROTAS_QUERY, variables: { limit: 5 } });
  const saved = rotasQ.data?.observationRotas ?? [];

  async function onGenerate(): Promise<void> {
    setError(null);
    setOk(null);
    if (instruction.trim().length < 3) {
      setError(STR.obsRotaInstruction);
      return;
    }
    setBusy(true);
    const res = await generate({ periodFrom: from, periodTo: to, instruction });
    setBusy(false);
    if (res.error) {
      // The server's violation list arrives here verbatim — it IS the useful message.
      setError(friendlyError(res.error));
      setDraft(null);
      return;
    }
    setDraft(res.data?.generateObservationRota ?? null);
  }

  async function onSave(): Promise<void> {
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await save({ periodFrom: from, periodTo: to, instruction });
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.obsRotaSaved);
    refetchRotas({ requestPolicy: "network-only" });
  }

  const echo = draft?.constraintEcho;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space(3), gap: space(3) }}>
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.obsRotaHeading}</Body>
          <Muted style={{ marginBottom: space(3) }}>{STR.obsRotaIntro}</Muted>

          <View style={{ flexDirection: "row", gap: space(2) }}>
            <View style={{ flex: 1 }}>
              <Field label={STR.obsRotaFrom} value={from} onChangeText={setFrom} placeholder="2026-08-01" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label={STR.obsRotaTo} value={to} onChangeText={setTo} placeholder="2026-08-31" />
            </View>
          </View>

          <Field
            label={STR.obsRotaInstruction}
            value={instruction}
            onChangeText={setInstruction}
            placeholder={STR.obsRotaInstructionPlaceholder}
            multiline
          />

          <Button
            title={busy ? STR.obsRotaGenerating : STR.obsRotaGenerate}
            onPress={() => void onGenerate()}
            disabled={busy || instruction.trim().length === 0}
          />
        </Card>

        {error ? <Notice tone="danger" message={error} /> : null}
        {ok ? <Notice tone="ok" message={ok} /> : null}

        {/* The echo comes BEFORE the table on purpose. */}
        {echo ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.obsRotaEcho}</Body>
            <Muted style={{ marginBottom: space(2) }}>{STR.obsRotaEchoHint}</Muted>
            {echo.intensive.map((i) => (
              <Body key={`i-${i.teacherName}`}>
                • {STR.obsRotaEchoIntensive}: {i.teacherName} —{" "}
                {STR.obsRotaEveryNDays.replace("{n}", bnNum(i.everyNDays))}
                {i.rotateClasses ? `, ${STR.obsRotaRotating}` : ""}
              </Body>
            ))}
            {echo.excluded.map((x) => (
              <Body key={`x-${x.teacherName}`}>
                • {STR.obsRotaEchoExcluded}: {x.teacherName}
                {x.reason ? ` (${x.reason})` : ""}
              </Body>
            ))}
            {echo.caps.map((c) => (
              <Body key={`c-${c.teacherName}`}>
                • {STR.obsRotaEchoCap}: {c.teacherName} — {bnNum(c.max)}
                {c.window ? ` (${c.window})` : ""}
              </Body>
            ))}
            <Body>
              • {STR.obsRotaEchoLevels}: {echo.classLevels.map((n) => bnNum(n)).join(", ")} ·{" "}
              {STR.obsRotaEchoPerDay}: {bnNum(echo.perDay)}
            </Body>
          </Card>
        ) : null}

        {draft ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsRotaTable}</Body>
            {draft.rows.map((r) => (
              <View key={r.candidateId} style={{ marginBottom: space(2) }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                  <Body style={{ fontWeight: "700" }}>{r.date}</Body>
                  <Muted>{r.dayOfWeek}</Muted>
                </View>
                <Body>{r.teacherName}</Body>
                <Muted>
                  {r.groupLabel} · {hwSubjectLabel(r.subject)} · P{bnNum(r.periodNumber)} ·{" "}
                  {r.startHHMM}–{r.endHHMM}
                </Muted>
                {r.reason ? <Muted>{r.reason}</Muted> : null}
              </View>
            ))}
            <Divider />
            <Muted style={{ marginBottom: space(2) }}>{STR.obsRotaNoAssign}</Muted>
            <Muted style={{ marginBottom: space(2) }}>
              {STR.obsRotaModel}: {draft.model}
            </Muted>
            <Button title={STR.obsRotaSave} onPress={() => void onSave()} disabled={busy} />
          </Card>
        ) : null}

        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsRotaSavedRotas}</Body>
          {saved.length === 0 ? (
            <Muted>{STR.obsRotaEmpty}</Muted>
          ) : (
            saved.map((s) => (
              <View key={s.id} style={{ marginBottom: space(3) }}>
                <Body style={{ fontWeight: "700" }}>
                  {s.periodFrom} → {s.periodTo}
                </Body>
                <Muted>{s.instruction}</Muted>
                {s.rows.some((r) => r.slotChanged) ? (
                  <View style={{ flexDirection: "row", marginTop: space(1) }}>
                    <Badge text={STR.obsRotaSlotChanged} tone="warn" />
                  </View>
                ) : null}
                {s.rows.map((r) => (
                  <Muted key={r.candidateId}>
                    {r.date} · {r.teacherName} · {r.groupLabel} · {hwSubjectLabel(r.subject)} ·{" "}
                    {r.startHHMM}–{r.endHHMM}
                    {r.slotChanged ? ` — ${STR.obsRotaSlotChangedHint}` : ""}
                  </Muted>
                ))}
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

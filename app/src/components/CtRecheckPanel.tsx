/**
 * CtRecheckPanel (CT-RC, docs/prd-ct-mark-recheck.md) — the unusual marks on one class
 * test, shown on the publish screen above Submit / Approve.
 *
 *   mode "teacher":  each flagged mark with its average, the "I checked the script a
 *                    second time" tick and an optional note; the whole-class tick (R4).
 *                    The server refuses Submit while any tick is missing.
 *   mode "approver": the same marks with the teacher's stamp + note, a per-row
 *                    "see the script · hold" (Option B), and the approver's own
 *                    "I have looked at the unusual marks" tick (state owned by the screen).
 *
 * The parent owns the query (it needs the counts to gate its buttons) and passes the
 * data + a refresh; this component only runs the tick / hold mutations.
 */
import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation } from "urql";
import {
  CONFIRM_CT_RECHECK,
  HOLD_CT_RESULT,
  type CtRecheckRowT,
  type CtRecheckT,
} from "../graphql/classTestRecheck";
import { Badge, Body, Button, Card, Field, Muted, Notice } from "./ui";
import { STR, bnNum, isoDateTimeLabel } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { radius, space, typeScale, useColors } from "../theme";

/** "{a}" placeholders in a label. */
export function ctrcFill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));
}

const pct = (n: number): string => bnNum(Math.round(n * 10) / 10);

export function avgLine(r: Pick<CtRecheckRowT, "basis" | "averagePct" | "percent">): string {
  if (r.basis === "NONE" || r.averagePct === null) return ctrcFill(STR.ctrcAvgNone, { p: pct(r.percent) });
  return ctrcFill(r.basis === "SUBJECT" ? STR.ctrcAvgSubject : STR.ctrcAvgAll, { a: pct(r.averagePct), p: pct(r.percent) });
}

export function kindLabel(k: string): string {
  return k === "HIGH" ? STR.ctrcKindHIGH : k === "LOW" ? STR.ctrcKindLOW : STR.ctrcKindFULL;
}

export function TickBox({
  checked,
  label,
  onPress,
  disabled,
}: {
  checked: boolean;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}): React.ReactElement {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space(3),
        minHeight: 48,
        paddingHorizontal: space(3),
        paddingVertical: space(2),
        borderRadius: radius.sm,
        backgroundColor: colors.surfaceAlt,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: radius.sm,
          borderWidth: 2,
          borderColor: checked ? colors.primary : colors.textSecondary,
          backgroundColor: checked ? colors.primary : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Text style={{ color: colors.onPrimary, fontWeight: "700" }}>✓</Text> : null}
      </View>
      <Text style={{ ...typeScale.chip, color: colors.textPrimary, flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

function TeacherRow({ testId, r, onDone }: { testId: string; r: CtRecheckRowT; onDone: () => void }): React.ReactElement {
  const colors = useColors();
  const [{ fetching }, confirm] = useMutation(CONFIRM_CT_RECHECK);
  const [note, setNote] = useState(r.note ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setNote(r.note ?? ""), [r.note]);
  const locked = r.submitted || r.published;

  async function run(confirmed: boolean, withNote?: string): Promise<void> {
    setError(null);
    const res = await confirm({ testId, studentId: r.studentId, confirmed, note: withNote ?? null });
    if (res.error) setError(friendlyError(res.error));
    else onDone();
  }

  return (
    <Card style={{ borderWidth: 2, borderColor: r.confirmed || r.classCovers ? colors.border : colors.warning }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2) }}>
        <Body style={{ fontWeight: "700", flexShrink: 1 }}>{r.studentName}</Body>
        <Body style={{ fontWeight: "700" }}>
          {bnNum(r.marks)}/{bnNum(r.totalMarks)}
        </Body>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1), alignItems: "center" }}>
        {r.kinds.map((k) => (
          <Badge key={k} text={kindLabel(k)} tone="warn" />
        ))}
        <Muted>{avgLine(r)}</Muted>
      </View>
      {r.classCovers ? (
        // R4: the one class tick above covers a high / full mark — no tick per child.
        <Muted style={{ marginTop: space(1), color: r.confirmed ? colors.primary : colors.textSecondary }}>
          {r.confirmed ? "✓ " : ""}
          {STR.ctrcCoveredByClass}
        </Muted>
      ) : (
        <>
          {!r.confirmed ? <Muted style={{ marginTop: space(1) }}>{STR.ctrcHint}</Muted> : null}
          <View style={{ marginTop: space(2) }}>
            <TickBox
              checked={r.confirmed}
              label={STR.ctrcTick}
              disabled={fetching || locked}
              onPress={() => void run(!r.confirmed, r.confirmed ? undefined : note)}
            />
          </View>
        </>
      )}
      {r.confirmed && !r.classCovers ? (
        <View style={{ marginTop: space(2) }}>
          <Field label={STR.ctrcNote} value={note} onChangeText={setNote} placeholder={STR.ctrcNotePh} editable={!locked} />
          {!locked && note.trim() !== (r.note ?? "").trim() ? (
            <Button title={STR.ctrcSaveNote} variant="secondary" onPress={() => void run(true, note)} loading={fetching} />
          ) : null}
          <Muted style={{ color: colors.primary }}>
            {ctrcFill(STR.ctrcConfirmedBy, { who: r.confirmedByName ?? "", when: isoDateTimeLabel(r.confirmedAt) })}
          </Muted>
        </View>
      ) : null}
      {error ? <Notice message={error} tone="danger" /> : null}
    </Card>
  );
}

function ApproverRow({
  testId,
  r,
  canHold,
  onDone,
}: {
  testId: string;
  r: CtRecheckRowT;
  canHold: boolean;
  onDone: () => void;
}): React.ReactElement {
  const colors = useColors();
  const [{ fetching }, hold] = useMutation(HOLD_CT_RESULT);
  const [error, setError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    setError(null);
    const res = await hold({ testId, studentId: r.studentId, hold: !r.held });
    if (res.error) setError(friendlyError(res.error));
    else onDone();
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2) }}>
        <Body style={{ fontWeight: "700", flexShrink: 1 }}>{r.studentName}</Body>
        <Body style={{ fontWeight: "700" }}>
          {bnNum(r.marks)}/{bnNum(r.totalMarks)}
        </Body>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1), alignItems: "center" }}>
        {r.kinds.map((k) => (
          <Badge key={k} text={kindLabel(k)} tone="warn" />
        ))}
        {r.held ? <Badge text={STR.ctrcHeldBadge} tone="info" /> : null}
        <Muted>{avgLine(r)}</Muted>
      </View>
      <View style={{ marginTop: space(2), padding: space(2), borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }}>
        {r.confirmed ? (
          <>
            <Text style={{ ...typeScale.secondary, color: colors.primary }}>
              ✓ {ctrcFill(STR.ctrcConfirmedBy, { who: r.confirmedByName ?? "", when: isoDateTimeLabel(r.confirmedAt) })}
            </Text>
            {r.note ? <Muted>{ctrcFill(STR.ctrcTeacherNote, { n: `“${r.note}”` })}</Muted> : null}
          </>
        ) : (
          <Text style={{ ...typeScale.secondary, color: colors.warning }}>{STR.ctrcNotConfirmed}</Text>
        )}
      </View>
      {r.held ? <Notice message={STR.ctrcHeldNote} tone="info" /> : null}
      {canHold && r.submitted && !r.published ? (
        <View style={{ marginTop: space(2), alignItems: "flex-start" }}>
          <Button title={r.held ? STR.ctrcUnhold : STR.ctrcHold} variant={r.held ? "ghost" : "secondary"} onPress={() => void toggle()} loading={fetching} />
        </View>
      ) : null}
      {error ? <Notice message={error} tone="danger" /> : null}
    </Card>
  );
}

export function CtRecheckPanel({
  testId,
  data,
  mode,
  onChanged,
  reviewed,
  onReviewedChange,
}: {
  testId: string;
  data: CtRecheckT | null | undefined;
  mode: "teacher" | "approver";
  onChanged: () => void;
  reviewed?: boolean;
  onReviewedChange?: (v: boolean) => void;
}): React.ReactElement | null {
  const colors = useColors();
  const [{ fetching: classBusy }, confirm] = useMutation(CONFIRM_CT_RECHECK);
  const [classNote, setClassNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!data || !data.rules.enabled) return null;
  const rows = data.rows.filter((r) => !r.published);
  const cf = data.classFlag;
  if (rows.length === 0 && !cf) return null;

  async function tickClass(confirmed: boolean): Promise<void> {
    setError(null);
    const res = await confirm({ testId, studentId: null, confirmed, note: confirmed ? classNote || null : null });
    if (res.error) setError(friendlyError(res.error));
    else onChanged();
  }

  const teacherLocked = rows.length > 0 && rows.every((r) => r.submitted);

  return (
    <View style={{ marginTop: space(2) }}>
      <Text style={{ ...typeScale.sectionTitle, color: colors.textPrimary, marginBottom: space(1) }}>
        {STR.ctrcTitle} · {bnNum(rows.length)}
      </Text>
      {mode === "teacher" ? (
        data.unconfirmedCount > 0 ? (
          <Notice message={ctrcFill(STR.ctrcBannerTeacher, { n: bnNum(data.unconfirmedCount) })} tone="warn" />
        ) : (
          <Notice message={STR.ctrcAllConfirmed} tone="ok" />
        )
      ) : (
        <Muted>{STR.ctrcApproverIntro}</Muted>
      )}

      {cf ? (
        <Card style={{ borderWidth: 2, borderColor: cf.confirmed ? colors.border : colors.warning }}>
          <Body style={{ fontWeight: "700", color: colors.warning }}>{STR.ctrcClassTitle}</Body>
          <Muted>{ctrcFill(STR.ctrcClassLine, { c: pct(cf.classPct), u: pct(cf.usualPct) })}</Muted>
          {mode === "teacher" ? (
            <>
              {!cf.confirmed ? <Muted>{STR.ctrcClassHint}</Muted> : null}
              {!cf.confirmed ? (
                <Field label={STR.ctrcNote} value={classNote} onChangeText={setClassNote} placeholder={STR.ctrcNotePh} />
              ) : cf.note ? (
                <Muted>{ctrcFill(STR.ctrcTeacherNote, { n: `“${cf.note}”` })}</Muted>
              ) : null}
              <TickBox
                checked={cf.confirmed}
                label={STR.ctrcClassTick}
                disabled={classBusy || teacherLocked}
                onPress={() => void tickClass(!cf.confirmed)}
              />
            </>
          ) : cf.confirmed ? (
            <>
              <Text style={{ ...typeScale.secondary, color: colors.primary }}>
                ✓ {ctrcFill(STR.ctrcConfirmedBy, { who: cf.confirmedByName ?? "", when: isoDateTimeLabel(cf.confirmedAt) })}
              </Text>
              {cf.note ? <Muted>{ctrcFill(STR.ctrcTeacherNote, { n: `“${cf.note}”` })}</Muted> : null}
            </>
          ) : (
            <Text style={{ ...typeScale.secondary, color: colors.warning }}>{STR.ctrcNotConfirmed}</Text>
          )}
        </Card>
      ) : null}

      {rows.map((r) =>
        mode === "teacher" ? (
          <TeacherRow key={r.studentId} testId={testId} r={r} onDone={onChanged} />
        ) : (
          <ApproverRow key={r.studentId} testId={testId} r={r} canHold onDone={onChanged} />
        ),
      )}

      {mode === "approver" && data.awaitingApprovalCount > 0 && onReviewedChange ? (
        <View style={{ marginTop: space(2) }}>
          <TickBox checked={!!reviewed} label={STR.ctrcReviewedTick} onPress={() => onReviewedChange(!reviewed)} />
        </View>
      ) : null}
      {error ? <Notice message={error} tone="danger" /> : null}
    </View>
  );
}

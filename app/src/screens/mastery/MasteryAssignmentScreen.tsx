/**
 * MasteryAssignmentScreen (M-4, mock T6) — one শাখা × subject's weekly tailored assignment:
 * the teacher's layout (total, minutes, Part A on/off + marks, Part B marks + mix, allowed
 * types, remember), the app's pick per student (counts by state, each student's outcomes),
 * approve the clean ones, open a sheet to change it, PDF, send. After sending, marks are
 * entered on the AS work sheet like any other (each student on their own questions).
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  APPROVE_MASTERY_ASSIGNMENT_SHEETS,
  BUILD_MASTERY_ASSIGNMENT,
  MASTERY_ASSIGNMENT_QUERY,
  MASTERY_ASSIGNMENT_TRACKER_ITEMS_QUERY,
  MASTERY_CATALOGUE_QUERY,
  SEND_MASTERY_ASSIGNMENT,
  type MasteryAssignmentData,
  type MasteryAssignmentLayout,
} from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Field, Loader, Notice, Select, H2 } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, masteryBandLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openPdf } from "../../lib/pdf";
import { useAuth } from "../../auth/AuthContext";
import { space, useColors } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";
import { fill } from "./masteryStateUi";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryAssignment">;

/** The coming Thursday (the tracker's usual due day) as YYYY-MM-DD, local date. */
function comingThursday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const ascii = (s: string) => s.replace(/[০-৯]/g, (c) => String("০১২৩৪৫৬৭৮৯".indexOf(c)));
const num = (s: string) => Number(ascii(s).trim());

type LayoutText = Record<"totalMarks" | "minutes" | "partAMarks" | "partBMarks" | "mixWeak" | "mixImproving" | "mixRevision", string>;
const toText = (l: MasteryAssignmentLayout): LayoutText => ({
  totalMarks: String(l.totalMarks), minutes: String(l.minutes), partAMarks: String(l.partAMarks), partBMarks: String(l.partBMarks),
  mixWeak: String(l.mixWeak), mixImproving: String(l.mixImproving), mixRevision: String(l.mixRevision),
});
const bandTone = (b: string) => (b === "WEAK" ? "danger" : b === "IMPROVING" ? "warn" : b === "REVISION" ? "info" : "muted");

export default function MasteryAssignmentScreen({ navigation, route }: Props): React.ReactElement {
  const { sectionId, subject } = route.params;
  const colors = useColors();
  const { can } = useAuth();
  const canCreate = can("mastery:create");
  const [dueDate, setDueDate] = useState(comingThursday());
  const [{ data, fetching, error }, refetch] = useQuery({
    query: MASTERY_ASSIGNMENT_QUERY,
    variables: { sectionId, subject, dueDate },
    pause: !/^\d{4}-\d{2}-\d{2}$/.test(dueDate),
    requestPolicy: "cache-and-network",
  });
  const week = data?.masteryAssignment as { week: string; startingLayout: MasteryAssignmentLayout; assignment: MasteryAssignmentData | null } | undefined;
  const a = week?.assignment ?? null;
  // Back from a child screen (entry, sheet, action) must show what changed there.
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => refetch({ requestPolicy: "network-only" }));
    return unsub;
  }, [navigation, refetch]);

  const [{ data: trackerData }] = useQuery({ query: MASTERY_ASSIGNMENT_TRACKER_ITEMS_QUERY, variables: { sectionId, subject }, pause: !canCreate });
  const trackerItems = (trackerData?.masteryAssignmentTrackerItems ?? []) as { asItemId: string; asId: string; dueDate: string }[];
  const [{ data: catData }] = useQuery({
    query: MASTERY_CATALOGUE_QUERY,
    variables: { classToken: a?.classToken ?? "", subject },
    pause: !a?.classToken,
  });
  const types = ((catData?.masteryCatalogue?.questionTypes ?? []) as { code: string; labelBn: string; marks: number | null; active: boolean }[]).filter(
    (t) => t.active && (t.marks ?? 0) > 0,
  );

  const [text, setText] = useState<LayoutText | null>(null);
  const [partAOn, setPartAOn] = useState(true);
  const [qtypes, setQtypes] = useState<string[]>([]);
  const [remember, setRemember] = useState(true);
  const [asItemId, setAsItemId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const layoutSrc = a?.layout ?? week?.startingLayout ?? null;
  useEffect(() => {
    if (!layoutSrc) return;
    setText(toText(layoutSrc));
    setPartAOn(layoutSrc.partAOn);
    setQtypes(layoutSrc.questionTypeCodes);
    setRemember(a?.rememberLayout ?? true);
    setAsItemId(a?.asItemId ?? null);
  }, [a?.id, a?.layout, week?.week]); // eslint-disable-line react-hooks/exhaustive-deps

  const [buildState, build] = useMutation(BUILD_MASTERY_ASSIGNMENT);
  const [approveState, approveAll] = useMutation(APPROVE_MASTERY_ASSIGNMENT_SHEETS);
  const [sendState, send] = useMutation(SEND_MASTERY_ASSIGNMENT);
  const busy = buildState.fetching || approveState.fetching || sendState.fetching;

  const counts = useMemo(() => {
    const c = { DRAFT: 0, NEEDS_REVIEW: 0, APPROVED: 0 } as Record<string, number>;
    for (const s of a?.sheets ?? []) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [a?.sheets]);

  const onBuild = async () => {
    if (!text) return;
    setMsg(null);
    const layout = {
      totalMarks: num(text.totalMarks), minutes: num(text.minutes), partAOn,
      partAMarks: partAOn ? num(text.partAMarks) : 0, partALoCodes: layoutSrc?.partALoCodes ?? [],
      partBMarks: num(text.partBMarks), mixWeak: num(text.mixWeak), mixImproving: num(text.mixImproving), mixRevision: num(text.mixRevision),
      questionTypeCodes: qtypes,
    };
    const res = await build({ sectionId, subject, dueDate, layout, rememberLayout: remember, asItemId });
    if (res.error) setMsg(friendlyError(res.error));
    else refetch({ requestPolicy: "network-only" });
  };
  const onApproveAll = async () => {
    if (!a) return;
    setMsg(null);
    const res = await approveAll({ assignmentId: a.id });
    if (res.error) setMsg(friendlyError(res.error));
    else refetch({ requestPolicy: "network-only" });
  };
  const onSend = async () => {
    if (!a) return;
    setMsg(null);
    const res = await send({ assignmentId: a.id });
    if (res.error) setMsg(friendlyError(res.error));
    else refetch({ requestPolicy: "network-only" });
  };
  const onPdf = async () => {
    if (!a) return;
    try {
      await openPdf(`/pdf/mastery-assignment/${a.id}`);
    } catch {
      setMsg(STR.errGeneric);
    }
  };

  const draft = a?.status !== "SENT";
  const setT = (k: keyof LayoutText) => (v: string) => setText((t) => (t ? { ...t, [k]: v } : t));

  return (
    <Screen scroll>
      <H2>
        {STR.msAssignment} · {hwSubjectLabel(subject)}
      </H2>
      <Field label={STR.msAsDueDate} value={dueDate} onChangeText={setDueDate} />
      {week ? <Muted>{bnNum(week.week)}</Muted> : null}
      {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
      {msg ? <Notice message={msg} tone="danger" /> : null}
      {fetching && !week ? <Loader /> : null}

      {a && !draft ? (
        <Card>
          <Badge text={fill(STR.msAsSent, { paper: a.paperId ?? "" })} tone="ok" />
          <Muted>{STR.msAsSentNote}</Muted>
          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            {a.paperId ? <Button title={STR.msAsEnterMarks} onPress={() => navigation.navigate("MasteryEntry", { paperId: a.paperId! })} /> : null}
            <Button title={STR.msAsAllPdf} variant="secondary" onPress={onPdf} />
          </View>
        </Card>
      ) : null}

      {text && draft && canCreate ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.msAsLayout}</Body>
          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            <View style={{ flexBasis: 140, flexGrow: 1 }}>
              <Field label={STR.msAsTotal} value={text.totalMarks} onChangeText={setT("totalMarks")} keyboardType="numeric" />
            </View>
            <View style={{ flexBasis: 140, flexGrow: 1 }}>
              <Field label={STR.msAsMinutes} value={text.minutes} onChangeText={setT("minutes")} keyboardType="numeric" />
            </View>
          </View>
          <ChipRow>
            <Chip label={STR.msAsPartA} selected={partAOn} onPress={() => setPartAOn((v) => !v)} />
          </ChipRow>
          {partAOn ? <Field label={STR.msAsPartAMarks} value={text.partAMarks} onChangeText={setT("partAMarks")} keyboardType="numeric" /> : null}
          <Body style={{ fontWeight: "600" }}>{STR.msAsPartB}</Body>
          <Field label={STR.msAsPartBMarks} value={text.partBMarks} onChangeText={setT("partBMarks")} keyboardType="numeric" />
          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            {(["mixWeak", "mixImproving", "mixRevision"] as const).map((k) => (
              <View key={k} style={{ flexBasis: 100, flexGrow: 1 }}>
                <Field
                  label={k === "mixWeak" ? STR.msAsMixWeak : k === "mixImproving" ? STR.msAsMixImproving : STR.msAsMixRevision}
                  value={text[k]}
                  onChangeText={setT(k)}
                  keyboardType="numeric"
                />
              </View>
            ))}
          </View>
          <ChipRow>
            <Chip label={STR.msAsAllTypes} selected={qtypes.length === 0} onPress={() => setQtypes([])} />
            {types.map((t) => (
              <Chip
                key={t.code}
                label={`${t.labelBn} · ${bnNum(t.marks ?? 0)}`}
                selected={qtypes.includes(t.code)}
                onPress={() => setQtypes((q) => (q.includes(t.code) ? q.filter((x) => x !== t.code) : [...q, t.code]))}
              />
            ))}
          </ChipRow>
          {trackerItems.length > 0 ? (
            <Select
              label={STR.msAsTrackerLink}
              value={asItemId ?? "NONE"}
              options={[{ label: STR.msAsNoLink, value: "NONE" }, ...trackerItems.map((t) => ({ label: `${t.asId} · ${bnNum(t.dueDate)}`, value: t.asItemId }))]}
              onChange={(v) => setAsItemId(v === "NONE" ? null : v)}
            />
          ) : null}
          <ChipRow>
            <Chip label={STR.msAsRemember} selected={remember} onPress={() => setRemember((v) => !v)} />
          </ChipRow>
          <Button title={a ? STR.msAsRebuild : STR.msAsBuild} onPress={onBuild} disabled={busy} />
        </Card>
      ) : null}

      {a ? (
        <>
          {a.partA.length > 0 ? (
            <Card>
              <Body style={{ fontWeight: "700" }}>
                {STR.msAsPartA} · {bnNum(a.partA.reduce((s, q) => s + q.marks, 0))}
              </Body>
              {a.partA.map((q, i) => (
                <Body key={`${q.qid}-${i}`}>
                  {bnNum(i + 1)}. {q.textBn ?? q.qid} <Muted>({q.labelBn})</Muted>
                </Body>
              ))}
            </Card>
          ) : null}

          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            <Badge text={fill(STR.msAsReady, { n: bnNum(counts.DRAFT ?? 0) })} tone="muted" />
            <Badge text={fill(STR.msAsNeedsReview, { n: bnNum(counts.NEEDS_REVIEW ?? 0) })} tone="gold" />
            <Badge text={fill(STR.msAsApproved, { n: bnNum(counts.APPROVED ?? 0) })} tone="ok" />
          </View>

          {a.sheets.map((s) => (
            <Pressable
              key={s.studentId}
              accessibilityRole="link"
              onPress={() => navigation.navigate("MasteryAssignmentSheet", { assignmentId: a.id, studentId: s.studentId, subject })}
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: space(3), gap: space(1) }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
                <Body style={{ fontWeight: "700", flexShrink: 1 }}>
                  {s.rollNumber ? `${bnNum(s.rollNumber)}. ` : ""}
                  {s.name}
                </Body>
                <View style={{ flexDirection: "row", gap: space(1) }}>
                  <Badge text={`${bnNum(s.marks)}/${bnNum(a.layout.partBMarks)}`} tone="muted" />
                  <Badge
                    text={s.status === "APPROVED" ? STR.msAsApprove : s.status === "NEEDS_REVIEW" ? fill(STR.msAsNeedsReview, { n: "" }).trim() : STR.msAsDraft}
                    tone={s.status === "APPROVED" ? "ok" : s.status === "NEEDS_REVIEW" ? "gold" : "muted"}
                  />
                </View>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
                {s.items.map((it, i) => (
                  <Badge key={`${it.loCode}-${i}`} text={`${it.labelBn} · ${masteryBandLabel(it.band)}`} tone={bandTone(it.band)} />
                ))}
                {s.items.length === 0 && s.warnings.some((w) => w.code === "NOTHING_TO_PRACTISE") ? <Muted>{STR.msAsNothing}</Muted> : null}
              </View>
            </Pressable>
          ))}

          {draft && canCreate ? (
            <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
              <Button title={STR.msAsAllPdf} variant="secondary" onPress={onPdf} />
              <Button title={STR.msAsApproveAll} variant="secondary" onPress={onApproveAll} disabled={busy || (counts.DRAFT ?? 0) === 0} />
              <Button
                title={STR.msAsSend}
                onPress={onSend}
                disabled={busy || a.sheets.length === 0 || a.sheets.some((s) => s.status !== "APPROVED")}
              />
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

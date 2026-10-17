/**
 * Shared pieces of the parents'-meeting comment chain screens (MC-3/MC-4,
 * docs/prd-meeting-comments.md): the two-box display every layer uses, a collapsible
 * block, the "since the last meeting" number tiles that open to their detail rows, and
 * the label helpers. Presentational only — no queries here.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { Body, Muted } from "./ui";
import { STR, bnNum, classSectionLabel, fullDateLabel, routineSubjectLabel } from "../lib/labels";
import { isWholeClassSectionName } from "../lib/sectionPicks";
import { useColors } from "../theme";
import { space } from "../theme/tokens";
import type { BriefNumbersT } from "../graphql/meetingChain";

/** "শ্রেণি ৪ বালক" — the class, plus the section when it tells halves apart. */
export const placeLabel = (p: { classLevel: number | null; classNameBn: string; sectionNameBn: string }): string =>
  p.classLevel != null ? classSectionLabel(p.classLevel, isWholeClassSectionName(p.sectionNameBn) ? null : p.sectionNameBn) : p.classNameBn;

export const dayLabel = (key: string): string => fullDateLabel(key);

export const pctLabel = (n: number | null | undefined): string => (n == null ? "—" : `${bnNum(Math.round(n))}%`);

export const finalSourceLabel = (s: "AS_IS" | "EDITED" | "OWN" | null | undefined): string =>
  s === "AS_IS" ? STR.mcSourceAsIs : s === "EDITED" ? STR.mcSourceEdited : s === "OWN" ? STR.mcSourceOwn : "";

/** Strengths + Concerns, the two boxes of every layer. */
export function TwoBoxes({ strengths, concerns, big = false }: { strengths: string; concerns: string; big?: boolean }): React.ReactElement {
  const c = useColors();
  const size = big ? 17 : 15;
  return (
    <View style={{ gap: space(2) }}>
      <Text style={{ color: c.textPrimary, fontSize: size, lineHeight: size * 1.55 }}>
        <Text style={{ color: c.primary, fontWeight: "700" }}>{STR.mcStrengths} · </Text>
        {strengths || "—"}
      </Text>
      <Text style={{ color: c.textPrimary, fontSize: size, lineHeight: size * 1.55 }}>
        <Text style={{ color: c.warning, fontWeight: "700" }}>{STR.mcConcerns} · </Text>
        {concerns || "—"}
      </Text>
    </View>
  );
}

/** A header row that opens/closes its children. */
export function Expander({
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string | null;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const c = useColors();
  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: space(2), opacity: pressed ? 0.7 : 1 })}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Body style={{ fontWeight: "700" }}>{title}</Body>
          {subtitle ? <Muted>{subtitle}</Muted> : null}
        </View>
        <Text style={{ color: c.info, fontWeight: "600" }}>{open ? STR.mcHide : STR.mcShow}</Text>
      </Pressable>
      {open ? <View style={{ paddingBottom: space(2) }}>{children}</View> : null}
    </View>
  );
}

type TileKey = "att" | "ct" | "hw" | "as" | "notes";

function Row({ a, b, tone }: { a: string; b: string; tone?: "bad" | "good" | "muted" }): React.ReactElement {
  const c = useColors();
  const color = tone === "bad" ? c.error : tone === "good" ? c.primary : c.textSecondary;
  return (
    <View style={{ minHeight: 34, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(3), borderBottomWidth: 1, borderBottomColor: c.surfaceAlt }}>
      <Text style={{ color: c.textPrimary, flex: 1, minWidth: 0 }}>{a}</Text>
      <Text style={{ color, fontWeight: "600", textAlign: "right" }}>{b}</Text>
    </View>
  );
}

/**
 * The five number tiles since the last meeting. Each opens to the rows behind it
 * (absent days, tests per subject, missed homework…). `only` limits the tiles shown —
 * the subject teacher's write screen shows just the subject's three.
 */
export function NumbersTiles({ numbers, only, initiallyOpen = null }: { numbers: BriefNumbersT; only?: TileKey[]; initiallyOpen?: TileKey | null }): React.ReactElement {
  const c = useColors();
  const [open, setOpen] = React.useState<TileKey | null>(initiallyOpen);
  const n = numbers;
  const tiles: Array<{ key: TileKey; label: string; main: string; sub: string; bad: boolean; rows: React.ReactNode }> = [
    {
      key: "att",
      label: STR.mcAttendance,
      main: `${bnNum(n.attendance.presentDays)}/${bnNum(n.attendance.markedDays)} ${STR.mcDaysPresent}`,
      sub: `${STR.mcLeaveN} ${bnNum(n.attendance.leaveDays)} · ${STR.mcAbsentN} ${bnNum(n.attendance.absentDays)}`,
      bad: n.attendance.absentDays > 0,
      rows: n.attendance.days.length ? (
        n.attendance.days.map((d) => <Row key={d.dateKey} a={dayLabel(d.dateKey)} b={d.kind === "LEAVE" ? `${STR.mcLeaveN}${d.reason ? ` · ${d.reason}` : ""}` : STR.mcAbsentN} tone={d.kind === "LEAVE" ? "muted" : "bad"} />)
      ) : (
        <Muted>{STR.mcNoneInWindow}</Muted>
      ),
    },
    {
      key: "ct",
      label: STR.mcClassTests,
      main: `${bnNum(n.classTests.sat)}/${bnNum(n.classTests.held)} ${STR.mcSat} · ${STR.mcAvg} ${pctLabel(n.classTests.avgPercent)}`,
      sub: `${bnNum(n.classTests.missed)} ${STR.mcMissed}`,
      bad: n.classTests.missed > 0,
      rows: n.classTests.bySubject.length ? (
        n.classTests.bySubject.map((s) => (
          <Row key={s.subject} a={`${routineSubjectLabel(s.subject)} · ${bnNum(s.held)}`} b={`${STR.mcAvg} ${pctLabel(s.avgPercent)}${s.missed ? ` · ${bnNum(s.missed)} ${STR.mcMissed}` : ""}`} tone={s.missed ? "bad" : "good"} />
        ))
      ) : (
        <Muted>{STR.mcNoneInWindow}</Muted>
      ),
    },
    ...(["hw", "as"] as const).map((k) => {
      const t = k === "hw" ? n.homework : n.assignment;
      return {
        key: k as TileKey,
        label: k === "hw" ? STR.mcHomework : STR.mcAssignments,
        main: `${bnNum(t.submitted)}/${bnNum(t.received)} ${STR.mcSubmitted}`,
        sub: `${bnNum(t.notSubmitted)} ${STR.mcNotSubmitted}`,
        bad: t.notSubmitted > 0,
        rows: (
          <View>
            {t.bySubject.map((s) => (
              <Row key={s.subject} a={routineSubjectLabel(s.subject)} b={`${bnNum(s.submitted)}/${bnNum(s.received)}${s.notSubmitted ? ` · ${bnNum(s.notSubmitted)} ${STR.mcNotSubmitted}` : ""}`} tone={s.notSubmitted ? "bad" : "good"} />
            ))}
            {t.missed.length ? (
              t.missed.map((m, i) => <Row key={`${m.dateKey}-${i}`} a={`${dayLabel(m.dateKey)} · ${routineSubjectLabel(m.subject)}`} b={m.description ?? STR.mcNotSubmitted} tone="bad" />)
            ) : (
              <Muted>{STR.mcAllSubmitted}</Muted>
            )}
          </View>
        ),
      };
    }),
    {
      key: "notes",
      label: STR.mcTeacherNotes,
      main: `${bnNum(n.notes.concern)} ${STR.mcConcernN} · ${bnNum(n.notes.positive)} ${STR.mcGoodN}`,
      sub: "",
      bad: n.notes.concern > 0,
      rows: n.notes.items.length ? (
        n.notes.items.map((x, i) => (
          <View key={i} style={{ paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: c.surfaceAlt, gap: 2 }}>
            <Text style={{ color: x.sentiment === "CONCERN" ? c.error : c.primary, fontWeight: "600" }}>
              {x.sentiment === "CONCERN" ? STR.mcConcernN : STR.mcGoodN} · {dayLabel(x.dateKey)}
              {x.authorName ? ` · ${x.authorName}` : ""}
            </Text>
            <Text style={{ color: c.textPrimary }}>{x.text}</Text>
          </View>
        ))
      ) : (
        <Muted>{STR.mcNoneInWindow}</Muted>
      ),
    },
  ];
  return (
    <View style={{ gap: space(2) }}>
      {tiles
        .filter((t) => !only || only.includes(t.key))
        .map((t) => {
          const isOpen = open === t.key;
          return (
            <View key={t.key} style={{ borderWidth: 1, borderColor: isOpen ? c.info : c.border, borderRadius: 12, backgroundColor: c.surface, overflow: "hidden" }}>
              <Pressable
                onPress={() => setOpen(isOpen ? null : t.key)}
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                style={({ pressed }) => ({ minHeight: 60, flexDirection: "row", alignItems: "center", gap: space(3), paddingHorizontal: space(4), paddingVertical: space(2), opacity: pressed ? 0.7 : 1 })}
              >
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Muted>{t.label}</Muted>
                  <Text style={{ color: c.textPrimary, fontWeight: "700", fontSize: 16 }}>{t.main}</Text>
                  {t.sub ? <Text style={{ color: t.bad ? c.warning : c.textSecondary }}>{t.sub}</Text> : null}
                </View>
                <Text style={{ color: c.info, fontWeight: "600" }}>{isOpen ? STR.mcHide : STR.mcDetails}</Text>
              </Pressable>
              {isOpen ? <View style={{ paddingHorizontal: space(4), paddingBottom: space(3) }}>{t.rows}</View> : null}
            </View>
          );
        })}
    </View>
  );
}

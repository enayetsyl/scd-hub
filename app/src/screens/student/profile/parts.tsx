/**
 * Shared building blocks for the tabbed Student Profile: headline tiles, a tappable
 * report-style table, and small formatting helpers. Every tab reads the same way —
 * a few headline numbers, one row per subject, then a tap to deep-dive — so the
 * pieces live here once.
 */
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Body, Muted } from "../../../components/ui";
import { bnNum } from "../../../lib/labels";
import { radius, space, useColors } from "../../../theme";
import { REPORT_PAPER as REPORT } from "../../../theme/reportPaper";

export type Tone = "ok" | "warn" | "danger" | "muted";

/** Green at ≥ `good`, amber at ≥ `fair`, red below; muted when there is no number. */
export function toneForPct(pct: number | null | undefined, good = 75, fair = 50): Tone {
  if (pct == null) return "muted";
  return pct >= good ? "ok" : pct >= fair ? "warn" : "danger";
}

/** Zero is good news for a count of outstanding work; anything else wants a look. */
export function toneForCount(n: number, dangerAt = 3): Tone {
  return n === 0 ? "ok" : n >= dangerAt ? "danger" : "warn";
}

export const pctText = (pct: number | null | undefined): string => (pct == null ? "—" : `${bnNum(Math.round(pct))}%`);

/** `{n}` substitution for the count-bearing labels. */
export const withN = (label: string, n: number): string => label.replace("{n}", bnNum(n));

function useToneColors(): (tone: Tone) => { bg: string; fg: string } {
  const c = useColors();
  return (tone) =>
    tone === "ok"
      ? { bg: c.primaryContainer, fg: c.onPrimaryContainer }
      : tone === "warn"
        ? { bg: c.warningContainer, fg: c.warning }
        : tone === "danger"
          ? { bg: c.errorContainer, fg: c.onErrorContainer }
          : { bg: c.surfaceAlt, fg: c.textSecondary };
}

/** One headline number. Pressable when it leads somewhere (the dashboard's tiles open their tab). */
export function StatTile({
  label,
  value,
  sub,
  tone = "muted",
  onPress,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  onPress?: () => void;
}): React.ReactElement {
  const toneColors = useToneColors();
  const { bg, fg } = toneColors(tone);
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: 150,
        backgroundColor: bg,
        borderRadius: radius.md,
        padding: space(3),
        opacity: pressed ? 0.8 : 1,
        gap: 2,
      })}
    >
      <Text style={{ color: fg, fontSize: 13, fontWeight: "600" }}>{label}</Text>
      <Text style={{ color: fg, fontSize: 24, fontWeight: "800" }}>{value}</Text>
      {sub ? <Text style={{ color: fg, fontSize: 12 }}>{sub}</Text> : null}
    </Pressable>
  );
}

export function TileRow({ children }: { children: React.ReactNode }): React.ReactElement {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3) }}>{children}</View>;
}

export function SectionTitle({ title, hint }: { title: string; hint?: string }): React.ReactElement {
  return (
    <View style={{ marginTop: space(2) }}>
      <Body style={{ fontWeight: "700" }}>{title}</Body>
      {hint ? <Muted style={{ fontSize: 12 }}>{hint}</Muted> : null}
    </View>
  );
}

export interface TableColumn {
  label: string;
  /** Minimum width, and the column's share of any spare width. */
  width: number;
  align?: "left" | "right" | "center";
}

export interface TableRow {
  key: string;
  cells: React.ReactNode[];
  onPress?: () => void;
  selected?: boolean;
}

/** A report-paper table (blue header, zebra rows) that fills its card on a wide
 *  screen and scrolls sideways on a phone. A string cell renders as body text. */
export function DataTable({ columns, rows }: { columns: TableColumn[]; rows: TableRow[] }): React.ReactElement {
  const minWidth = columns.reduce((s, c) => s + c.width, 0);
  const cellStyle = (c: TableColumn) => ({
    flexGrow: c.width,
    flexBasis: c.width,
    paddingVertical: space(2),
    paddingHorizontal: space(2),
    justifyContent: "center" as const,
    alignItems: (c.align === "right" ? "flex-end" : c.align === "center" ? "center" : "flex-start") as
      | "flex-end"
      | "center"
      | "flex-start",
  });
  return (
    <View style={{ borderRadius: radius.sm, overflow: "hidden", borderWidth: 1, borderColor: REPORT.rowBorder }}>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ minWidth, flexGrow: 1 }}>
          <View style={{ flexDirection: "row", backgroundColor: REPORT.headerBg }}>
            {columns.map((c) => (
              <View key={c.label} style={cellStyle(c)}>
                <Text style={{ color: REPORT.headerText, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>
                  {c.label}
                </Text>
              </View>
            ))}
          </View>
          {rows.map((r, i) => (
            <Pressable
              key={r.key}
              disabled={!r.onPress}
              onPress={r.onPress}
              accessibilityRole={r.onPress ? "button" : undefined}
              style={({ pressed }) => ({
                flexDirection: "row",
                backgroundColor:
                  r.selected || pressed ? REPORT.rowPressed : i % 2 === 0 ? REPORT.rowEven : REPORT.rowOdd,
                borderBottomWidth: 1,
                borderBottomColor: REPORT.rowBorder,
              })}
            >
              {r.cells.map((cell, ci) => (
                <View key={ci} style={cellStyle(columns[ci])}>
                  {typeof cell === "string" || typeof cell === "number" ? (
                    <Text style={{ color: ci === 0 && r.onPress ? REPORT.link : REPORT.text, fontSize: 14, fontWeight: ci === 0 ? "600" : "400" }}>
                      {cell}
                    </Text>
                  ) : (
                    cell
                  )}
                </View>
              ))}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** A coloured value inside a table cell (a % on paper, toned like its tile). */
export function ToneText({ tone, children }: { tone: Tone; children: React.ReactNode }): React.ReactElement {
  const color =
    tone === "ok" ? REPORT.toneOk : tone === "warn" ? REPORT.toneWarn : tone === "danger" ? REPORT.toneDanger : REPORT.textMuted;
  return <Text style={{ color, fontSize: 14, fontWeight: "700" }}>{children}</Text>;
}

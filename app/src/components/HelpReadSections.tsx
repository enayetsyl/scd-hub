/**
 * A reading guide's text (prd-help-centre §2.6, D-#1280): one card per section with its
 * heading, then paragraphs, bullet lists, a table and a checklist. `<b>…</b>` is bold,
 * the same markup as step text. Static: the checklist boxes are reminders, not inputs.
 *
 * The table must read on a phone: on a narrow screen every row becomes a small card of
 * "column name → value" lines; from tablet width it is a plain grid.
 */
import React from "react";
import { Text, View, useWindowDimensions } from "react-native";
import type { HelpBlockT, HelpSectionT } from "../graphql/help";
import { boldSegments } from "../lib/helpGuides";
import { Card, H2 } from "./ui";
import { fonts, radius, space, useColors } from "../theme";

/** Below this window width a table stacks its rows as cards. */
const TABLE_GRID_MIN_WIDTH = 600;

function Rich({ text, muted, size = 16 }: { text: string; muted?: boolean; size?: number }): React.ReactElement {
  const colors = useColors();
  return (
    <Text
      style={{
        flex: 1,
        minWidth: 0,
        color: muted ? colors.textSecondary : colors.textPrimary,
        fontFamily: fonts.regular,
        fontSize: size,
        lineHeight: Math.round(size * 1.55),
      }}
    >
      {boldSegments(text).map((seg, k) => (
        <Text key={k} style={seg.bold ? { fontFamily: fonts.bold } : undefined}>
          {seg.text}
        </Text>
      ))}
    </Text>
  );
}

/** A bullet (dot) or checklist (empty box) row; drawn as Views so no font needs the glyph. */
function Item({ text, check }: { text: string; check?: boolean }): React.ReactElement {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", gap: space(2), alignItems: "flex-start" }}>
      {check ? (
        <View
          style={{ width: 16, height: 16, marginTop: 4, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 3 }}
        />
      ) : (
        <View style={{ width: 6, height: 6, marginTop: 10, marginHorizontal: 4, borderRadius: 3, backgroundColor: colors.primary }} />
      )}
      <Rich text={text} />
    </View>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }): React.ReactElement {
  const colors = useColors();
  const { width } = useWindowDimensions();
  // The first column is usually a short label; give the rest more room.
  const flexOf = (i: number) => (i === 0 && head.length > 1 ? 1 : 2);

  if (width < TABLE_GRID_MIN_WIDTH) {
    return (
      <View style={{ gap: space(2) }}>
        {rows.map((r, ri) => (
          <View
            key={ri}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.sm,
              backgroundColor: colors.surfaceAlt,
              padding: space(3),
              gap: space(1),
            }}
          >
            <Rich text={r[0] ?? ""} />
            {r.slice(1).map((cell, ci) => (
              <View key={ci} style={{ gap: 2 }}>
                <Text style={{ color: colors.textSecondary, fontFamily: fonts.medium, fontSize: 13, lineHeight: 20 }}>
                  {boldSegments(head[ci + 1] ?? "").map((s) => s.text).join("")}
                </Text>
                <Rich text={cell} size={15} />
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }

  const line = (cells: string[], header: boolean, key: React.Key) => (
    <View
      key={key}
      style={{
        flexDirection: "row",
        borderTopWidth: header ? 0 : 1,
        borderTopColor: colors.border,
        backgroundColor: header ? colors.surfaceAlt : undefined,
      }}
    >
      {cells.map((c, ci) => (
        <View key={ci} style={{ flex: flexOf(ci), padding: space(2), flexDirection: "row" }}>
          {header ? (
            <Text style={{ flex: 1, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15, lineHeight: 22 }}>
              {boldSegments(c).map((s) => s.text).join("")}
            </Text>
          ) : (
            <Rich text={c} size={15} />
          )}
        </View>
      ))}
    </View>
  );
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: "hidden" }}>
      {line(head, true, "head")}
      {rows.map((r, ri) => line(r, false, ri))}
    </View>
  );
}

function Block({ b }: { b: HelpBlockT }): React.ReactElement | null {
  if (b.p) return <Rich text={b.p} />;
  if (b.list) {
    return (
      <View style={{ gap: space(1) }}>
        {b.list.map((t, i) => (
          <Item key={i} text={t} />
        ))}
      </View>
    );
  }
  if (b.check) {
    return (
      <View style={{ gap: space(2) }}>
        {b.check.map((t, i) => (
          <Item key={i} text={t} check />
        ))}
      </View>
    );
  }
  if (b.tableHead && b.tableRows) return <Table head={b.tableHead} rows={b.tableRows.map((r) => r.cells)} />;
  return null;
}

export function HelpReadSections({ sections }: { sections: HelpSectionT[] }): React.ReactElement {
  return (
    <>
      {sections.map((s, si) => (
        <Card key={si}>
          <H2>{boldSegments(s.heading).map((seg) => seg.text).join("")}</H2>
          <View style={{ gap: space(3), marginTop: space(3) }}>
            {s.blocks.map((b, bi) => (
              <Block key={bi} b={b} />
            ))}
          </View>
        </Card>
      ))}
    </>
  );
}

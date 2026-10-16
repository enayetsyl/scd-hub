/**
 * WorksheetPaper — the generated paper drawn natively (D-#744), from the SAME JSON the
 * server's pdfkit renderer prints, so what a teacher previews on a phone is what the
 * Office prints. Always black-on-white (it is a sheet of paper, not app chrome), with
 * the answer key in dark red when `showAnswers` is on.
 */
import React from "react";
import { Image, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { fonts } from "../theme/tokens";
import type { WorksheetHeaderT } from "../graphql/worksheet";

interface Cell {
  t: string;
  a?: string | null;
}

export interface WorksheetSection {
  n: number;
  label: string;
  note?: string | null;
  marks: number;
  kind: string;
  layout: "grid" | "groups" | "jumble" | "rows" | "columns" | "pictures" | "match" | "oral" | "manual";
  cols?: number;
  cells?: Cell[];
  sets?: Array<{ shown: string[]; answer: string[] }>;
  rows?: Cell[][];
  groups?: Array<{ label: string; note?: string | null; cols: number; cells: Cell[] }>;
  columns?: Cell[][][];
  pictures?: Array<{ pictureId: string; repeat: number; a: string }>;
  left?: Array<{ pictureId: string | null; repeat: number; t: string | null }>;
  right?: string[];
  answer?: number[];
  lines?: number;
}

export interface WorksheetDocT {
  sections: WorksheetSection[];
  total: number;
  pictureIds: string[];
  warnings: string[];
  /** Bangla handwriting guide lines inside writing boxes. */
  ruled?: boolean;
}

const INK = "#111111";
const ANSWER = "#9B1C1C";
const LINE = "#222222";
const GUIDE = "#8FA3BF";
const BN = "০১২৩৪৫৬৭৮৯";
const num = (n: number, english: boolean): string => (english ? String(n) : String(n).replace(/\d/g, (d) => BN[Number(d)]));

const txt = (size: number, color = INK): TextStyle => ({ fontFamily: fonts.regular, fontSize: size, color });
const box = (w: number | `${number}%`, h: number): ViewStyle => ({
  width: w,
  height: h,
  borderWidth: 1,
  borderColor: LINE,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#FFFFFF",
});

/** Two faint handwriting guide lines (মাত্রা + base line) inside a Bangla writing box. */
function Guides({ on }: { on: boolean }): React.ReactElement | null {
  if (!on) return null;
  const l = (top: `${number}%`): React.ReactElement => (
    <View pointerEvents="none" style={{ position: "absolute", left: 2, right: 2, top, height: 1, backgroundColor: GUIDE }} />
  );
  return (
    <>
      {l("34%")}
      {l("74%")}
    </>
  );
}

function CellText({ c, showAnswers, size = 17 }: { c: Cell; showAnswers: boolean; size?: number }): React.ReactElement | null {
  if (c.t) return <Text style={txt(size)}>{c.t}</Text>;
  if (showAnswers && c.a) return <Text style={txt(size, ANSWER)}>{c.a}</Text>;
  return null;
}

function Pic({ uri, size }: { uri: string | undefined; size: number }): React.ReactElement {
  return uri ? (
    <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="contain" />
  ) : (
    <View style={{ width: size, height: size, backgroundColor: "#EEEEEE" }} />
  );
}

function Repeated({ uri, n, icon }: { uri: string | undefined; n: number; icon: number }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 3, flex: 1 }}>
      {Array.from({ length: n }, (_, i) => (
        <Pic key={i} uri={uri} size={icon} />
      ))}
    </View>
  );
}

function Body({
  s,
  pics,
  showAnswers,
  ruled,
}: {
  s: WorksheetSection;
  pics: Record<string, string>;
  showAnswers: boolean;
  ruled: boolean;
}): React.ReactElement | null {
  const ch = ruled ? 42 : 36;
  const gridOf = (cells: Cell[], cols: number): React.ReactElement => (
    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
      {cells.map((c, i) => (
        <View key={i} style={[box(`${100 / cols}%`, ch), { marginLeft: i % cols ? -1 : 0, marginTop: i >= cols ? -1 : 0 }]}>
          <Guides on={ruled && !c.t} />
          <CellText c={c} showAnswers={showAnswers} />
        </View>
      ))}
    </View>
  );
  const itemRow = (row: Cell[], key: number): React.ReactElement => (
    <View key={key} style={{ flexDirection: "row", gap: 6 }}>
      {row.map((c, j) => (
        <View key={j} style={box(44, ch)}>
          <Guides on={ruled && !c.t} />
          <CellText c={c} showAnswers={showAnswers} />
        </View>
      ))}
    </View>
  );
  switch (s.layout) {
    case "grid":
      return gridOf(s.cells ?? [], s.cols ?? 10);
    case "groups":
      return (
        <View style={{ gap: 10 }}>
          {(s.groups ?? []).map((g, k) => (
            <View key={k} style={{ gap: 4 }}>
              <Text style={txt(14)}>
                {g.label}
                {g.note ? <Text style={txt(12, "#444444")}>{`  (${g.note})`}</Text> : null}
              </Text>
              {gridOf(g.cells, g.cols)}
            </View>
          ))}
        </View>
      );
    case "jumble":
      // One line per set, boxes spread across the full width (owner 2026-10-16).
      return (
        <View style={{ gap: 10 }}>
          {(s.sets ?? []).map((set, k) => (
            <View key={k}>
              <View style={{ flexDirection: "row" }}>
                {set.shown.map((t, i) => (
                  <View key={i} style={[box(`${100 / set.shown.length}%`, 34), { marginLeft: i ? -1 : 0 }]}>
                    <Text style={txt(17)}>{t}</Text>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: "row", marginTop: -1 }}>
                {set.answer.map((a, i) => (
                  <View key={i} style={[box(`${100 / set.answer.length}%`, ch), { marginLeft: i ? -1 : 0 }]}>
                    <Guides on={ruled} />
                    {showAnswers ? <Text style={txt(17, ANSWER)}>{a}</Text> : null}
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    case "rows":
      return (
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 6 }}>
          {(s.rows ?? []).map((row, i) => (
            <View key={i} style={{ width: "50%", minWidth: 150 }}>
              {itemRow(row, i)}
            </View>
          ))}
        </View>
      );
    case "columns":
      // Before/after: each column top to bottom, in the order the teacher set.
      return (
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 12 }}>
          {(s.columns ?? []).map((col, k) => (
            <View key={k} style={{ width: "50%", minWidth: 150, gap: 6 }}>
              {col.map((row, i) => itemRow(row, i))}
            </View>
          ))}
        </View>
      );
    case "pictures": {
      const items = s.pictures ?? [];
      const counting = items.some((p) => p.repeat > 1);
      if (counting) {
        return (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {items.map((p, i) => (
              <View
                key={i}
                style={{ flexBasis: 240, flexGrow: 1, borderWidth: 1, borderColor: LINE, padding: 6, flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Repeated uri={pics[p.pictureId]} n={p.repeat} icon={22} />
                <View style={box(40, 36)}>{showAnswers ? <Text style={txt(16, ANSWER)}>{p.a}</Text> : null}</View>
              </View>
            ))}
          </View>
        );
      }
      return (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {items.map((p, i) => (
            <View key={i} style={{ width: 96, borderWidth: 1, borderColor: LINE, alignItems: "center", padding: 4, gap: 4 }}>
              <Pic uri={pics[p.pictureId]} size={70} />
              <View style={box(36, 38)}>
                <Guides on={ruled} />
                {showAnswers ? <Text style={txt(17, ANSWER)}>{p.a}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      );
    }
    case "match": {
      const left = s.left ?? [];
      const right = s.right ?? [];
      return (
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 6, columnGap: 16 }}>
          {left.map((l, i) => (
            <View key={i} style={{ flexBasis: 260, flexGrow: 1, flexDirection: "row", alignItems: "center" }}>
              <View style={[box(110, 54), { padding: 3 }]}>
                {l.pictureId && l.repeat > 1 ? (
                  <Repeated uri={pics[l.pictureId]} n={l.repeat} icon={12} />
                ) : l.pictureId ? (
                  <Pic uri={pics[l.pictureId]} size={46} />
                ) : (
                  <Text style={txt(17)}>{l.t}</Text>
                )}
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                {showAnswers && s.answer ? <Text style={txt(15, ANSWER)}>{right[s.answer[i]]}</Text> : <Text style={txt(14)}>•    •</Text>}
              </View>
              <View style={box(60, 54)}>
                <Text style={txt((right[i] ?? "").length > 3 ? 14 : 19)}>{right[i]}</Text>
              </View>
            </View>
          ))}
        </View>
      );
    }
    case "manual":
      return (
        <View style={{ gap: 18, paddingTop: 6 }}>
          {Array.from({ length: s.lines ?? 2 }, (_, i) => (
            <View key={i} style={{ borderBottomWidth: 1, borderColor: "#777777", height: 4 }} />
          ))}
        </View>
      );
    default:
      return null;
  }
}

export default function WorksheetPaper({
  doc,
  header,
  pictures,
  showAnswers,
}: {
  doc: WorksheetDocT;
  header: WorksheetHeaderT;
  pictures: Record<string, string>;
  showAnswers: boolean;
}): React.ReactElement {
  const en = header.english;
  return (
    <View
      accessibilityLabel={header.title}
      style={{ backgroundColor: "#FFFFFF", padding: 16, borderRadius: 4, borderWidth: 1, borderColor: "#D3DCD6", width: "100%", maxWidth: 720, alignSelf: "center" }}
    >
      <View style={{ alignItems: "center", gap: 2 }}>
        <Text style={txt(17)}>{header.school}</Text>
        <Text style={txt(15)}>
          {header.title}
          {showAnswers ? (en ? " — Answer key" : " — উত্তরপত্র") : ""}
        </Text>
        {header.subtitle ? <Text style={txt(13)}>{header.subtitle}</Text> : null}
        <Text style={txt(14)}>{header.classLine}</Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10 }}>
        <Text style={txt(13)}>{header.meta ?? ""}</Text>
        <Text style={txt(13)}>{header.fullMarks}</Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6, marginBottom: 6 }}>
        <Text style={txt(13)}>{header.nameLabel}: ____________________</Text>
        <Text style={txt(13)}>{header.idLabel}: ________</Text>
      </View>
      <View style={{ height: 1, backgroundColor: "#888888", marginBottom: 8 }} />

      {doc.sections.map((s) => (
        <View key={s.n} style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <Text style={[txt(15), { flex: 1 }]}>
              {num(s.n, en)}. {s.label}
            </Text>
            <Text style={txt(15)}>[{num(s.marks, en)}]</Text>
          </View>
          {s.note ? <Text style={[txt(12, "#444444"), { marginBottom: 4, marginLeft: 12 }]}>({s.note})</Text> : null}
          <Body s={s} pics={pictures} showAnswers={showAnswers} ruled={!!doc.ruled} />
        </View>
      ))}
    </View>
  );
}

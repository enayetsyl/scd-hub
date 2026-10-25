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

interface PromptLine {
  label?: string | null;
  blanks: number;
  answers?: string[] | null;
  wide?: boolean;
}

interface PromptItem {
  prompt: string;
  sentence?: boolean;
  tall?: boolean;
  lines: PromptLine[];
  gapAnswer?: string | null;
}

/** "×", "=" between the boxes of a times-table line print bare, as on the 2025 KG paper. */
const OPERATORS = new Set(["×", "=", "+", "-"]);

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
  layout: "grid" | "groups" | "jumble" | "rows" | "columns" | "pictures" | "choice" | "prompts" | "vertical" | "match" | "oral" | "manual";
  cols?: number;
  cells?: Cell[];
  /** `label` names an ordering set's direction ("ছোট থেকে বড়"). */
  sets?: Array<{ shown: string[]; answer: string[]; label?: string | null }>;
  rows?: Cell[][];
  groups?: Array<{ label: string; note?: string | null; cols: number; cells: Cell[] }>;
  columns?: Cell[][][];
  pictures?: Array<{ pictureId: string; repeat: number; a: string }>;
  /** A picture and its printed options; the child circles one (`answer` indexes `options`). */
  choices?: Array<{ pictureId: string | null; options: string[]; answer: number }>;
  /** rows / pictures: the answer is a word — one wide box per item. */
  wide?: boolean;
  /** KG prompt questions (D-#846): what is given, then the child's boxes. */
  items?: PromptItem[];
  /** উপরে-নিচে যোগ/বিয়োগ. */
  sums?: Array<{ a: string; b: string; op: string; answer: string }>;
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
  /** Handwriting guide lines inside writing boxes. */
  ruled?: boolean;
  /** BAN = two blue lines; ENG = the four-line English khata (red, blue, blue, red). */
  ruling?: "BAN" | "ENG";
  /** Arabic (D-#802): grids, item cells and options run from the right. */
  dir?: "rtl";
}

/**
 * ঁ ং ঃ (any Bengali vowel sign) on their own get a dotted circle (◌) from the text shaper.
 * A no-break space in front is the Unicode placeholder base: the mark shows alone, no circle
 * (owner 2026-10-17). Display only. Same rule as the server's render/markBase.ts — keep in step.
 */
const LEADING_MARK = /^[\u0981-\u0983\u09BC\u09BE-\u09CD\u09D7\u09E2\u09E3]/;
function markBase(s: string): string;
function markBase(s: string | null | undefined): string | null | undefined;
function markBase(s: string | null | undefined): string | null | undefined {
  return s && LEADING_MARK.test(s) ? "\u00A0" + s : s;
}
const markCell = (c: Cell): Cell => ({ ...c, t: markBase(c.t), a: markBase(c.a) });
function withMarkBases(doc: WorksheetDocT): WorksheetDocT {
  return {
    ...doc,
    sections: doc.sections.map((s) => ({
      ...s,
      cells: s.cells?.map(markCell),
      rows: s.rows?.map((r) => r.map(markCell)),
      columns: s.columns?.map((col) => col.map((r) => r.map(markCell))),
      groups: s.groups?.map((g) => ({ ...g, cells: g.cells.map(markCell) })),
      sets: s.sets?.map((x) => ({ shown: x.shown.map((t) => markBase(t)), answer: x.answer.map((t) => markBase(t)) })),
      pictures: s.pictures?.map((p) => ({ ...p, a: markBase(p.a) })),
      choices: s.choices?.map((x) => ({ ...x, options: x.options.map((t) => markBase(t)) })),
      left: s.left?.map((l) => ({ ...l, t: markBase(l.t) ?? null })),
      right: s.right?.map((t) => markBase(t)),
    })),
  };
}

const INK = "#111111";
const ANSWER = "#9B1C1C";
const LINE = "#222222";
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
/** One centimetre on screen (CSS reference pixel, 96 dpi) — the preview keeps the real
 *  copybook spacing (owner 2026-10-16): Bangla two lines 0.8 cm apart; English khata four
 *  lines, red / blue / blue / red, 0.4 cm apart (1.2 cm first to fourth). */
const CM_PX = 96 / 2.54;
const GUIDES: Record<"BAN" | "ENG", Array<[number, string]>> = {
  BAN: [[0, "#8FA3BF"], [0.8 * CM_PX, "#8FA3BF"]],
  ENG: [[0, "#E07A7A"], [0.4 * CM_PX, "#7F9BD6"], [0.8 * CM_PX, "#7F9BD6"], [1.2 * CM_PX, "#E07A7A"]],
};
/** A ruled writing box tall enough for its guides, as on the printed sheet. */
const ruledPx = (r: "BAN" | "ENG"): number => Math.round((r === "ENG" ? 1.8 : 1.4) * CM_PX);
const RulingContext = React.createContext<"BAN" | "ENG">("BAN");

/** The guide lines, centred vertically in the box at their real spacing. */
function Guides({ on }: { on: boolean }): React.ReactElement | null {
  const ruling = React.useContext(RulingContext);
  if (!on) return null;
  const lines = GUIDES[ruling];
  const span = lines[lines.length - 1][0];
  return (
    <>
      {lines.map(([off, colour]) => (
        <View
          key={off}
          pointerEvents="none"
          style={{ position: "absolute", left: 2, right: 2, top: "50%", marginTop: off - span / 2, height: 1, backgroundColor: colour }}
        />
      ))}
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

/** One option box beside a choice picture — the options share the rest of the line. */
const OPTION_CELL: ViewStyle = {
  flex: 1,
  height: 62,
  borderWidth: 1,
  borderColor: LINE,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#FFFFFF",
};

/** A choice option is a word (four of them, a line to itself) once it is longer than a letter. */
const isWordOption = (o: string): boolean => [...o].length > 2;

function Body({
  s,
  pics,
  showAnswers,
  ruled,
  rtl,
}: {
  s: WorksheetSection;
  pics: Record<string, string>;
  showAnswers: boolean;
  ruled: boolean;
  rtl: boolean;
}): React.ReactElement | null {
  const ruling = React.useContext(RulingContext);
  const ch = ruled ? ruledPx(ruling) : 36;
  // Right to left (Arabic): rows run from the right, so the shared border overlaps on the right.
  const row: ViewStyle["flexDirection"] = rtl ? "row-reverse" : "row";
  const overlap = (on: boolean): ViewStyle => (on ? (rtl ? { marginRight: -1 } : { marginLeft: -1 }) : {});
  const gridOf = (cells: Cell[], cols: number): React.ReactElement => (
    <View style={{ flexDirection: row, flexWrap: "wrap" }}>
      {cells.map((c, i) => (
        <View key={i} style={[box(`${100 / cols}%`, ch), overlap(i % cols > 0), { marginTop: i >= cols ? -1 : 0 }]}>
          <Guides on={ruled && !c.t} />
          <CellText c={c} showAnswers={showAnswers} />
        </View>
      ))}
    </View>
  );
  const itemRow = (cells: Cell[], key: number): React.ReactElement => (
    <View key={key} style={{ flexDirection: row, gap: cells.length > 3 ? 4 : 6, alignItems: "center" }}>
      {cells.map((c, j) =>
        OPERATORS.has(c.t) ? (
          <Text key={j} style={[txt(17), { width: 16, textAlign: "center" }]}>
            {c.t}
          </Text>
        ) : (
          <View key={j} style={box(cells.length > 3 ? 38 : 44, ch)}>
            <Guides on={ruled && !c.t} />
            <CellText c={c} showAnswers={showAnswers} />
          </View>
        ),
      )}
    </View>
  );
  /** One line of answer boxes: an optional caption, then the boxes (or one wide box). */
  const promptLine = (ln: PromptLine, key: number): React.ReactElement => (
    <View key={key} style={{ flexDirection: row, flexWrap: "wrap", gap: 6, flex: 1, alignItems: "center" }}>
      {ln.label ? (
        <View style={box(70, ch)}>
          <Text style={txt(14)}>{ln.label}</Text>
        </View>
      ) : null}
      {ln.wide ? (
        <View style={[box("100%", ch), { flex: 1, minWidth: 140 }]}>
          <Guides on={ruled} />
          {showAnswers && ln.answers?.length ? <Text style={txt(15, ANSWER)}>{ln.answers.filter(Boolean).join(", ")}</Text> : null}
        </View>
      ) : (
        Array.from({ length: ln.blanks }, (_, i) => (
          <View key={i} style={[box(ln.blanks === 1 ? 90 : 100, ch), { flexGrow: ln.blanks === 1 ? 0 : 1 }]}>
            <Guides on={ruled} />
            {showAnswers && ln.answers?.[i] ? <Text style={txt(15, ANSWER)}>{ln.answers[i]}</Text> : null}
          </View>
        ))
      )}
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
              {set.label ? <Text style={[txt(13, "#333333"), { marginBottom: 2 }]}>{set.label}</Text> : null}
              <View style={{ flexDirection: row }}>
                {set.shown.map((t, i) => (
                  <View key={i} style={[box(`${100 / set.shown.length}%`, 34), overlap(i > 0)]}>
                    <Text style={txt(17)}>{t}</Text>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: row, marginTop: -1 }}>
                {set.answer.map((a, i) => (
                  <View key={i} style={[box(`${100 / set.answer.length}%`, ch), overlap(i > 0)]}>
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
      if (s.wide) {
        // A word and the child's answer: one item per line, a wide box for the writing.
        return (
          <View style={{ gap: 6 }}>
            {(s.rows ?? []).map((cells, i) => (
              <View key={i} style={{ flexDirection: row, gap: 8 }}>
                {cells.map((c, j) => (
                  <View key={j} style={[box(j === 0 ? "36%" : "60%", Math.max(ch, 40)), { flexGrow: j === 0 ? 0 : 1 }]}>
                    <Guides on={ruled && !c.t} />
                    <CellText c={c} showAnswers={showAnswers} />
                  </View>
                ))}
              </View>
            ))}
          </View>
        );
      }
      return (
        <View style={{ flexDirection: row, flexWrap: "wrap", rowGap: 6 }}>
          {(s.rows ?? []).map((cells, i) => (
            <View key={i} style={{ width: "50%", minWidth: 150 }}>
              {itemRow(cells, i)}
            </View>
          ))}
        </View>
      );
    case "columns":
      // Before/after: each column top to bottom, in the order the teacher set.
      return (
        <View style={{ flexDirection: row, flexWrap: "wrap", rowGap: 12 }}>
          {(s.columns ?? []).map((col, k) => (
            <View key={k} style={{ width: "50%", minWidth: 150, gap: 6 }}>
              {col.map((cells, i) => itemRow(cells, i))}
            </View>
          ))}
        </View>
      );
    case "prompts":
      // KG prompt questions (D-#846): one item a line — given, then the child's boxes.
      return (
        <View style={{ gap: 8 }}>
          {(s.items ?? []).map((it, k) => {
            if (it.sentence) {
              const [before, after = ""] = it.prompt.split("____");
              return (
                <Text key={k} style={[txt(16), { marginLeft: 8 }]}>
                  {before}
                  <Text style={txt(16, showAnswers && it.gapAnswer ? ANSWER : "#777777")}>
                    {showAnswers && it.gapAnswer ? ` ${it.gapAnswer} ` : " ________________ "}
                  </Text>
                  {after}
                </Text>
              );
            }
            if (it.lines.length === 1) {
              return (
                <View key={k} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                  {it.prompt ? (
                    <View style={box(110, it.tall ? ch + 30 : ch)}>
                      <Text style={txt(16)}>{it.prompt}</Text>
                    </View>
                  ) : null}
                  {promptLine(it.lines[0], 0)}
                </View>
              );
            }
            return (
              <View key={k} style={{ gap: 4 }}>
                <Text style={txt(16)}>{it.prompt}</Text>
                <View style={{ gap: 4, marginLeft: 14 }}>{it.lines.map((ln, j) => promptLine(ln, j))}</View>
              </View>
            );
          })}
        </View>
      );
    case "vertical":
      // উপরে-নিচে যোগ/বিয়োগ: a over b, a rule, an answer box — five a line on paper, wrapping here.
      return (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(s.sums ?? []).map((sm, i) => (
            <View key={i} style={{ width: 96, borderWidth: 1, borderColor: LINE, padding: 6, alignItems: "flex-end" }}>
              <Text style={txt(18)}>{sm.a}</Text>
              <Text style={txt(18)}>
                {sm.op}  {sm.b}
              </Text>
              <View style={{ alignSelf: "stretch", height: 1, backgroundColor: LINE, marginVertical: 3 }} />
              <View style={box(56, 30)}>{showAnswers ? <Text style={txt(16, ANSWER)}>{sm.answer}</Text> : null}</View>
            </View>
          ))}
        </View>
      );
    case "choice": {
      // A picture, then its options; the child circles one. The key outlines the right one.
      const items = s.choices ?? [];
      const words = items.some((c) => c.options.some(isWordOption));
      return (
        <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
          {items.map((c, i) => (
            <View key={i} style={{ flexDirection: row, flexBasis: words ? "100%" : 300, flexGrow: 1 }}>
              <View style={[box(72, 62), { padding: 3 }]}>
                {c.pictureId ? <Pic uri={pics[c.pictureId]} size={54} /> : null}
              </View>
              {c.options.map((o, k) => (
                <View key={k} style={[OPTION_CELL, overlap(true)]}>
                  <View
                    style={
                      showAnswers && k === c.answer
                        ? { borderWidth: 2, borderColor: ANSWER, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 }
                        : { paddingHorizontal: 10, paddingVertical: 2 }
                    }
                  >
                    <Text style={txt(isWordOption(o) ? 17 : 20)}>{o}</Text>
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    }
    case "pictures": {
      const items = s.pictures ?? [];
      if (s.wide) {
        // Picture → write its word: the answer box is the card's width.
        return (
          <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
            {items.map((p, i) => (
              <View key={i} style={{ width: 150, borderWidth: 1, borderColor: LINE, alignItems: "center", padding: 4, gap: 4 }}>
                <Pic uri={pics[p.pictureId]} size={80} />
                <View style={box("100%", ruled ? ch : 38)}>
                  <Guides on={ruled} />
                  {showAnswers ? <Text style={txt(17, ANSWER)}>{p.a}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        );
      }
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
                <View style={box(40, ruled ? ch : 38)}>
                  <Guides on={ruled} />
                  {showAnswers ? <Text style={txt(16, ANSWER)}>{p.a}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        );
      }
      return (
        <View style={{ flexDirection: row, flexWrap: "wrap", gap: 8 }}>
          {items.map((p, i) => (
            <View key={i} style={{ width: 96, borderWidth: 1, borderColor: LINE, alignItems: "center", padding: 4, gap: 4 }}>
              <Pic uri={pics[p.pictureId]} size={70} />
              <View style={box(44, ruled ? ch : 38)}>
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
        // Two real columns, each its own puzzle (the engine puts item i in column i % 2). A
        // wrapped grid let an odd last item stretch across the page, so its answer box sat
        // under the OTHER column (owner 2026-10-17). On a phone column 2 drops below column 1.
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 6, columnGap: 16, alignItems: "flex-start" }}>
          {[0, 1].map((col) => (
            <View key={col} style={{ flexBasis: 260, flexGrow: 1, flexShrink: 1, gap: 6 }}>
              {left.map((l, i) => (i % 2 !== col ? null : (
            <View key={i} style={{ flexDirection: "row", alignItems: "center" }}>
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
              <View style={box(rtl && (right[i] ?? "").length > 3 ? 100 : 60, 54)}>
                <Text style={txt((right[i] ?? "").length > 3 ? 14 : 19)}>{right[i]}</Text>
              </View>
            </View>
              )))}
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
  const paper = withMarkBases(doc);
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

      {paper.sections.map((s) => (
        <View key={s.n} style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <Text style={[txt(15), { flex: 1 }]}>
              {num(s.n, en)}. {s.label}
            </Text>
            <Text style={txt(15)}>[{num(s.marks, en)}]</Text>
          </View>
          {s.note ? <Text style={[txt(12, "#444444"), { marginBottom: 4, marginLeft: 12 }]}>({s.note})</Text> : null}
          <RulingContext.Provider value={doc.ruling ?? "BAN"}>
            <Body s={s} pics={pictures} showAnswers={showAnswers} ruled={!!doc.ruled} rtl={doc.dir === "rtl"} />
          </RulingContext.Provider>
        </View>
      ))}
    </View>
  );
}

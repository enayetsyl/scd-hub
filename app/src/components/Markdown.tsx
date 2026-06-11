/**
 * Markdown — a small, dependency-free Markdown renderer for plan content.
 *
 * Plans are stored as authored Markdown (ADR-006: shown verbatim, never re-rendered
 * from JSON). This renders the block + inline constructs the lesson-plan deliverables
 * actually use — headings, bold/italic/inline-code, ordered & bullet lists (incl. GFM
 * `- [ ]` task items), GFM tables, blockquotes, horizontal rules — with the app's
 * themed primitives. Authored HTML comments (`<!-- INTERNAL FOOTER … -->`) are
 * stripped and never shown, matching the PDF renderer.
 *
 * Intentionally a focused subset, not a full CommonMark engine.
 */
import React from "react";
import { View, Text, StyleSheet, type TextStyle } from "react-native";
import { colors, radius, space } from "../theme/tokens";

/** Drop HTML comments before rendering — they are internal provenance, never shown. */
export function stripHtmlComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, "");
}

// ---------------------------------------------------------------------------
// Block model + parser
// ---------------------------------------------------------------------------

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; text: string; checked: boolean | null }
  | { kind: "ordered"; num: string; text: string }
  | { kind: "quote"; text: string }
  | { kind: "hr" }
  | { kind: "table"; header: string[]; rows: string[][] };

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isDelimiterRow(line: string): boolean {
  if (!/^\s*\|?[\s:|-]+$/.test(line) || line.indexOf("-") === -1) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function isSpecial(line: string): boolean {
  return (
    /^#{1,6}\s+/.test(line) ||
    /^\s*([-*_])\1{2,}\s*$/.test(line) ||
    /^\s*\|/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^\s*[-*+]\s+/.test(line)
  );
}

function parseBlocks(src: string): Block[] {
  const lines = stripHtmlComments(src).replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: "heading", level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    if (/^\s*\|/.test(line) && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      const header = splitRow(line);
      i += 2; // skip header + delimiter
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: buf.join(" ").trim() });
      continue;
    }

    const ol = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (ol) {
      blocks.push({ kind: "ordered", num: ol[1], text: ol[2].trim() });
      i++;
      continue;
    }

    const bl = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bl) {
      let content = bl[1];
      let checked: boolean | null = null;
      const task = /^\[([ xX])\]\s+(.*)$/.exec(content);
      if (task) {
        checked = task[1].toLowerCase() === "x";
        content = task[2];
      }
      blocks.push({ kind: "bullet", text: content.trim(), checked });
      i++;
      continue;
    }

    // Paragraph: gather wrapped lines until a blank or a block-starting line.
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !isSpecial(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "paragraph", text: buf.join(" ").trim() });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Inline (bold / italic / code)
// ---------------------------------------------------------------------------

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;

function renderInline(text: string, keyPrefix: string, base?: TextStyle): React.ReactNode {
  const parts = text.split(INLINE);
  return parts.map((part, idx) => {
    if (!part) return null;
    const key = `${keyPrefix}-${idx}`;
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return (
        <Text key={key} style={[base, styles.bold]}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <Text key={key} style={[base, styles.code]}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      return (
        <Text key={key} style={[base, styles.italic]}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    return (
      <Text key={key} style={base}>
        {part}
      </Text>
    );
  });
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

function Table({ header, rows, k }: { header: string[]; rows: string[][]; k: string }): React.ReactElement {
  const nCols = Math.max(header.length, ...rows.map((r) => r.length));
  const pad = (cells: string[]): string[] => {
    const out = [...cells];
    while (out.length < nCols) out.push("");
    return out;
  };
  return (
    <View style={styles.table}>
      <View style={[styles.tr, styles.thead]}>
        {pad(header).map((cell, ci) => (
          <View key={`${k}-h-${ci}`} style={styles.cell}>
            <Text style={styles.body}>{renderInline(cell, `${k}-h-${ci}`, styles.thText)}</Text>
          </View>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={`${k}-r-${ri}`} style={styles.tr}>
          {pad(row).map((cell, ci) => (
            <View key={`${k}-r-${ri}-${ci}`} style={styles.cell}>
              <Text style={styles.body}>{renderInline(cell, `${k}-r-${ri}-${ci}`)}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function renderBlock(b: Block, k: string): React.ReactElement {
  switch (b.kind) {
    case "heading": {
      const hStyle = b.level === 1 ? styles.h1 : b.level === 2 ? styles.h2 : styles.h3;
      return (
        <Text key={k} style={hStyle}>
          {renderInline(b.text, k)}
        </Text>
      );
    }
    case "hr":
      return <View key={k} style={styles.hr} />;
    case "quote":
      return (
        <View key={k} style={styles.quote}>
          <Text style={styles.quoteText}>{renderInline(b.text, k, styles.quoteText)}</Text>
        </View>
      );
    case "bullet":
      return (
        <View key={k} style={styles.listItem}>
          <Text style={styles.bulletMark}>{b.checked === null ? "•" : b.checked ? "☑" : "☐"}</Text>
          <Text style={[styles.body, styles.listText]}>{renderInline(b.text, k)}</Text>
        </View>
      );
    case "ordered":
      return (
        <View key={k} style={styles.listItem}>
          <Text style={styles.orderedMark}>{b.num}.</Text>
          <Text style={[styles.body, styles.listText]}>{renderInline(b.text, k)}</Text>
        </View>
      );
    case "table":
      return <Table key={k} header={b.header} rows={b.rows} k={k} />;
    case "paragraph":
    default:
      return (
        <Text key={k} style={[styles.body, styles.paragraph]}>
          {renderInline(b.text, k)}
        </Text>
      );
  }
}

export default function Markdown({ source }: { source: string }): React.ReactElement {
  const blocks = React.useMemo(() => parseBlocks(source), [source]);
  return <View>{blocks.map((b, idx) => renderBlock(b, `b-${idx}`))}</View>;
}

const styles = StyleSheet.create({
  h1: { fontSize: 20, fontWeight: "700", color: colors.ink, marginTop: space(4), marginBottom: space(2), lineHeight: 28 },
  h2: { fontSize: 17, fontWeight: "700", color: colors.ink, marginTop: space(4), marginBottom: space(1.5), lineHeight: 24 },
  h3: { fontSize: 15, fontWeight: "700", color: colors.ink, marginTop: space(3), marginBottom: space(1), lineHeight: 22 },
  body: { fontSize: 15, color: colors.ink, lineHeight: 22 },
  paragraph: { marginBottom: space(2.5) },

  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  code: {
    fontFamily: "monospace",
    backgroundColor: "#f1f5f9",
    color: colors.brand800,
    fontSize: 14,
  },

  hr: { height: 1, backgroundColor: colors.line, marginVertical: space(3) },

  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.brand500,
    backgroundColor: colors.brand50,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    marginBottom: space(2.5),
    borderRadius: radius.sm,
  },
  quoteText: { fontSize: 14, color: colors.muted, lineHeight: 21 },

  listItem: { flexDirection: "row", marginBottom: space(1.5), paddingRight: space(2) },
  bulletMark: { fontSize: 15, color: colors.brand700, width: space(5), lineHeight: 22 },
  orderedMark: { fontSize: 15, color: colors.brand700, fontWeight: "700", minWidth: space(6), lineHeight: 22 },
  listText: { flex: 1 },

  table: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    overflow: "hidden",
    marginBottom: space(3),
  },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.line },
  thead: { backgroundColor: colors.brand50 },
  thText: { fontWeight: "700", color: colors.brand800 },
  cell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: space(2),
    paddingVertical: space(1.5),
    borderRightWidth: 1,
    borderRightColor: colors.line,
  },
});

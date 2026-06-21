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
import { View, Text, ScrollView, type TextStyle } from "react-native";
import { makeStyles, radius, space, typeScale, fonts } from "../theme";

// A table with this many columns or more can't fit a phone width without squeezing
// each column to ~1 character (Bangla then wraps vertically). Such tables switch to
// fixed-width columns inside a horizontal scroller; narrow key/value tables keep the
// flexible full-width layout. (BUG-001)
const WIDE_TABLE_MIN_COLS = 4;
const WIDE_TABLE_COL_WIDTH = 150;

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

type MdStyles = ReturnType<typeof useStyles>;

function renderInline(styles: MdStyles, text: string, keyPrefix: string, base?: TextStyle): React.ReactNode {
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
  const styles = useStyles();
  const nCols = Math.max(header.length, ...rows.map((r) => r.length));
  const wide = nCols >= WIDE_TABLE_MIN_COLS;
  const cellStyle = wide ? styles.cellWide : styles.cell;
  const pad = (cells: string[]): string[] => {
    const out = [...cells];
    while (out.length < nCols) out.push("");
    return out;
  };
  const table = (
    <View style={[styles.table, wide ? { width: nCols * WIDE_TABLE_COL_WIDTH, marginBottom: 0 } : null]}>
      <View style={[styles.tr, styles.thead]}>
        {pad(header).map((cell, ci) => (
          <View key={`${k}-h-${ci}`} style={cellStyle}>
            <Text style={styles.body}>{renderInline(styles, cell, `${k}-h-${ci}`, styles.thText)}</Text>
          </View>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={`${k}-r-${ri}`} style={styles.tr}>
          {pad(row).map((cell, ci) => (
            <View key={`${k}-r-${ri}-${ci}`} style={cellStyle}>
              <Text style={styles.body}>{renderInline(styles, cell, `${k}-r-${ri}-${ci}`)}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
  // Wide tables overflow a phone width — let them scroll horizontally instead of
  // crushing every column to ~1 character (BUG-001).
  if (wide) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.tableScroll}>
        {table}
      </ScrollView>
    );
  }
  return table;
}

function renderBlock(styles: MdStyles, b: Block, k: string): React.ReactElement {
  switch (b.kind) {
    case "heading": {
      const hStyle = b.level === 1 ? styles.h1 : b.level === 2 ? styles.h2 : styles.h3;
      return (
        <Text key={k} style={hStyle}>
          {renderInline(styles, b.text, k)}
        </Text>
      );
    }
    case "hr":
      return <View key={k} style={styles.hr} />;
    case "quote":
      return (
        <View key={k} style={styles.quote}>
          <Text style={styles.quoteText}>{renderInline(styles, b.text, k, styles.quoteText)}</Text>
        </View>
      );
    case "bullet":
      return (
        <View key={k} style={styles.listItem}>
          <Text style={styles.bulletMark}>{b.checked === null ? "•" : b.checked ? "☑" : "☐"}</Text>
          <Text style={[styles.body, styles.listText]}>{renderInline(styles, b.text, k)}</Text>
        </View>
      );
    case "ordered":
      return (
        <View key={k} style={styles.listItem}>
          <Text style={styles.orderedMark}>{b.num}.</Text>
          <Text style={[styles.body, styles.listText]}>{renderInline(styles, b.text, k)}</Text>
        </View>
      );
    case "table":
      return <Table key={k} header={b.header} rows={b.rows} k={k} />;
    case "paragraph":
    default:
      return (
        <Text key={k} style={[styles.body, styles.paragraph]}>
          {renderInline(styles, b.text, k)}
        </Text>
      );
  }
}

export default function Markdown({ source }: { source: string }): React.ReactElement {
  const styles = useStyles();
  const blocks = React.useMemo(() => parseBlocks(source), [source]);
  return <View>{blocks.map((b, idx) => renderBlock(styles, b, `b-${idx}`))}</View>;
}

const useStyles = makeStyles((colors) => ({
  // Headings map onto the §5 scale: h1=pageTitle, h2=sectionTitle, h3=bodyStrong.
  h1: { ...typeScale.pageTitle, color: colors.textPrimary, marginTop: space(4), marginBottom: space(2) },
  h2: { ...typeScale.sectionTitle, color: colors.textPrimary, marginTop: space(4), marginBottom: space(2) },
  h3: { ...typeScale.bodyStrong, color: colors.textPrimary, marginTop: space(3), marginBottom: space(1) },
  body: { ...typeScale.body, color: colors.textPrimary },
  paragraph: { marginBottom: space(3) },

  bold: { fontFamily: fonts.bold },
  italic: { fontStyle: "italic" as const },
  code: {
    fontFamily: "monospace",
    backgroundColor: colors.surfaceAlt,
    color: colors.textPrimary,
    fontSize: 14,
  },

  hr: { height: 1, backgroundColor: colors.border, marginVertical: space(3) },

  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    marginBottom: space(3),
    borderRadius: radius.sm,
  },
  quoteText: { ...typeScale.secondary, color: colors.textSecondary },

  listItem: { flexDirection: "row" as const, marginBottom: space(2), paddingRight: space(2) },
  bulletMark: { ...typeScale.body, color: colors.primary, width: space(5) },
  orderedMark: { ...typeScale.bodyStrong, color: colors.primary, minWidth: space(6) },
  listText: { flex: 1 },

  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    overflow: "hidden" as const,
    marginBottom: space(3),
  },
  tr: { flexDirection: "row" as const, borderBottomWidth: 1, borderBottomColor: colors.border },
  thead: { backgroundColor: colors.surfaceAlt },
  thText: { fontFamily: fonts.bold, color: colors.textPrimary },
  cell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: space(2),
    paddingVertical: space(2),
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  // Wide-table cell: a fixed column width so Bangla wraps at word boundaries
  // (not 1 char per line) and the table scrolls horizontally (BUG-001).
  cellWide: {
    width: WIDE_TABLE_COL_WIDTH,
    paddingHorizontal: space(2),
    paddingVertical: space(2),
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  tableScroll: { marginBottom: space(3) },
}));

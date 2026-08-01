/**
 * Server-side Markdown→PDF renderer (ADR-009, J1.8).
 *
 * The bundled NotoSansBengali-Regular.ttf is a Bengali-only SUBSET — it has the
 * Bengali block (U+0980–U+09FF) but NO Latin glyphs. Plans are mixed Bengali +
 * English, so we draw Bengali runs in Noto and fall back to pdfkit's built-in
 * Helvetica for Latin/ASCII runs (mixedText below). No extra font file is needed,
 * so this stays portable to the Linux deploy.
 *
 * The rendered_markdown stored in ContentArtifact is the only input — the payload
 * JSON is never consulted here (R-C3/ADR-006).
 */
import PDFDocument from "pdfkit";
import MarkdownIt from "markdown-it";
import * as path from "path";
import type { Token } from "markdown-it";

const FONT_PATH = path.resolve(__dirname, "../../assets/fonts/NotoSansBengali-Regular.ttf");
export const BENGALI_FONT = "NotoSansBengali";
export const LATIN_FONT = "Helvetica"; // pdfkit built-in (WinAnsi) — covers Latin + symbols/bullets

const md = new MarkdownIt({ html: false, linkify: false });

/** Drop HTML comments (e.g. the authored `<!-- INTERNAL FOOTER … -->`) before
 *  parsing. With `html:false` markdown-it would otherwise render a comment block
 *  as literal paragraph text — it must never surface in the plan. */
export function stripHtmlComments(markdownText: string): string {
  return markdownText.replace(/<!--[\s\S]*?-->/g, "");
}

/** Drop emoji / pictographs the embedded fonts can't render. The Noto-Bengali
 *  subset and Helvetica have no emoji glyphs, so a char like 🟦 would render as a
 *  .notdef box that smudges over the adjacent text. (Web renders emoji via system
 *  fonts, so this strip is PDF-only.) */
export function stripUnsupportedGlyphs(text: string): string {
  return text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "").replace(/  +/g, " ");
}

/** Map math / arrow symbols outside the embedded fonts' coverage (Helvetica is
 *  WinAnsi; the Noto subset is Bengali-only) to ASCII equivalents, so e.g. "≈35 min"
 *  renders as "~35 min" instead of a .notdef box. PDF-only. */
const PDF_TRANSLITERATIONS: Record<string, string> = {
  "≈": "~",
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "→": "->",
  "←": "<-",
  "↔": "<->",
};
export function transliterateForPdf(text: string): string {
  return text.replace(/[≈≤≥≠→←↔]/g, (ch) => PDF_TRANSLITERATIONS[ch] ?? ch);
}

// ---------------------------------------------------------------------------
// Mixed-script text (Bengali via Noto, Latin/ASCII via Helvetica fallback)
// ---------------------------------------------------------------------------

type RunFont = typeof BENGALI_FONT | typeof LATIN_FONT;
interface Run {
  font: RunFont;
  text: string;
}

/** Strong script of a codepoint; null = neutral (inherits the current run). */
function strongFont(cp: number): RunFont | null {
  if ((cp >= 0x0980 && cp <= 0x09ff) || cp === 0x0964 || cp === 0x0965) return BENGALI_FONT; // Bengali + danda
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return LATIN_FONT; // A–Z / a–z
  // U+00B7 MIDDLE DOT is the separator half this codebase writes inside Bangla
  // sentences ("পুনঃজমা ৩ · রিমাইন্ডার ২"). As a NEUTRAL it inherited the Bengali
  // run, and the Noto-Bengali subset has no glyph for it — so every one of them
  // drew a .notdef box on the page. Helvetica (WinAnsi) has periodcentered, so it
  // is strong-Latin: the dot switches font for itself alone and the Bangla either
  // side is untouched.
  if (cp === 0x00b7) return LATIN_FONT;
  return null; // spaces, digits, punctuation, bullets, dashes — keep with the current run
}

/** Split text into maximal same-font runs. Neutral chars stick to the current run;
 *  a leading neutral (e.g. a "•" bullet) defaults to Helvetica, which has the symbol. */
export function splitScriptRuns(text: string): Run[] {
  const runs: Run[] = [];
  for (const ch of text) {
    const strong = strongFont(ch.codePointAt(0) ?? 0);
    const last = runs[runs.length - 1];
    if (strong === null) {
      if (last) last.text += ch;
      else runs.push({ font: LATIN_FONT, text: ch });
    } else if (last && last.font === strong) {
      last.text += ch;
    } else {
      runs.push({ font: strong, text: ch });
    }
  }
  return runs;
}

/** Draw mixed Bengali/Latin text on one flow, switching fonts per run via `continued`.
 *  fontSize / fillColor set by the caller persist across the font switches. */
export function mixedText(
  doc: PDFKit.PDFDocument,
  text: string,
  opts: PDFKit.Mixins.TextOptions = {},
): void {
  const runs = splitScriptRuns(text);
  if (runs.length === 0) {
    doc.font(BENGALI_FONT).text(text, opts);
    return;
  }
  runs.forEach((run, idx) => {
    doc.font(run.font).text(run.text, { ...opts, continued: idx < runs.length - 1 });
  });
}

/** Draw mixed Bengali/Latin text inside a fixed box (x, y, width) — used for table
 *  cells. The first run is positioned absolutely; continued runs inherit the box and
 *  wrap within `width`. After the call, doc.y sits just below the cell's last line,
 *  so the caller can read the consumed height. */
export function mixedTextInBox(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  opts: PDFKit.Mixins.TextOptions = {},
): void {
  const runs = splitScriptRuns(text.length > 0 ? text : " ");
  runs.forEach((run, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === runs.length - 1;
    const cellOpts = { ...opts, width, continued: !isLast };
    if (isFirst) doc.font(run.font).text(run.text, x, y, cellOpts);
    else doc.font(run.font).text(run.text, cellOpts);
  });
}

interface RenderOptions {
  title?: string;
  /** Base-font multiplier (English Drive edit-before-print, D-#348). Default 1. */
  fontScale?: number;
  /** Line-gap + inter-block spacing multiplier. Default 1. */
  lineSpacing?: number;
  /** Page margin in points. Default 50. */
  margin?: number;
}

/** Resolved, clamped layout knobs. Absent options → the historical defaults, so
 *  every existing caller (artifact / set PDFs) renders byte-identically. */
export interface LayoutCfg {
  fontScale: number;
  lineSpacing: number;
  margin: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * Line gap for a block (D-#348). `ls` is a Google-Docs-style line-height multiple
 * (1.0 single / 1.15 / 1.5 / 2.0 double). At ls=1 the gap is the historical `base`
 * (so default renders are byte-identical); above 1 we ADD roughly one font-height
 * of lead per whole step, which is what makes "double" actually look double.
 */
const lineGapFor = (base: number, fontSize: number, ls: number): number =>
  base + fontSize * (ls - 1);

/** A per-block spacing directive on its own line: `{ls:1.5}` / `{ls:double}` /
 *  `{ls:reset}` (back to the document setting). Sets the line-height for the blocks
 *  that follow until the next directive. Stripped from the output. */
const LS_DIRECTIVE = /^\{ls:\s*([a-z0-9.]+)\s*\}$/i;
function parseLsDirective(raw: string, fallback: number): number {
  const v = raw.trim().toLowerCase();
  if (v === "reset") return fallback;
  if (v === "single") return 1;
  if (v === "double") return 2;
  const n = parseFloat(v);
  return Number.isFinite(n) ? clamp(n, 0.8, 3) : fallback;
}

export function resolveLayout(options: RenderOptions): LayoutCfg {
  return {
    fontScale: clamp(options.fontScale ?? 1, 0.75, 1.6),
    lineSpacing: clamp(options.lineSpacing ?? 1, 0.8, 2.5),
    margin: clamp(options.margin ?? 50, 25, 90),
  };
}

/** Convert rendered_markdown to a PDF Buffer. */
export async function markdownToPdf(
  markdownText: string,
  options: RenderOptions = {},
): Promise<Buffer> {
  const cfg = resolveLayout(options);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const doc = new PDFDocument({
      margin: cfg.margin,
      size: "A4",
      info: {
        Title: options.title ?? "Lesson Plan",
        Creator: "SCD Hub",
      },
    });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Bengali font for Bengali runs; Helvetica (built-in) is the Latin fallback.
    doc.registerFont(BENGALI_FONT, FONT_PATH);
    doc.font(BENGALI_FONT).fontSize(10 * cfg.fontScale);

    const tokens = md.parse(transliterateForPdf(stripUnsupportedGlyphs(stripHtmlComments(markdownText))), {});
    renderTokens(doc, tokens, cfg);

    doc.end();
  });
}

function renderTokens(doc: PDFKit.PDFDocument, tokens: Token[], cfg: LayoutCfg): void {
  const fs = cfg.fontScale;
  // Mutable — a `{ls:…}` directive can raise/lower the line-height mid-document.
  let ls = cfg.lineSpacing;
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === "heading_open") {
      const level = parseInt(token.tag.slice(1), 10);
      const inlineToken = tokens[i + 1];
      const text = inlineToken ? collectInlineText(inlineToken.children ?? []) : "";
      i += 2; // skip heading_close

      const fontSize = (level === 1 ? 18 : level === 2 ? 14 : 12) * fs;
      const moveDown = (level === 1 ? 0.5 : 0.3) * ls;
      doc.fontSize(fontSize);
      mixedText(doc, text, {});
      doc.moveDown(moveDown);
      i++;
      continue;
    }

    if (token.type === "paragraph_open") {
      const inlineToken = tokens[i + 1];
      const text = inlineToken ? collectInlineText(inlineToken.children ?? []) : "";
      i += 2; // skip paragraph_close
      // A standalone `{ls:…}` paragraph is a directive, not content — apply + skip.
      const dir = LS_DIRECTIVE.exec(text.trim());
      if (dir) {
        ls = parseLsDirective(dir[1], cfg.lineSpacing);
        i++;
        continue;
      }
      const size = 10 * fs;
      doc.fontSize(size);
      mixedText(doc, text, { lineGap: lineGapFor(2, size, ls) });
      doc.moveDown(0.3 * ls);
      i++;
      continue;
    }

    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      const closeType = token.type === "bullet_list_open" ? "bullet_list_close" : "ordered_list_close";
      let listNum = 1;
      i++;
      while (i < tokens.length && tokens[i].type !== closeType) {
        const t = tokens[i];
        if (t.type === "list_item_open") {
          i++;
          // gather inline text for this list item
          let itemText = "";
          while (i < tokens.length && tokens[i].type !== "list_item_close") {
            const it = tokens[i];
            if (it.type === "inline") itemText += collectInlineText(it.children ?? []);
            i++;
          }
          const bullet = token.type === "bullet_list_open" ? "•  " : `${listNum++}.  `;
          const size = 10 * fs;
          doc.fontSize(size);
          mixedText(doc, `${bullet}${itemText}`, { indent: 15, lineGap: lineGapFor(1, size, ls) });
          i++; // skip list_item_close
          continue;
        }
        i++;
      }
      doc.moveDown(0.3 * ls);
      i++; // skip list_close
      continue;
    }

    if (token.type === "hr") {
      doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke().moveDown(0.3 * ls);
      i++;
      continue;
    }

    if (token.type === "blockquote_open") {
      i++;
      while (i < tokens.length && tokens[i].type !== "blockquote_close") {
        const bt = tokens[i];
        if (bt.type === "inline") {
          const text = collectInlineText(bt.children ?? []);
          const size = 9 * fs;
          doc.fontSize(size).fillColor("#555555");
          mixedText(doc, text, { indent: 20, lineGap: lineGapFor(1, size, ls) });
          doc.fillColor("#000000");
        }
        i++;
      }
      doc.moveDown(0.3 * ls);
      i++; // skip blockquote_close
      continue;
    }

    if (token.type === "table_open") {
      const rows: TableRow[] = [];
      let inHead = false;
      i++;
      while (i < tokens.length && tokens[i].type !== "table_close") {
        const tt = tokens[i];
        if (tt.type === "thead_open") inHead = true;
        if (tt.type === "thead_close") inHead = false;
        if (tt.type === "tr_open") {
          const cells: string[] = [];
          const isHeader = inHead;
          i++;
          while (i < tokens.length && tokens[i].type !== "tr_close") {
            const cell = tokens[i];
            if (cell.type === "td_open" || cell.type === "th_open") {
              i++;
              if (i < tokens.length && tokens[i].type === "inline") {
                cells.push(collectInlineText(tokens[i].children ?? []));
                i++;
              } else {
                cells.push("");
              }
              i++; // skip td_close / th_close
              continue;
            }
            i++;
          }
          rows.push({ cells, isHeader });
          i++; // skip tr_close
          continue;
        }
        i++;
      }
      renderTable(doc, rows, cfg, ls);
      i++; // skip table_close
      continue;
    }

    i++;
  }
}

interface TableRow {
  cells: string[];
  isHeader: boolean;
}

/** Render a Markdown table as a real bordered grid: weighted column widths,
 *  per-row height measured from the actual cell draw, header rows shaded. This
 *  replaces the old `cells.join(" | ")` flow whose wrapping caused the columns to
 *  collide (the Chapter-Overview overlap). */
function renderTable(doc: PDFKit.PDFDocument, rows: TableRow[], cfg: LayoutCfg, ls: number): void {
  if (rows.length === 0) return;
  const nCols = Math.max(...rows.map((r) => r.cells.length));
  if (nCols === 0) return;

  const left = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const fontSize = 9 * cfg.fontScale;
  const padX = 4;
  const padY = 3 * ls;

  // Weighted columns: width ∝ the column's longest cell (clamped so a "#" column
  // stays slim and one verbose column can't starve the rest), normalised to fit.
  const weights: number[] = [];
  for (let c = 0; c < nCols; c++) {
    let maxLen = 1;
    for (const r of rows) maxLen = Math.max(maxLen, (r.cells[c] ?? "").length);
    weights.push(Math.min(40, Math.max(4, maxLen)));
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const colWidths = weights.map((w) => (w / weightSum) * tableWidth);
  const colX: number[] = [];
  let acc = left;
  for (let c = 0; c < nCols; c++) {
    colX.push(acc);
    acc += colWidths[c];
  }

  doc.fontSize(fontSize);

  for (const row of rows) {
    const cells: string[] = [];
    for (let c = 0; c < nCols; c++) cells.push(row.cells[c] ?? "");

    // Estimate the row height (Noto is the taller face) for the page-break check.
    let estHeight = 0;
    doc.font(BENGALI_FONT);
    for (let c = 0; c < nCols; c++) {
      const h = doc.heightOfString(cells[c].length > 0 ? cells[c] : " ", {
        width: colWidths[c] - 2 * padX,
        lineGap: lineGapFor(1, fontSize, ls),
      });
      estHeight = Math.max(estHeight, h);
    }
    if (doc.y + estHeight + 2 * padY > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }

    const rowTop = doc.y;
    let rowBottom = rowTop;
    for (let c = 0; c < nCols; c++) {
      mixedTextInBox(doc, cells[c], colX[c] + padX, rowTop + padY, colWidths[c] - 2 * padX, { lineGap: lineGapFor(1, fontSize, ls) });
      rowBottom = Math.max(rowBottom, doc.y);
    }
    rowBottom += padY;

    // Header shading drawn behind the (already-placed) text would cover it, so
    // shade as a thin tinted underline strip and use a heavier rule under headers.
    for (let c = 0; c < nCols; c++) {
      doc.rect(colX[c], rowTop, colWidths[c], rowBottom - rowTop).lineWidth(0.5).strokeColor("#999999").stroke();
    }
    if (row.isHeader) {
      doc
        .moveTo(left, rowBottom)
        .lineTo(left + tableWidth, rowBottom)
        .lineWidth(1.2)
        .strokeColor("#333333")
        .stroke();
    }
    doc.strokeColor("#000000").lineWidth(1);
    doc.y = rowBottom;
  }
  // Cells were positioned at absolute x; restore the left margin so the next block
  // (heading/paragraph) flows full-width instead of inside the last column.
  doc.x = left;
  doc.moveDown(0.5 * ls);
}

function collectInlineText(children: Token[]): string {
  return children.map((t) => {
    if (t.type === "softbreak" || t.type === "hardbreak") return "\n";
    return t.content ?? "";
  }).join("");
}

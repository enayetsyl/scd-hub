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

interface RenderOptions {
  title?: string;
}

/** Convert rendered_markdown to a PDF Buffer. */
export async function markdownToPdf(
  markdownText: string,
  options: RenderOptions = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const doc = new PDFDocument({
      margin: 50,
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
    doc.font(BENGALI_FONT).fontSize(10);

    const tokens = md.parse(markdownText, {});
    renderTokens(doc, tokens);

    doc.end();
  });
}

function renderTokens(doc: PDFKit.PDFDocument, tokens: Token[]): void {
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === "heading_open") {
      const level = parseInt(token.tag.slice(1), 10);
      const inlineToken = tokens[i + 1];
      const text = inlineToken ? collectInlineText(inlineToken.children ?? []) : "";
      i += 2; // skip heading_close

      const fontSize = level === 1 ? 18 : level === 2 ? 14 : 12;
      const moveDown = level === 1 ? 0.5 : 0.3;
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
      doc.fontSize(10);
      mixedText(doc, text, { lineGap: 2 });
      doc.moveDown(0.3);
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
          doc.fontSize(10);
          mixedText(doc, `${bullet}${itemText}`, { indent: 15, lineGap: 1 });
          i++; // skip list_item_close
          continue;
        }
        i++;
      }
      doc.moveDown(0.3);
      i++; // skip list_close
      continue;
    }

    if (token.type === "hr") {
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke().moveDown(0.3);
      i++;
      continue;
    }

    if (token.type === "blockquote_open") {
      i++;
      while (i < tokens.length && tokens[i].type !== "blockquote_close") {
        const bt = tokens[i];
        if (bt.type === "inline") {
          const text = collectInlineText(bt.children ?? []);
          doc.fontSize(9).fillColor("#555555");
          mixedText(doc, text, { indent: 20, lineGap: 1 });
          doc.fillColor("#000000");
        }
        i++;
      }
      doc.moveDown(0.3);
      i++; // skip blockquote_close
      continue;
    }

    if (token.type === "table_open") {
      // Simple table: collect header + rows as plain text lines
      const rows: string[][] = [];
      let inHead = false;
      i++;
      while (i < tokens.length && tokens[i].type !== "table_close") {
        const tt = tokens[i];
        if (tt.type === "thead_open") { inHead = true; }
        if (tt.type === "thead_close") { inHead = false; }
        if (tt.type === "tr_open") {
          const row: string[] = [];
          i++;
          while (i < tokens.length && tokens[i].type !== "tr_close") {
            const cell = tokens[i];
            if (cell.type === "td_open" || cell.type === "th_open") {
              i++;
              if (i < tokens.length && tokens[i].type === "inline") {
                row.push(collectInlineText(tokens[i].children ?? []));
                i++;
              }
              i++; // skip td_close / th_close
              continue;
            }
            i++;
          }
          rows.push(row);
          doc.fontSize(9);
          mixedText(doc, row.join("  |  "), { lineGap: 1 });
          if (inHead && rows.length === 1) {
            doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
          }
          i++; // skip tr_close
          continue;
        }
        i++;
      }
      doc.moveDown(0.5);
      i++; // skip table_close
      continue;
    }

    i++;
  }
}

function collectInlineText(children: Token[]): string {
  return children.map((t) => {
    if (t.type === "softbreak" || t.type === "hardbreak") return "\n";
    return t.content ?? "";
  }).join("");
}

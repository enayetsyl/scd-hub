/**
 * Server-side Markdown→PDF renderer (ADR-009, J1.8).
 *
 * Uses pdfkit with NotoSansBengali-Regular.ttf bundled in server/assets/fonts/.
 * NotoSansBengali covers both Bengali (U+0980–U+09FF) and Basic Latin, so a single
 * font handles all content in these plans (Bengali + English mixed).
 *
 * The rendered_markdown stored in ContentArtifact is the only input — the payload
 * JSON is never consulted here (R-C3/ADR-006).
 */
import PDFDocument from "pdfkit";
import MarkdownIt from "markdown-it";
import * as path from "path";
import type { Token } from "markdown-it";

const FONT_PATH = path.resolve(__dirname, "../../assets/fonts/NotoSansBengali-Regular.ttf");

const md = new MarkdownIt({ html: false, linkify: false });

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

    // Register Noto Sans Bengali as the font for all text (covers both scripts)
    doc.registerFont("NotoSansBengali", FONT_PATH);
    doc.font("NotoSansBengali");

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
      doc
        .fontSize(fontSize)
        .font("NotoSansBengali")
        .text(text, { align: level === 1 ? "left" : "left" })
        .moveDown(moveDown);
      i++;
      continue;
    }

    if (token.type === "paragraph_open") {
      const inlineToken = tokens[i + 1];
      const text = inlineToken ? collectInlineText(inlineToken.children ?? []) : "";
      i += 2; // skip paragraph_close
      doc.fontSize(10).font("NotoSansBengali").text(text, { align: "left", lineGap: 2 }).moveDown(0.3);
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
          doc.fontSize(10).font("NotoSansBengali").text(`${bullet}${itemText}`, { indent: 15, lineGap: 1 });
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
          doc.fontSize(9).font("NotoSansBengali").fillColor("#555555").text(text, { indent: 20, lineGap: 1 });
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
          if (inHead && rows.length === 1) {
            // Bold-ish header row with larger font
            doc.fontSize(9).font("NotoSansBengali").text(row.join("  |  "), { lineGap: 1 });
            doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
          } else {
            doc.fontSize(9).font("NotoSansBengali").text(row.join("  |  "), { lineGap: 1 });
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

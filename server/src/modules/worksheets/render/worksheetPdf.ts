/**
 * Worksheet → A4 PDF (D-#747). Draws the SAME WorksheetDoc the app previews, in the
 * look of the Mohammadpur Nursery papers: boxed grids, picture cards with an answer
 * box, two-column matching, `[marks]` at the right of every question.
 *
 * `answers: true` prints the teacher's key: identical layout, the blanks filled in
 * dark red, "উত্তরপত্র" in the header — so a teacher marks against the very sheet.
 *
 * Fonts: the bundled Noto Bengali subset has no Latin, so every string goes through
 * the shared script splitter (Bangla → Noto, Latin/digits → Helvetica).
 */
import PDFDocument from "pdfkit";
import * as path from "path";
import { BENGALI_FONT, splitScriptRuns } from "../../../routes/pdfRenderer";
import type { Cell, Section, WorksheetDoc } from "../engine/types";
import { bnNumber } from "../engine/sequences";

const FONT_PATH = path.resolve(__dirname, "../../../../assets/fonts/NotoSansBengali-Regular.ttf");

export interface WorksheetHeader {
  /** "স্কুল ফর কমিউনিটি ডেভেলপমেন্ট" / "School for Community Development". */
  school: string;
  /** "সাপ্তাহিক অ্যাসাইনমেন্ট", "ক্লাস টেস্ট — ৩", "বার্ষিক পরীক্ষা — ২০২৬". */
  title: string;
  subtitle?: string | null;
  /** "শ্রেণি: নার্সারি · বিষয়: বাংলা". */
  classLine: string;
  /** Left of the marks line: time / due date. */
  meta?: string | null;
  /** "পূর্ণমান: ১০০". */
  fullMarks: string;
  /** "নাম" / "Name" etc. */
  nameLabel: string;
  idLabel: string;
  english: boolean;
}

export interface PictureBytes {
  get(id: string): Buffer | undefined;
}

const INK = "#111111";
const ANSWER = "#9B1C1C";
const LINE = "#222222";
type Ruling = "BAN" | "ENG";
/** Guide lines per copybook, as [fraction of box height, colour]. Bangla: মাত্রা + base
 *  line. English khata (owner 2026-10-16 photo): red, blue, blue, red, evenly spaced. */
const GUIDES: Record<Ruling, Array<[number, string]>> = {
  BAN: [[0.34, "#8FA3BF"], [0.74, "#8FA3BF"]],
  ENG: [[0.2, "#E07A7A"], [0.4, "#7F9BD6"], [0.6, "#7F9BD6"], [0.8, "#E07A7A"]],
};

const MARGIN = 40;

type Doc = PDFKit.PDFDocument;

/** Draw a one-line string centred in a box, switching fonts per script run. */
function centered(doc: Doc, text: string, x: number, y: number, w: number, h: number, size: number, color = INK): void {
  if (!text) return;
  doc.fontSize(size).fillColor(color);
  const runs = splitScriptRuns(text);
  let width = 0;
  for (const r of runs) width += doc.font(r.font).widthOfString(r.text);
  let cx = x + Math.max(0, (w - width) / 2);
  const cy = y + (h - size * 1.25) / 2;
  for (const r of runs) {
    doc.font(r.font).text(r.text, cx, cy, { lineBreak: false });
    cx += doc.font(r.font).widthOfString(r.text);
  }
}

/** Left-aligned one-liner (labels, header lines). Returns the drawn width. */
function line(doc: Doc, text: string, x: number, y: number, size: number, color = INK): number {
  doc.fontSize(size).fillColor(color);
  let cx = x;
  for (const r of splitScriptRuns(text)) {
    doc.font(r.font).text(r.text, cx, y, { lineBreak: false });
    cx += doc.font(r.font).widthOfString(r.text);
  }
  return cx - x;
}

function textWidth(doc: Doc, text: string, size: number): number {
  doc.fontSize(size);
  return splitScriptRuns(text).reduce((w, r) => w + doc.font(r.font).widthOfString(r.text), 0);
}

function box(doc: Doc, x: number, y: number, w: number, h: number): void {
  doc.lineWidth(0.8).strokeColor(LINE).rect(x, y, w, h).stroke();
}

/** A box a child writes in. Bangla papers get two faint handwriting guide lines inside
 *  (the মাত্রা line and the base line, as on a ruled Bangla copy — owner 2026-10-16). */
function writeBox(doc: Doc, x: number, y: number, w: number, h: number, ruled: boolean, ruling: Ruling = "BAN"): void {
  box(doc, x, y, w, h);
  if (!ruled) return;
  doc.save().lineWidth(0.6);
  for (const [f, colour] of GUIDES[ruling]) {
    doc.strokeColor(colour).moveTo(x + 2, y + h * f).lineTo(x + w - 2, y + h * f).stroke();
  }
  doc.restore();
}

function cellText(c: Cell, answers: boolean): { text: string; color: string } {
  if (c.t) return { text: c.t, color: INK };
  return answers && c.a ? { text: c.a, color: ANSWER } : { text: "", color: INK };
}

// ---------------------------------------------------------------------------

export async function renderWorksheetPdf(
  wsDoc: WorksheetDoc,
  header: WorksheetHeader,
  pictures: PictureBytes,
  opts: { answers?: boolean } = {},
): Promise<Buffer> {
  const answers = !!opts.answers;
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont(BENGALI_FONT, FONT_PATH);

    const W = doc.page.width - 2 * MARGIN;
    const bottom = () => doc.page.height - MARGIN;
    let y = MARGIN;
    const num = (n: number): string => (header.english ? String(n) : bnNumber(n));
    const ensure = (h: number): void => {
      if (y + h > bottom()) {
        doc.addPage();
        y = MARGIN;
      }
    };

    // ---- Header ----------------------------------------------------------
    centered(doc, header.school, MARGIN, y, W, 20, 15);
    y += 21;
    centered(doc, answers ? `${header.title} — ${header.english ? "Answer key" : "উত্তরপত্র"}` : header.title, MARGIN, y, W, 18, 12.5);
    y += 18;
    if (header.subtitle) {
      centered(doc, header.subtitle, MARGIN, y, W, 16, 11);
      y += 16;
    }
    centered(doc, header.classLine, MARGIN, y, W, 16, 11.5);
    y += 22;
    if (header.meta) line(doc, header.meta, MARGIN, y, 10.5);
    const fm = header.fullMarks;
    line(doc, fm, MARGIN + W - textWidth(doc, fm, 10.5), y, 10.5);
    y += 20;
    if (!answers) {
      line(doc, `${header.nameLabel}: ________________________________`, MARGIN, y, 10.5);
      const idText = `${header.idLabel}: ______________`;
      line(doc, idText, MARGIN + W - textWidth(doc, idText, 10.5), y, 10.5);
      y += 18;
    }
    doc.moveTo(MARGIN, y).lineTo(MARGIN + W, y).lineWidth(0.6).strokeColor("#888888").stroke();
    y += 10;

    // ---- Sections --------------------------------------------------------
    for (const s of wsDoc.sections) {
      const bodyH = estimateHeight(s);
      ensure(Math.min(bodyH + 34, bottom() - MARGIN));
      const title = `${num(s.n)}. ${s.label}`;
      line(doc, title, MARGIN, y, 11.5);
      const mk = `[${num(s.marks)}]`;
      line(doc, mk, MARGIN + W - textWidth(doc, mk, 11.5), y, 11.5);
      y += 17;
      if (s.note) {
        line(doc, `(${s.note})`, MARGIN + 14, y, 9.5, "#444444");
        y += 14;
      }
      y += 3;
      y = drawBody(doc, s, y, W, answers, pictures, !!wsDoc.ruled, wsDoc.ruling ?? "BAN") + 12;
    }

    doc.end();
  });
}

function estimateHeight(s: Section): number {
  switch (s.layout) {
    case "grid":
      return Math.ceil((s.cells?.length ?? 0) / (s.cols ?? 10)) * 28;
    case "groups":
      return (s.groups ?? []).reduce((h, g) => h + 26 + Math.ceil(g.cells.length / g.cols) * 36, 0);
    case "columns":
      return Math.max(0, ...(s.columns ?? []).map((c) => c.length)) * 40;
    case "jumble":
      return (s.sets?.length ?? 0) * 76;
    case "rows":
      return Math.ceil((s.rows?.length ?? 0) / 2) * 30;
    case "pictures": {
      const counting = (s.pictures ?? []).some((p) => p.repeat > 1);
      const per = counting ? 2 : 5;
      return Math.ceil((s.pictures?.length ?? 0) / per) * (counting ? 74 : 96);
    }
    case "match":
      return Math.ceil((s.left?.length ?? 0) / 2) * 50;
    case "manual":
      return (s.lines ?? 2) * 22;
    default:
      return 0;
  }
}

/** Draws one section body starting at `y`; returns the y after it. `ensure` may page-break. */
function drawBody(
  doc: Doc,
  s: Section,
  y0: number,
  W: number,
  answers: boolean,
  pictures: PictureBytes,
  ruled: boolean,
  ruling: Ruling,
): number {
  let y = y0;
  const pageBottom = doc.page.height - MARGIN;
  const breakIfNeeded = (h: number): void => {
    if (y + h > pageBottom) {
      doc.addPage();
      y = MARGIN;
    }
  };

  switch (s.layout) {
    case "grid": {
      const cols = s.cols ?? 10;
      const cw = W / cols;
      const ch = ruled ? (ruling === "ENG" ? 42 : 36) : 28;
      (s.cells ?? []).forEach((c, i) => {
        const col = i % cols;
        if (col === 0 && i > 0) y += ch;
        if (col === 0) breakIfNeeded(ch);
        const x = MARGIN + col * cw;
        writeBox(doc, x, y, cw, ch, ruled && !c.t, ruling);
        const { text, color } = cellText(c, answers);
        centered(doc, text, x, y, cw, ch, 14, color);
      });
      return y + ((s.cells ?? []).length ? ch : 0);
    }

    case "groups": {
      // Sub-questions under one number — ক) স্বরবর্ণ, খ) ব্যঞ্জনবর্ণ (owner 2026-10-16).
      const ch = ruled ? (ruling === "ENG" ? 42 : 36) : 28;
      for (const g of s.groups ?? []) {
        breakIfNeeded(18 + ch);
        const lw = line(doc, g.label, MARGIN + 6, y, 11);
        if (g.note) line(doc, `  (${g.note})`, MARGIN + 6 + lw, y + 1, 9.5, "#444444");
        y += 16;
        const cw = W / g.cols;
        g.cells.forEach((c, i) => {
          const col = i % g.cols;
          if (col === 0 && i > 0) y += ch;
          if (col === 0) breakIfNeeded(ch);
          const x = MARGIN + col * cw;
          writeBox(doc, x, y, cw, ch, ruled && !c.t, ruling);
          const { text, color } = cellText(c, answers);
          centered(doc, text, x, y, cw, ch, 14, color);
        });
        y += (g.cells.length ? ch : 0) + 10;
      }
      return y - 10;
    }

    case "jumble": {
      // Owner 2026-10-16: one line per set, the boxes spread across the full page width.
      const topH = 28;
      const ansH = ruled ? (ruling === "ENG" ? 44 : 38) : 30;
      for (const set of s.sets ?? []) {
        breakIfNeeded(topH + ansH + 4);
        const cw = W / set.shown.length;
        set.shown.forEach((t, i) => {
          const x = MARGIN + i * cw;
          box(doc, x, y, cw, topH);
          centered(doc, t, x, y, cw, topH, 15);
          writeBox(doc, x, y + topH, cw, ansH, ruled, ruling);
          if (answers) centered(doc, set.answer[i], x, y + topH, cw, ansH, 14, ANSWER);
        });
        y += topH + ansH + 10;
      }
      return y - 10;
    }

    case "rows": {
      const items = s.rows ?? [];
      const colW = W / 2;
      const cell = ruled ? (ruling === "ENG" ? 42 : 36) : 30;
      items.forEach((row, i) => {
        const col = i % 2;
        if (col === 0 && i > 0) y += cell + 4;
        if (col === 0) breakIfNeeded(cell);
        let x = MARGIN + col * colW + 10;
        for (const c of row) {
          writeBox(doc, x, y, 48, cell, ruled && !c.t, ruling);
          const { text, color } = cellText(c, answers);
          centered(doc, text, x, y, 48, cell, 14, color);
          x += 56;
        }
      });
      return y + (items.length ? cell : 0);
    }

    case "columns": {
      // Before/after: column by column, top to bottom, in the order the teacher set.
      const cols = s.columns ?? [];
      const colW = W / Math.max(1, cols.length);
      const cell = ruled ? (ruling === "ENG" ? 42 : 36) : 30;
      const depth = Math.max(0, ...cols.map((c) => c.length));
      for (let r = 0; r < depth; r++) {
        breakIfNeeded(cell);
        cols.forEach((col, k) => {
          const row = col[r];
          if (!row) return;
          let x = MARGIN + k * colW + 10;
          for (const c of row) {
            writeBox(doc, x, y, 48, cell, ruled && !c.t, ruling);
            const { text, color } = cellText(c, answers);
            centered(doc, text, x, y, 48, cell, 14, color);
            x += 56;
          }
        });
        y += cell + 4;
      }
      return y - (depth ? 4 : 0);
    }

    case "pictures": {
      const items = s.pictures ?? [];
      const counting = items.some((p) => p.repeat > 1);
      if (counting) {
        const colW = (W - 12) / 2;
        const h = 66;
        items.forEach((p, i) => {
          const col = i % 2;
          if (col === 0 && i > 0) y += h + 8;
          if (col === 0) breakIfNeeded(h);
          const x = MARGIN + col * (colW + 12);
          box(doc, x, y, colW, h);
          const img = pictures.get(p.pictureId);
          const icon = 24;
          const perRow = Math.floor((colW - 60) / (icon + 3));
          for (let k = 0; k < p.repeat; k++) {
            const ix = x + 6 + (k % perRow) * (icon + 3);
            const iy = y + 6 + Math.floor(k / perRow) * (icon + 3);
            if (img && iy + icon <= y + h) doc.image(img, ix, iy, { fit: [icon, icon], align: "center", valign: "center" });
          }
          writeBox(doc, x + colW - 46, y + (h - 34) / 2, 38, 34, ruled, ruling);
          if (answers) centered(doc, p.a, x + colW - 46, y + (h - 34) / 2, 38, 34, 14, ANSWER);
        });
        return y + (items.length ? h : 0);
      }
      const cols = 5;
      const gap = 8;
      const cw = (W - gap * (cols - 1)) / cols;
      const h = 88;
      items.forEach((p, i) => {
        const col = i % cols;
        if (col === 0 && i > 0) y += h + gap;
        if (col === 0) breakIfNeeded(h);
        const x = MARGIN + col * (cw + gap);
        box(doc, x, y, cw, h);
        const img = pictures.get(p.pictureId);
        if (img) doc.image(img, x + 4, y + 4, { fit: [cw - 8, h - 42], align: "center", valign: "center" });
        const bx = x + (cw - 32) / 2;
        writeBox(doc, bx, y + h - 36, 32, 30, ruled, ruling);
        if (answers) centered(doc, p.a, bx, y + h - 36, 32, 30, 14, ANSWER);
      });
      return y + (items.length ? h : 0);
    }

    case "match": {
      const left = s.left ?? [];
      const right = s.right ?? [];
      const colW = (W - 20) / 2;
      const h = 44;
      left.forEach((l, i) => {
        const col = i % 2;
        if (col === 0 && i > 0) y += h + 4;
        if (col === 0) breakIfNeeded(h);
        const x = MARGIN + col * (colW + 20);
        const picW = colW * 0.42;
        const ansW = 54;
        box(doc, x, y, picW, h);
        const img = l.pictureId ? pictures.get(l.pictureId) : undefined;
        if (img && l.repeat > 1) {
          const icon = 14;
          const perRow = Math.max(1, Math.floor((picW - 6) / (icon + 2)));
          for (let k = 0; k < l.repeat; k++) {
            const ix = x + 3 + (k % perRow) * (icon + 2);
            const iy = y + 3 + Math.floor(k / perRow) * (icon + 2);
            if (iy + icon <= y + h) doc.image(img, ix, iy, { fit: [icon, icon] });
          }
        } else if (img) {
          doc.image(img, x + 3, y + 3, { fit: [picW - 6, h - 6], align: "center", valign: "center" });
        } else if (l.t) {
          centered(doc, l.t, x, y, picW, h, 14);
        }
        if (answers && s.answer) {
          const a = right[s.answer[i]];
          // No arrow glyph in either embedded font — the answer alone, in the gap the line goes.
          centered(doc, a ?? "", x + picW, y, colW - picW - ansW, h, 13, ANSWER);
        } else {
          // the dot the child draws the line from
          doc.circle(x + picW + 8, y + h / 2, 2).fill(INK);
          doc.circle(x + colW - ansW - 8, y + h / 2, 2).fill(INK);
        }
        box(doc, x + colW - ansW, y, ansW, h);
        centered(doc, right[i] ?? "", x + colW - ansW, y, ansW, h, right[i] && right[i].length > 3 ? 12 : 16);
      });
      return y + (left.length ? h : 0);
    }

    case "manual": {
      const n = s.lines ?? 2;
      for (let i = 0; i < n; i++) {
        breakIfNeeded(22);
        y += 20;
        doc.moveTo(MARGIN + 14, y).lineTo(MARGIN + W, y).lineWidth(0.5).strokeColor("#777777").stroke();
      }
      return y;
    }

    case "oral":
    default:
      return y - 3;
  }
}


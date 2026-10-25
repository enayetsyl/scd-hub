/**
 * Worksheet → A4 PDF (D-#747). Draws the SAME WorksheetDoc the app previews, in the
 * look of the Mohammadpur Nursery papers: boxed grids, picture cards with an answer
 * box, two-column matching, `[marks]` at the right of every question.
 *
 * `answers: true` prints the teacher's key: identical layout, the blanks filled in
 * dark red, "উত্তরপত্র" in the header — so a teacher marks against the very sheet.
 *
 * Fonts: the bundled Noto Bengali subset has no Latin, so every string goes through
 * the shared script splitter (Bangla → Noto, Latin/digits → Helvetica), and Arabic runs
 * go to Noto Naskh Arabic (D-#802). fontkit shapes and orders ONE Arabic word correctly,
 * but pdfkit lays several words out left to right, so an Arabic run is drawn word by
 * word from the right. An Arabic paper (`dir: "rtl"`) also mirrors its cell layouts.
 */
import PDFDocument from "pdfkit";
import * as path from "path";
import { BENGALI_FONT, splitScriptRuns } from "../../../routes/pdfRenderer";
import type { Cell, Choice, PromptItem, PromptLine, Section, WorksheetDoc } from "../engine/types";
import { bnNumber } from "../engine/sequences";
import { withMarkBases } from "./markBase";

const FONT_PATH = path.resolve(__dirname, "../../../../assets/fonts/NotoSansBengali-Regular.ttf");
const ARABIC_FONT = "NotoNaskhArabic";
const ARABIC_FONT_PATH = path.resolve(__dirname, "../../../../assets/fonts/NotoNaskhArabic-Regular.ttf");
/** Naskh reads small next to Noto Bengali at the same point size. */
const ARABIC_SCALE = 1.2;

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
/** One centimetre in PDF points — the guide lines are measured like a real copybook. */
const CM = 72 / 2.54;
/** Guide lines per copybook, as [offset from the first line, colour] — owner 2026-10-16:
 *  Bangla two lines 0.8 cm apart (মাত্রা + base line); English khata four lines, red /
 *  blue / blue / red, 0.4 cm apart, 1.2 cm from the first to the fourth. */
const GUIDES: Record<Ruling, Array<[number, string]>> = {
  BAN: [[0, "#8FA3BF"], [0.8 * CM, "#8FA3BF"]],
  ENG: [[0, "#E07A7A"], [0.4 * CM, "#7F9BD6"], [0.8 * CM, "#7F9BD6"], [1.2 * CM, "#E07A7A"]],
};
/** A ruled writing box tall enough to hold its guides with room above and below. */
const ruledHeight = (ruling: Ruling): number => (ruling === "ENG" ? 1.8 * CM : 1.4 * CM);

const MARGIN = 40;

type Doc = PDFKit.PDFDocument;

/** Script runs, keeping markBase's leading no-break space WITH the Bengali mark after it —
 *  shaped apart, the mark gets its dotted circle back. */
interface Run {
  font: string;
  text: string;
}

const isArabicCp = (cp: number): boolean =>
  (cp >= 0x0600 && cp <= 0x06ff) ||
  (cp >= 0x0750 && cp <= 0x077f) ||
  (cp >= 0x08a0 && cp <= 0x08ff) ||
  (cp >= 0xfb50 && cp <= 0xfdff) ||
  (cp >= 0xfe70 && cp <= 0xfeff);

function runsOf(text: string): Run[] {
  let runs: Run[] = splitScriptRuns(text);
  if (runs.length > 1 && runs[0].text === "\u00A0" && runs[1].font === BENGALI_FONT) {
    runs = [{ font: BENGALI_FONT, text: runs[0].text + runs[1].text }, ...runs.slice(2)];
  }
  // Arabic has no strong font in the shared splitter: cut it out into runs of its own, keeping
  // the spaces between Arabic words inside the run (they are the gaps drawWords lays out).
  const out: Run[] = [];
  for (const r of runs) {
    for (const ch of r.text) {
      const last = out[out.length - 1];
      const font = isArabicCp(ch.codePointAt(0) ?? 0) || (ch === " " && last?.font === ARABIC_FONT) ? ARABIC_FONT : r.font;
      if (last && last.font === font) last.text += ch;
      else out.push({ font, text: ch });
    }
  }
  return out;
}

/** An Arabic run as words and the spaces between them, in reading order. */
const arabicTokens = (text: string): string[] => text.split(/( +)/).filter((t) => t.length > 0);

function runWidth(doc: Doc, r: Run, size: number): number {
  if (r.font !== ARABIC_FONT) return doc.font(r.font).fontSize(size).widthOfString(r.text);
  doc.font(ARABIC_FONT).fontSize(size * ARABIC_SCALE);
  return arabicTokens(r.text).reduce((w, t) => w + doc.widthOfString(t), 0);
}

/** Draws one run with its left edge at `x`; an Arabic run word by word from the right. */
function drawRun(doc: Doc, r: Run, x: number, y: number, size: number): void {
  if (r.font !== ARABIC_FONT) {
    doc.font(r.font).fontSize(size).text(r.text, x, y, { lineBreak: false });
    return;
  }
  const s = size * ARABIC_SCALE;
  doc.font(ARABIC_FONT).fontSize(s);
  // Naskh sits lower in its line box than Noto Bengali: lift it to share the baseline area.
  const ay = y - (s - size) * 0.75;
  let cx = x + runWidth(doc, r, size);
  for (const t of arabicTokens(r.text)) {
    const w = doc.widthOfString(t);
    cx -= w;
    if (t.trim()) doc.text(t, cx, ay, { lineBreak: false });
  }
}

/** Draw a one-line string centred in a box, switching fonts per script run. */
function centered(doc: Doc, text: string, x: number, y: number, w: number, h: number, size: number, color = INK): void {
  if (!text) return;
  doc.fillColor(color);
  const runs = runsOf(text);
  const width = runs.reduce((s, r) => s + runWidth(doc, r, size), 0);
  let cx = x + Math.max(0, (w - width) / 2);
  const cy = y + (h - size * 1.25) / 2;
  for (const r of runs) {
    drawRun(doc, r, cx, cy, size);
    cx += runWidth(doc, r, size);
  }
  doc.fontSize(size);
}

/** Left-aligned one-liner (labels, header lines). Returns the drawn width. */
function line(doc: Doc, text: string, x: number, y: number, size: number, color = INK): number {
  doc.fillColor(color);
  let cx = x;
  for (const r of runsOf(text)) {
    drawRun(doc, r, cx, y, size);
    cx += runWidth(doc, r, size);
  }
  doc.fontSize(size);
  return cx - x;
}

function textWidth(doc: Doc, text: string, size: number): number {
  const w = runsOf(text).reduce((s, r) => s + runWidth(doc, r, size), 0);
  doc.fontSize(size);
  return w;
}

function box(doc: Doc, x: number, y: number, w: number, h: number): void {
  doc.lineWidth(0.8).strokeColor(LINE).rect(x, y, w, h).stroke();
}

/** A box a child writes in. Bangla papers get two faint handwriting guide lines inside
 *  (the মাত্রা line and the base line, as on a ruled Bangla copy — owner 2026-10-16). */
function writeBox(doc: Doc, x: number, y: number, w: number, h: number, ruled: boolean, ruling: Ruling = "BAN"): void {
  box(doc, x, y, w, h);
  if (!ruled) return;
  const guides = GUIDES[ruling];
  const top = y + (h - guides[guides.length - 1][0]) / 2; // centred in the box
  doc.save().lineWidth(0.6);
  for (const [off, colour] of guides) {
    doc.strokeColor(colour).moveTo(x + 2, top + off).lineTo(x + w - 2, top + off).stroke();
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
  wsDoc = withMarkBases(wsDoc);
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont(BENGALI_FONT, FONT_PATH);
    doc.registerFont(ARABIC_FONT, ARABIC_FONT_PATH);

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
      // A short question stays on one page. A long one starts wherever its title and first
      // line fit and runs on to the next page — every layout breaks between its own rows.
      // (Teacher feedback 2026-10-25: a whole question jumping pages left half a page empty.)
      const bodyH = estimateHeight(s);
      const need = bodyH <= KEEP_WHOLE ? bodyH + 34 : 34 + firstRowHeight(s);
      ensure(Math.min(need, bottom() - MARGIN));
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
      y = drawBody(doc, s, y, W, answers, pictures, !!wsDoc.ruled, wsDoc.ruling ?? "BAN", wsDoc.dir === "rtl") + 12;
    }

    doc.end();
  });
}

const CHOICE_H = 58;
/** Letter choices sit two to a line; word choices (four words) need the whole width. */
const choicesPerLine = (cs: Choice[]): number => (cs.some((c) => c.options.some((o) => [...o].length > 2)) ? 1 : 2);

const OPERATORS: ReadonlySet<string> = new Set(["×", "=", "+", "-"]);
/** Two items a line (a five-cell times-table line fits in half the page with compact cells). */
const rowsPerLine = (_rows: Cell[][]): number => 2;
const VERTICAL_H = 84;
const PROMPT_LABEL_W = 64;
const BOXES_PER_ROW = 6;

/** Rows of boxes a prompt line needs (a wide box is one row). */
const boxRows = (ln: PromptLine): number => (ln.wide ? 1 : Math.max(1, Math.ceil(ln.blanks / BOXES_PER_ROW)));

function promptItemHeight(it: PromptItem, h: number): number {
  if (it.sentence) return 26;
  const body = it.lines.reduce((s, ln) => s + boxRows(ln) * (h + 4), 0);
  if (it.lines.length === 1) return Math.max(body, h + 4 + (it.tall ? 24 : 0)) + 4;
  return 18 + body + 4;
}

/** A question this short (PDF points) is never split across pages. */
const KEEP_WHOLE = 180;

/** Room for a question's first line of items — what must fit under its title on a page. */
function firstRowHeight(s: Section): number {
  switch (s.layout) {
    case "pictures":
      return (s.pictures ?? []).some((p) => p.repeat > 1) ? 74 : 112;
    case "jumble":
      return 80;
    case "groups":
      return 70;
    case "choice":
      return CHOICE_H + 6;
    default:
      return 56;
  }
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
      return s.wide ? (s.rows?.length ?? 0) * 38 : Math.ceil((s.rows?.length ?? 0) / rowsPerLine(s.rows ?? [])) * 34;
    case "prompts":
      return (s.items ?? []).reduce((h, it) => h + promptItemHeight(it, 30), 0);
    case "vertical":
      return Math.ceil((s.sums?.length ?? 0) / 5) * VERTICAL_H;
    case "choice":
      return Math.ceil((s.choices?.length ?? 0) / choicesPerLine(s.choices ?? [])) * CHOICE_H;
    case "pictures": {
      if (s.wide) return Math.ceil((s.pictures?.length ?? 0) / 3) * 112;
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
  rtl = false,
): number {
  let y = y0;
  const pageBottom = doc.page.height - MARGIN;
  /** x of a box `w` wide laid out left to right at `x` — mirrored on a right-to-left paper. */
  const mx = (x: number, w: number): number => (rtl ? 2 * MARGIN + W - x - w : x);
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
      const ch = ruled ? ruledHeight(ruling) : 28;
      (s.cells ?? []).forEach((c, i) => {
        const col = i % cols;
        if (col === 0 && i > 0) y += ch;
        if (col === 0) breakIfNeeded(ch);
        const x = mx(MARGIN + col * cw, cw);
        writeBox(doc, x, y, cw, ch, ruled && !c.t, ruling);
        const { text, color } = cellText(c, answers);
        centered(doc, text, x, y, cw, ch, 14, color);
      });
      return y + ((s.cells ?? []).length ? ch : 0);
    }

    case "groups": {
      // Sub-questions under one number — ক) স্বরবর্ণ, খ) ব্যঞ্জনবর্ণ (owner 2026-10-16).
      const ch = ruled ? ruledHeight(ruling) : 28;
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
          const x = mx(MARGIN + col * cw, cw);
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
      const ansH = ruled ? ruledHeight(ruling) : 30;
      for (const set of s.sets ?? []) {
        breakIfNeeded(topH + ansH + 4 + (set.label ? 16 : 0));
        if (set.label) {
          line(doc, set.label, MARGIN + 4, y, 10.5, "#333333");
          y += 16;
        }
        const cw = W / set.shown.length;
        set.shown.forEach((t, i) => {
          const x = mx(MARGIN + i * cw, cw);
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
      const cell = ruled ? ruledHeight(ruling) : 30;
      if (s.wide) {
        // A word and its answer: one item per line, a wide box for the written word/letters.
        const h = Math.max(cell, 34);
        const promptW = W * 0.36;
        items.forEach((row, i) => {
          if (i > 0) y += h + 4;
          breakIfNeeded(h);
          let x = MARGIN;
          row.forEach((c, k) => {
            const w = k === 0 ? promptW : W - promptW - 10;
            writeBox(doc, mx(x, w), y, w, h, ruled && !c.t, ruling);
            const { text, color } = cellText(c, answers);
            centered(doc, text, mx(x, w), y, w, h, 15, color);
            x += w + 10;
          });
        });
        return y + (items.length ? h : 0);
      }
      const perLine = rowsPerLine(items);
      const colW = W / perLine;
      items.forEach((row, i) => {
        const col = i % perLine;
        if (col === 0 && i > 0) y += cell + 4;
        if (col === 0) breakIfNeeded(cell);
        let x = MARGIN + col * colW + 10;
        const compact = row.length > 3;
        for (const c of row) {
          // the operators between the boxes print bare, as on the 2025 KG paper's table grid
          const op = OPERATORS.has(c.t);
          const cw = op ? 18 : compact ? 40 : 48;
          if (!op) writeBox(doc, mx(x, cw), y, cw, cell, ruled && !c.t, ruling);
          const { text, color } = cellText(c, answers);
          centered(doc, text, mx(x, cw), y, cw, cell, 14, color);
          x += cw + (compact ? 5 : 8);
        }
      });
      return y + (items.length ? cell : 0);
    }

    case "columns": {
      // Before/after: column by column, top to bottom, in the order the teacher set.
      const cols = s.columns ?? [];
      const colW = W / Math.max(1, cols.length);
      const cell = ruled ? ruledHeight(ruling) : 30;
      const depth = Math.max(0, ...cols.map((c) => c.length));
      for (let r = 0; r < depth; r++) {
        breakIfNeeded(cell);
        cols.forEach((col, k) => {
          const row = col[r];
          if (!row) return;
          let x = MARGIN + k * colW + 10;
          for (const c of row) {
            writeBox(doc, mx(x, 48), y, 48, cell, ruled && !c.t, ruling);
            const { text, color } = cellText(c, answers);
            centered(doc, text, mx(x, 48), y, 48, cell, 14, color);
            x += 56;
          }
        });
        y += cell + 4;
      }
      return y - (depth ? 4 : 0);
    }

    case "pictures": {
      const items = s.pictures ?? [];
      if (s.wide) {
        // Picture → write its word: three cards a line, the answer box the card's width.
        const cols = 3;
        const gap = 10;
        const cw = (W - gap * (cols - 1)) / cols;
        const bh = ruled ? ruledHeight(ruling) : 32;
        const h = 70 + bh;
        items.forEach((p, i) => {
          const col = i % cols;
          if (col === 0 && i > 0) y += h + gap;
          if (col === 0) breakIfNeeded(h);
          const x = mx(MARGIN + col * (cw + gap), cw);
          box(doc, x, y, cw, h);
          const img = pictures.get(p.pictureId);
          if (img) doc.image(img, x + 4, y + 4, { fit: [cw - 8, h - bh - 14], align: "center", valign: "center" });
          writeBox(doc, x + 6, y + h - bh - 6, cw - 12, bh, ruled, ruling);
          if (answers) centered(doc, p.a, x + 6, y + h - bh - 6, cw - 12, bh, 14, ANSWER);
        });
        return y + (items.length ? h : 0);
      }
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
          const bh = ruled ? ruledHeight(ruling) : 34;
          writeBox(doc, x + colW - 46, y + (h - bh) / 2, 38, bh, ruled, ruling);
          if (answers) centered(doc, p.a, x + colW - 46, y + (h - bh) / 2, 38, bh, 14, ANSWER);
        });
        return y + (items.length ? h : 0);
      }
      const cols = 5;
      const gap = 8;
      const cw = (W - gap * (cols - 1)) / cols;
      const bh = ruled ? ruledHeight(ruling) : 30;
      const h = 58 + bh;
      items.forEach((p, i) => {
        const col = i % cols;
        if (col === 0 && i > 0) y += h + gap;
        if (col === 0) breakIfNeeded(h);
        const x = mx(MARGIN + col * (cw + gap), cw);
        box(doc, x, y, cw, h);
        const img = pictures.get(p.pictureId);
        if (img) doc.image(img, x + 4, y + 4, { fit: [cw - 8, h - bh - 12], align: "center", valign: "center" });
        const bx = x + (cw - 40) / 2;
        writeBox(doc, bx, y + h - bh - 6, 40, bh, ruled, ruling);
        if (answers) centered(doc, p.a, bx, y + h - bh - 6, 40, bh, 14, ANSWER);
      });
      return y + (items.length ? h : 0);
    }

    case "prompts": {
      // KG prompt questions (D-#847): what is given, then the child's boxes — one item a line.
      const h = ruled ? ruledHeight(ruling) : 30;
      const promptW = W * 0.26;
      const drawBoxes = (ln: PromptLine, x0: number, width: number, top: number): number => {
        let x = x0;
        let w = width;
        let yy = top;
        if (ln.label) {
          box(doc, x, yy, PROMPT_LABEL_W, h);
          centered(doc, ln.label, x, yy, PROMPT_LABEL_W, h, 11);
          x += PROMPT_LABEL_W + 6;
          w -= PROMPT_LABEL_W + 6;
        }
        if (ln.wide) {
          writeBox(doc, x, yy, w, h, ruled, ruling);
          const a = ln.answers?.filter(Boolean).join(", ");
          if (answers && a) centered(doc, a, x, yy, w, h, 12, ANSWER);
          return yy + h + 4;
        }
        const per = Math.min(ln.blanks, BOXES_PER_ROW);
        const bw = per === 1 ? Math.min(w, 110) : (w - 6 * (per - 1)) / per;
        for (let i = 0; i < ln.blanks; i++) {
          const col = i % per;
          if (col === 0 && i > 0) yy += h + 4;
          const bx = x + col * (bw + 6);
          writeBox(doc, bx, yy, bw, h, ruled, ruling);
          const a = ln.answers?.[i];
          if (answers && a) centered(doc, a, bx, yy, bw, h, 12, ANSWER);
        }
        return yy + h + 4;
      };
      for (const it of s.items ?? []) {
        const ih = promptItemHeight(it, h);
        breakIfNeeded(ih);
        if (it.sentence) {
          // a framed sentence: the text with a ruled gap the child writes in
          const [before, after = ""] = it.prompt.split("____");
          let x = MARGIN + 10;
          x += line(doc, before, x, y + 5, 13);
          const gapW = 110;
          doc.moveTo(x + 2, y + 21).lineTo(x + gapW - 2, y + 21).lineWidth(0.6).strokeColor("#555555").stroke();
          if (answers && it.gapAnswer) centered(doc, it.gapAnswer, x, y + 2, gapW, 20, 12, ANSWER);
          line(doc, after, x + gapW, y + 5, 13);
          y += ih;
          continue;
        }
        if (it.lines.length === 1) {
          const ln = it.lines[0];
          const ph = Math.max(boxRows(ln) * (h + 4) - 4, it.tall ? h + 24 : h);
          if (it.prompt) {
            box(doc, MARGIN, y, promptW, ph);
            centered(doc, it.prompt, MARGIN, y, promptW, it.tall ? Math.min(ph, 30) : ph, 14);
            drawBoxes(ln, MARGIN + promptW + 8, W - promptW - 8, y + (it.tall ? ph - h : 0));
          } else {
            drawBoxes(ln, MARGIN, W, y);
          }
          y += ih;
          continue;
        }
        // several lines (even / odd, break / words): the prompt above, the lines under it
        line(doc, it.prompt, MARGIN + 4, y, 13);
        let yy = y + 18;
        for (const ln of it.lines) yy = drawBoxes(ln, MARGIN + 18, W - 18, yy);
        y += ih;
      }
      return y - 4;
    }

    case "vertical": {
      // add / subtract one under the other: five sums a line, a over b, a rule, an answer box.
      const sums = s.sums ?? [];
      const bw = W / 5;
      sums.forEach((sm, i) => {
        const col = i % 5;
        if (col === 0 && i > 0) y += VERTICAL_H;
        if (col === 0) breakIfNeeded(VERTICAL_H);
        const x = MARGIN + col * bw;
        box(doc, x + 4, y, bw - 8, VERTICAL_H - 8);
        const right = x + bw - 30;
        line(doc, sm.a, right - textWidth(doc, sm.a, 16), y + 6, 16);
        line(doc, sm.b, right - textWidth(doc, sm.b, 16), y + 26, 16);
        line(doc, sm.op, right - 62, y + 26, 16);
        doc.moveTo(right - 64, y + 46).lineTo(right + 2, y + 46).lineWidth(0.9).strokeColor(LINE).stroke();
        box(doc, right - 52, y + 50, 54, 24);
        if (answers) centered(doc, sm.answer, right - 52, y + 50, 54, 24, 14, ANSWER);
      });
      return y + (sums.length ? VERTICAL_H - 8 : 0);
    }

    case "choice": {
      // A picture and its options in a row of boxes (the 2025 Nursery "ছবির হরফে বৃত্ত আঁকি"
      // table); the child circles one. The key rings the right option in red.
      const items = s.choices ?? [];
      const per = choicesPerLine(items);
      const gap = 14;
      const itemW = (W - gap * (per - 1)) / per;
      const h = CHOICE_H;
      items.forEach((ch, i) => {
        const col = i % per;
        if (col === 0 && i > 0) y += h + 6;
        if (col === 0) breakIfNeeded(h);
        const x0 = MARGIN + col * (itemW + gap);
        const picW = 70;
        const pa = mx(x0, picW);
        box(doc, pa, y, picW, h);
        const img = ch.pictureId ? pictures.get(ch.pictureId) : undefined;
        if (img) doc.image(img, pa + 3, y + 3, { fit: [picW - 6, h - 6], align: "center", valign: "center" });
        const ow = (itemW - picW) / Math.max(1, ch.options.length);
        ch.options.forEach((o, k) => {
          const ox = mx(x0 + picW + k * ow, ow);
          box(doc, ox, y, ow, h);
          const word = [...o].length > 2;
          centered(doc, o, ox, y, ow, h, word ? 13 : 16);
          if (answers && k === ch.answer) {
            doc.save().lineWidth(1.2).strokeColor(ANSWER).ellipse(ox + ow / 2, y + h / 2, Math.min(ow / 2 - 4, word ? 44 : 16), 16).stroke().restore();
          }
        });
      });
      return y + (items.length ? h : 0);
    }

    case "match": {
      const left = s.left ?? [];
      const right = s.right ?? [];
      const colW = (W - 20) / 2;
      const h = 44;
      // Arabic words need more room than a Bangla word's 54 pt box.
      const ansW = rtl && right.some((t) => [...t].length > 3) ? 96 : 54;
      left.forEach((l, i) => {
        const col = i % 2;
        if (col === 0 && i > 0) y += h + 4;
        if (col === 0) breakIfNeeded(h);
        const x = MARGIN + col * (colW + 20);
        const picW = colW * 0.42;
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


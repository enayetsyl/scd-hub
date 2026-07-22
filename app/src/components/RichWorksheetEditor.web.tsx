/**
 * RichWorksheetEditor (web) — a Google-Docs-style WYSIWYG editor for an English
 * Drive worksheet before printing (D-#349). Seeded from the doc's markdown
 * (markdown-it → HTML), it edits a real contentEditable page: Enter makes lines,
 * select text to change size, select a block/section to change its line spacing,
 * bold/italic, edit tables in place. Print goes through the BROWSER's own print
 * dialog (owner choice) — the page you see is the page that prints.
 *
 * Web-only (raw DOM: contentEditable, Selection/Range, window.print). The native
 * build gets the stub in RichWorksheetEditor.tsx.
 */
import React, { useEffect, useRef } from "react";
import MarkdownIt from "markdown-it";
import { useColors } from "../theme";
import { STR } from "../lib/labels";

const md = new MarkdownIt({ html: false, linkify: false });
const stripHtmlComments = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, "");
const stripLsDirectives = (s: string): string =>
  s.replace(/^[ \t]*\{ls:[^}]*\}[ \t]*$/gim, "");
const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);

const FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24];
const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "TD", "TH", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "UL", "OL", "TABLE", "TR",
]);

export interface RichWorksheetEditorProps {
  sourceMd: string;
  title: string;
  onDone: () => void;
}

export function RichWorksheetEditor({
  sourceMd,
  title,
  onDone,
}: RichWorksheetEditorProps): React.ReactElement {
  const c = useColors();
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = md.render(stripLsDirectives(stripHtmlComments(sourceMd)));
    }
    // Track the last non-empty selection INSIDE the editor. A toolbar <select>
    // steals focus and collapses the live selection, so we restore this before
    // applying a size/spacing change. `selectionchange` is the reliable signal.
    const onSelChange = (): void => {
      const sel = window.getSelection();
      const root = editorRef.current;
      if (
        sel &&
        sel.rangeCount &&
        !sel.isCollapsed &&
        root &&
        root.contains(sel.anchorNode) &&
        root.contains(sel.focusNode)
      ) {
        savedRange.current = sel.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function activeRange(): Range | null {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed && editorRef.current?.contains(sel.anchorNode)) {
      return sel.getRangeAt(0);
    }
    if (savedRange.current) {
      sel?.removeAllRanges();
      if (sel) sel.addRange(savedRange.current);
      return savedRange.current;
    }
    return null;
  }

  function setFontSize(px: number): void {
    const range = activeRange();
    if (!range || range.collapsed) return;
    const span = document.createElement("span");
    span.style.fontSize = `${px}px`;
    try {
      range.surroundContents(span);
    } catch {
      span.appendChild(range.extractContents());
      range.insertNode(span);
    }
    const sel = window.getSelection();
    sel?.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(span);
    sel?.addRange(r);
    savedRange.current = r.cloneRange();
  }

  function setLineHeight(lh: number): void {
    const root = editorRef.current;
    if (!root) return;
    const range = activeRange();
    if (!range || range.collapsed) {
      root.style.lineHeight = String(lh); // no selection → whole document
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let touched = false;
    let n = walker.nextNode() as HTMLElement | null;
    while (n) {
      if (BLOCK_TAGS.has(n.nodeName) && range.intersectsNode(n)) {
        n.style.lineHeight = String(lh);
        touched = true;
      }
      n = walker.nextNode() as HTMLElement | null;
    }
    if (!touched) root.style.lineHeight = String(lh);
  }

  function exec(cmd: string): void {
    editorRef.current?.focus();
    activeRange();
    document.execCommand(cmd, false);
  }

  /** Print via a hidden iframe (not window.open, which popup-blockers kill). The
   *  browser's print dialog is the PDF preview. */
  function printWorksheet(): void {
    const root = editorRef.current;
    if (!root) return;
    const rootLh = root.style.lineHeight || "1.4";
    const html =
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<style>` +
      `@page { size: A4; margin: 16mm; }` +
      `body { font-family: 'Noto Sans Bengali','Nirmala UI','Segoe UI',sans-serif; color:#000; font-size:12pt; line-height:${rootLh}; margin:0; }` +
      `table { border-collapse: collapse; width:100%; margin:6px 0; }` +
      `td,th { border:1px solid #999; padding:4px 7px; vertical-align:top; }` +
      `h1{font-size:16pt;margin:6px 0} h2{font-size:14pt;margin:6px 0} h3{font-size:12pt;margin:6px 0}` +
      `ul,ol{margin:4px 0 4px 22px} p{margin:5px 0} hr{border:none;border-top:1px solid #000;margin:8px 0}` +
      `</style></head><body>${root.innerHTML}</body></html>`;

    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(iframe);
    const idoc = iframe.contentWindow?.document;
    if (!idoc) {
      document.body.removeChild(iframe);
      return;
    }
    idoc.open();
    idoc.write(html);
    idoc.close();
    const iwin = iframe.contentWindow!;
    iwin.onafterprint = () => window.setTimeout(() => document.body.removeChild(iframe), 500);
    // Give the iframe a tick to lay out (fonts/tables) before opening the dialog.
    window.setTimeout(() => {
      iwin.focus();
      iwin.print();
    }, 300);
  }

  const btn: React.CSSProperties = {
    border: `1px solid ${c.border}`,
    background: "#fff",
    borderRadius: 6,
    padding: "4px 10px",
    cursor: "pointer",
    fontSize: 14,
  };
  const primaryBtn: React.CSSProperties = {
    ...btn,
    background: c.primary,
    color: c.onPrimary ?? "#fff",
    border: "none",
    fontWeight: 700,
  };
  const selectStyle: React.CSSProperties = { ...btn, padding: "4px 6px" };

  return (
    <div style={{ border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          padding: 8,
          background: "#f1f3f5",
          borderBottom: `1px solid ${c.border}`,
        }}
      >
        {/* preventDefault on the BUTTONS only keeps the text selection; on a <select>
            it would block the dropdown from opening (the size/spacing bug). */}
        <button
          style={{ ...btn, fontWeight: 700 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("bold")}
        >
          B
        </button>
        <button
          style={{ ...btn, fontStyle: "italic" }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("italic")}
        >
          I
        </button>
        <button
          style={{ ...btn, textDecoration: "underline" }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("underline")}
        >
          U
        </button>
        <label style={{ fontSize: 13, color: "#333" }}>
          {STR.edLayoutFont}{" "}
          <select
            style={selectStyle}
            value=""
            onChange={(e) => e.target.value && setFontSize(Number(e.target.value))}
          >
            <option value="">—</option>
            {FONT_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}px
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 13, color: "#333" }}>
          {STR.edLayoutSpacing}{" "}
          <select
            style={selectStyle}
            value=""
            onChange={(e) => e.target.value && setLineHeight(Number(e.target.value))}
          >
            <option value="">—</option>
            <option value="1">{STR.edSpaceSingle}</option>
            <option value="1.15">1.15</option>
            <option value="1.5">1.5</option>
            <option value="2">{STR.edSpaceDouble}</option>
          </select>
        </label>
        <div style={{ flex: 1 }} />
        <button style={primaryBtn} onClick={printWorksheet}>
          🖨 {STR.edPrintNow}
        </button>
        <button style={btn} onClick={onDone}>
          {STR.edEditClose}
        </button>
      </div>

      <div style={{ background: "#e5e7eb", padding: 16, maxHeight: 640, overflow: "auto" }}>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          style={{
            background: "#fff",
            color: "#000",
            width: "100%",
            maxWidth: 794,
            margin: "0 auto",
            minHeight: 420,
            padding: "32px 40px",
            boxShadow: "0 1px 4px rgba(0,0,0,.15)",
            fontFamily: "'Noto Sans Bengali','Nirmala UI','Segoe UI',sans-serif",
            fontSize: 14,
            lineHeight: 1.4,
            outline: "none",
          }}
        />
      </div>

      <div style={{ padding: 8, fontSize: 12, color: c.textSecondary, borderTop: `1px solid ${c.border}` }}>
        {STR.edRichHint}
      </div>
    </div>
  );
}

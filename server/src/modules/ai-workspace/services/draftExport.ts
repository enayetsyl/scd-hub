/**
 * Draft export (AI Workspace W-3, D-#1210) — docx or PDF, with NO AI call and no tokens.
 *
 * Markdown → HTML (markdown-it, the renderer the app already uses) → LibreOffice
 * (`soffice --headless --convert-to`, its own profile per call — the docxConvert pattern).
 * The HTML asks for "Noto Sans Bengali", the house font; LibreOffice uses it when it is
 * installed on the host (`fonts-noto-core` on the VM — listed in the W-3 setup step).
 * JSON drafts (question bank / book chapter) export as their JSON in a code block.
 */
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import MarkdownIt from "markdown-it";
import { execRunner, type CommandRunner } from "./fileText";

export type ExportFormat = "docx" | "pdf";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The HTML LibreOffice converts (exported for the test). */
export function draftHtml(input: { title: string; body: string; isJson: boolean }): string {
  const content = input.isJson ? `<pre>${escapeHtml(input.body)}</pre>` : md.render(input.body);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title>
<style>
  body { font-family: "Noto Sans Bengali", "Noto Sans", sans-serif; font-size: 12pt; line-height: 1.5; }
  h1, h2, h3 { font-family: "Noto Sans Bengali", "Noto Sans", sans-serif; }
  table { border-collapse: collapse; } td, th { border: 1px solid #888; padding: 4px 6px; }
  pre { font-family: "Noto Sans Mono", monospace; font-size: 9pt; white-space: pre-wrap; }
</style></head>
<body><h1>${escapeHtml(input.title)}</h1>
${content}
</body></html>`;
}

const FILTER: Record<ExportFormat, string> = { docx: 'docx:MS Word 2007 XML', pdf: "pdf:writer_web_pdf_Export" };
export const EXPORT_MIME: Record<ExportFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

/** Renders a draft to docx / PDF bytes. Throws when LibreOffice is missing or fails. */
export async function exportDraft(input: { title: string; body: string; isJson: boolean; format: ExportFormat }, run: CommandRunner = execRunner): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "aiws-export-"));
  try {
    const html = path.join(dir, "draft.html");
    await fs.writeFile(html, draftHtml(input), "utf8");
    const profile = `file://${path.join(dir, "profile").replace(/\\/g, "/")}`;
    await run(process.env.SOFFICE_PATH || "soffice", [`-env:UserInstallation=${profile}`, "--headless", "--convert-to", FILTER[input.format], "--outdir", dir, html]);
    return await fs.readFile(path.join(dir, `draft.${input.format}`));
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

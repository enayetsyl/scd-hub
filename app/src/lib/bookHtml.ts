/**
 * bookHtmlToMarkdown — the text fallback of the plan Book tab (PB-2, D-#1661).
 *
 * A book chapter's text can carry raw HTML (`<table>`, `<img>`, `<br>`), which the Markdown
 * renderer would print as tags. This turns the HTML it meets into what the renderer shows
 * properly: `<img>` becomes a Markdown picture, `<table>` a pipe table, and every other tag is
 * dropped (its text kept). Plain Markdown passes through untouched.
 */

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };

function decode(s: string): string {
  return s.replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m);
}

function attr(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
}

/** Cell text: tags dropped, line breaks and pipes made safe for a one-line Markdown cell. */
function cellText(html: string): string {
  return decode(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li)>/gi, " ")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function tableToMarkdown(html: string): string {
  const rows: string[][] = [];
  for (const tr of html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...tr.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => cellText(m[1]));
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]): string[] => [...r, ...Array.from({ length: cols - r.length }, () => "")];
  const line = (r: string[]): string => `| ${pad(r).join(" | ")} |`;
  const [head, ...body] = rows;
  return ["", line(head), `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`, ...body.map(line), ""].join("\n");
}

/** Convert the HTML in `source` (tables, pictures, line breaks) to Markdown; other text is unchanged. */
export function bookHtmlToMarkdown(source: string): string {
  if (!/<[a-z!/]/i.test(source)) return source;
  let s = source;
  s = s.replace(/<table\b[\s\S]*?<\/table>/gi, (t) => `\n${tableToMarkdown(t)}\n`);
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = attr(tag, "src");
    return src ? `\n\n![${attr(tag, "alt").replace(/[\]\n]/g, " ")}](${src})\n\n` : "";
  });
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h[1-6]|li|ul|ol)>/gi, "\n\n");
  // Drop the remaining tags but keep a Markdown autolink-looking or comparison text such as "a < b".
  s = s.replace(/<\/?[a-z][a-z0-9-]*\b[^>]*>/gi, "");
  return decode(s).replace(/\n{3,}/g, "\n\n").trim();
}

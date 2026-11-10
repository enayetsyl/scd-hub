/**
 * Which files a migration brings into a project (AI Workspace W-6, PRD §8) — pure, tested.
 *
 * Built for scd-central's layout: `canon/refs/*` holds the LOCKED references, often in
 * more than one version (`…_v1_0.md`, `…_v1_1.md`) and more than one format (`.md` beside the
 * `.docx` it was made from). A project should carry ONE copy of each reference — the newest
 * version, in the most readable format — or the prefix doubles and the AI reads two rules.
 *
 *   readable      only formats the workspace reads (fileText.ts); others are skipped
 *   working dirs  `_wip`, `_inbox`, `archive`, `.git` and dot-folders are skipped
 *   versions      `_v<major>_<minor>` (or `_v<major>`) — only the highest per name stays
 *   formats       for the same name + version: md > txt > json > csv > docx > xlsx > pdf
 */
export interface SourceFile {
  /** Path relative to the source root, with forward slashes. */
  path: string;
  sizeBytes: number;
}

export interface ImportDecision {
  keep: SourceFile[];
  skip: Array<SourceFile & { reason: string }>;
}

const FORMAT_RANK: Record<string, number> = { md: 1, markdown: 1, txt: 2, json: 3, csv: 4, tsv: 4, docx: 5, xlsx: 6, pdf: 7 };
const SKIP_DIRS = /(^|\/)(_wip|_inbox|_unvendored|archive|node_modules|\.[^/]+)(\/|$)/i;
const VERSION = /_v(\d+)(?:_(\d+))?$/i;

function parts(path: string): { dir: string; base: string; ext: string; family: string; major: number; minor: number } {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = file.lastIndexOf(".");
  const base = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : "";
  const m = VERSION.exec(base);
  return {
    dir,
    base,
    ext,
    family: `${dir}/${(m ? base.slice(0, m.index) : base).toLowerCase()}`,
    major: m ? Number(m[1]) : -1,
    minor: m && m[2] !== undefined ? Number(m[2]) : -1,
  };
}

export function planImport(files: SourceFile[], opts: { maxBytes?: number } = {}): ImportDecision {
  const maxBytes = opts.maxBytes ?? 40 * 1024 * 1024;
  const skip: ImportDecision["skip"] = [];
  const candidates: Array<SourceFile & { p: ReturnType<typeof parts> }> = [];
  for (const f of files) {
    const path = f.path.replace(/\\/g, "/");
    const p = parts(path);
    if (SKIP_DIRS.test(p.dir + "/")) skip.push({ ...f, path, reason: "working folder" });
    else if (!FORMAT_RANK[p.ext]) skip.push({ ...f, path, reason: `not a readable format (.${p.ext || "?"})` });
    else if (f.sizeBytes === 0) skip.push({ ...f, path, reason: "empty" });
    else if (f.sizeBytes > maxBytes) skip.push({ ...f, path, reason: "larger than 40 MB" });
    else candidates.push({ ...f, path, p });
  }
  const byFamily = new Map<string, typeof candidates>();
  for (const c of candidates) byFamily.set(c.p.family, [...(byFamily.get(c.p.family) ?? []), c]);
  const keep: SourceFile[] = [];
  for (const group of byFamily.values()) {
    group.sort((a, b) => b.p.major - a.p.major || b.p.minor - a.p.minor || FORMAT_RANK[a.p.ext] - FORMAT_RANK[b.p.ext]);
    const [best, ...rest] = group;
    keep.push({ path: best.path, sizeBytes: best.sizeBytes });
    for (const r of rest) {
      const older = r.p.major !== best.p.major || r.p.minor !== best.p.minor;
      skip.push({ path: r.path, sizeBytes: r.sizeBytes, reason: older ? `older version (kept ${best.path})` : `same document in another format (kept ${best.path})` });
    }
  }
  keep.sort((a, b) => a.path.localeCompare(b.path));
  skip.sort((a, b) => a.path.localeCompare(b.path));
  return { keep, skip };
}

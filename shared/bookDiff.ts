/**
 * bookDiff — line diff (Myers) per chapter, then a word diff inside changed lines
 * (docs/prd-book-lifecycle.md §12.4, D-#1601). Pure; shared by the server (VR-7 coverage,
 * the memo's change rows) and the app (S3 compare, S11 draft review).
 *
 * Bangla word boundaries = whitespace and punctuation (incl. the dari "।"). No library:
 * neither package had a diff dependency (PRD P14), and the algorithm is small.
 */

export type DiffOp = "eq" | "del" | "ins";
export interface DiffSegment {
  op: DiffOp;
  text: string;
}

/** Myers O(ND) shortest edit script over two token arrays. Returns ops in order. */
export function myersDiff<T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean = (x, y) => x === y): Array<{ op: DiffOp; a?: number; b?: number }> {
  const n = a.length;
  const m = b.length;
  // Common prefix / suffix trimmed first — most chapter edits are local.
  let pre = 0;
  while (pre < n && pre < m && eq(a[pre], b[pre])) pre++;
  let suf = 0;
  while (suf < n - pre && suf < m - pre && eq(a[n - 1 - suf], b[m - 1 - suf])) suf++;
  const A = a.slice(pre, n - suf);
  const B = b.slice(pre, m - suf);
  const N = A.length;
  const M = B.length;
  const out: Array<{ op: DiffOp; a?: number; b?: number }> = [];
  for (let i = 0; i < pre; i++) out.push({ op: "eq", a: i, b: i });

  const middle: Array<{ op: DiffOp; a?: number; b?: number }> = [];
  if (N === 0) {
    for (let j = 0; j < M; j++) middle.push({ op: "ins", b: pre + j });
  } else if (M === 0) {
    for (let i = 0; i < N; i++) middle.push({ op: "del", a: pre + i });
  } else {
    const max = N + M;
    const offset = max;
    let v: Int32Array<ArrayBufferLike> = new Int32Array(2 * max + 2);
    const trace: Int32Array<ArrayBufferLike>[] = [];
    let found = false;
    for (let d = 0; d <= max && !found; d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x: number;
        if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
        else x = v[offset + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && eq(A[x], B[y])) {
          x++;
          y++;
        }
        v[offset + k] = x;
        if (x >= N && y >= M) {
          found = true;
          break;
        }
      }
    }
    // Backtrack.
    let x = N;
    let y = M;
    const rev: Array<{ op: DiffOp; a?: number; b?: number }> = [];
    for (let d = trace.length - 1; d >= 0; d--) {
      v = trace[d];
      const k = x - y;
      let prevK: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) prevK = k + 1;
      else prevK = k - 1;
      const prevX = d === 0 ? 0 : v[offset + prevK];
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) {
        rev.push({ op: "eq", a: pre + x - 1, b: pre + y - 1 });
        x--;
        y--;
      }
      if (d > 0) {
        if (x === prevX) rev.push({ op: "ins", b: pre + y - 1 });
        else rev.push({ op: "del", a: pre + x - 1 });
      }
      x = prevX;
      y = prevY;
    }
    // d === 0 leftovers are equal runs, handled by the while above.
    rev.reverse();
    middle.push(...rev);
  }
  out.push(...middle);
  for (let i = 0; i < suf; i++) out.push({ op: "eq", a: n - suf + i, b: m - suf + i });
  return out;
}

export interface LineHunk {
  /** 0-based line index in the old text where the hunk starts, and how many old lines it covers. */
  aStart: number;
  aLines: number;
  bStart: number;
  bLines: number;
  removed: string[];
  added: string[];
  /** Word-level view of the changed region (old lines joined vs new lines joined). */
  words: DiffSegment[];
}

const splitLines = (t: string): string[] => (t === "" ? [] : t.split("\n"));

/** Line hunks of `before → after`. Identical text → []. */
export function diffLines(before: string, after: string): LineHunk[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const ops = myersDiff(a, b);
  const hunks: LineHunk[] = [];
  let i = 0;
  let ai = 0;
  let bi = 0;
  while (i < ops.length) {
    const o = ops[i];
    if (o.op === "eq") {
      ai++;
      bi++;
      i++;
      continue;
    }
    const h: LineHunk = { aStart: ai, aLines: 0, bStart: bi, bLines: 0, removed: [], added: [], words: [] };
    while (i < ops.length && ops[i].op !== "eq") {
      if (ops[i].op === "del") {
        h.removed.push(a[ops[i].a!]);
        h.aLines++;
        ai++;
      } else {
        h.added.push(b[ops[i].b!]);
        h.bLines++;
        bi++;
      }
      i++;
    }
    h.words = diffWords(h.removed.join("\n"), h.added.join("\n"));
    hunks.push(h);
  }
  return hunks;
}

/** Tokens: runs of word characters, or single whitespace/punctuation runs (kept, so the diff joins back exactly). */
const TOKEN_RE = /[\s]+|[।॥,;:!?.()"'“”‘’\-–—\[\]{}<>|/\\*_#`~=+]+|[^\s।॥,;:!?.()"'“”‘’\-–—\[\]{}<>|/\\*_#`~=+]+/gu;

export function tokenizeWords(t: string): string[] {
  return t.match(TOKEN_RE) ?? [];
}

/** Word diff; adjacent segments of the same op are merged. */
export function diffWords(before: string, after: string): DiffSegment[] {
  const a = tokenizeWords(before);
  const b = tokenizeWords(after);
  const ops = myersDiff(a, b);
  const segs: DiffSegment[] = [];
  for (const o of ops) {
    const text = o.op === "ins" ? b[o.b!] : a[o.a!];
    const last = segs[segs.length - 1];
    if (last && last.op === o.op) last.text += text;
    else segs.push({ op: o.op, text });
  }
  return segs;
}

/** Whitespace-folded form used to match a hunk to a declared change (VR-7). */
export function foldWhitespace(t: string): string {
  return t.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * homeworkPicker — the question picker's state on the Declare-homework screen (AL-5, B1/B2, AC-B1, AC-B16, R26).
 *
 * PURE module (no React / React Native / `labels` import) so the server suite can unit-test it, the posture
 * `giftGrouping.ts` takes — the app workspace has no test runner.
 *
 * The server drafts the questions (`masteryHomeworkDraft`); the teacher swaps / removes / adds, writes her own, and
 * adds free lines (kind + text + minutes, no marks). Save sends `selectedQids` (bank), `teacherItems` (own, with
 * marks) and `freeLines`. The running total is marks × `minutesPerMark` + the free lines' minutes — the rate comes
 * from the school policy the screen reads, never from here (R26), and the rounding mirrors the server's
 * `homeworkMinutes` so the number on the screen is the number the item gets.
 */

export interface PickerItem {
  /** Stable key: the qid for a bank question, "own:<n>" for the teacher's own. */
  key: string;
  origin: "BANK" | "TEACHER";
  qid: string | null;
  textBn: string;
  loCode: string;
  marks: number;
  /** R23: re-offered because no unused question was left ("আবার"). */
  repeat: boolean;
}

export interface PickerFreeLine {
  kind: string;
  textBn: string;
  estMinutes: number;
}

export interface PickerState {
  items: PickerItem[];
  freeLines: PickerFreeLine[];
  /** Next id for the teacher's own items. */
  seq: number;
}

/** A bank question the teacher may swap in or add (from the gold bank, on one objective). */
export interface PickerCandidate {
  qid: string;
  textBn: string;
  loCodes: string[];
  marks: number;
  /** R23: given to the শাখা before, outside the no-repeat window — marked "আবার", ranked last. */
  repeat?: boolean;
}

export type PickerAction =
  | { type: "load"; items: PickerItem[]; freeLines: PickerFreeLine[] }
  | { type: "swap"; key: string; candidate: PickerCandidate }
  | { type: "remove"; key: string }
  | { type: "addBank"; candidate: PickerCandidate; loCode: string }
  | { type: "addOwn"; textBn: string; marks: number }
  | { type: "addFreeLine"; line: PickerFreeLine }
  | { type: "removeFreeLine"; index: number };

export const emptyPicker = (): PickerState => ({ items: [], freeLines: [], seq: 1 });

const bankItem = (c: PickerCandidate, loCode: string): PickerItem => ({
  key: c.qid,
  origin: "BANK",
  qid: c.qid,
  textBn: c.textBn,
  loCode,
  marks: c.marks,
  repeat: Boolean(c.repeat),
});

export function pickerReducer(state: PickerState, a: PickerAction): PickerState {
  switch (a.type) {
    case "load":
      return { items: a.items, freeLines: a.freeLines, seq: a.items.filter((i) => i.origin === "TEACHER").length + 1 };
    case "swap": {
      const at = state.items.findIndex((i) => i.key === a.key);
      if (at < 0 || state.items.some((i) => i.key === a.candidate.qid)) return state;
      const old = state.items[at]!;
      const items = state.items.slice();
      items[at] = bankItem(a.candidate, a.candidate.loCodes.includes(old.loCode) ? old.loCode : (a.candidate.loCodes[0] ?? old.loCode));
      return { ...state, items };
    }
    case "remove":
      return { ...state, items: state.items.filter((i) => i.key !== a.key) };
    case "addBank":
      if (state.items.some((i) => i.key === a.candidate.qid)) return state;
      return { ...state, items: [...state.items, bankItem(a.candidate, a.loCode)] };
    case "addOwn": {
      const textBn = a.textBn.trim();
      if (!textBn || !(a.marks > 0) || Math.round(a.marks * 2) !== a.marks * 2) return state;
      const item: PickerItem = { key: `own:${state.seq}`, origin: "TEACHER", qid: null, textBn, loCode: "", marks: a.marks, repeat: false };
      return { ...state, items: [...state.items, item], seq: state.seq + 1 };
    }
    case "addFreeLine": {
      const textBn = a.line.textBn.trim();
      if (!textBn || !Number.isInteger(a.line.estMinutes) || a.line.estMinutes < 0 || a.line.estMinutes > 240) return state;
      return { ...state, freeLines: [...state.freeLines, { ...a.line, textBn }] };
    }
    case "removeFreeLine":
      return { ...state, freeLines: state.freeLines.filter((_, i) => i !== a.index) };
  }
}

export const totalMarks = (items: readonly PickerItem[]): number => items.reduce((s, i) => s + i.marks, 0);

/** Σ marks × minutesPerMark + each free line's minutes, rounded like the server (R26). */
export function estMinutes(state: Pick<PickerState, "items" | "freeLines">, minutesPerMark: number): number {
  const rate = Number.isFinite(minutesPerMark) && minutesPerMark > 0 ? minutesPerMark : 0;
  return Math.round(totalMarks(state.items) * rate + state.freeLines.reduce((s, l) => s + l.estMinutes, 0));
}

/**
 * The next bank candidate for a swap: same objective as the item, not already on the sheet, the one after the
 * current question in pool order (wrapping), so repeated swaps walk through the pool instead of ping-ponging.
 */
export function nextCandidate(pool: readonly PickerCandidate[], items: readonly PickerItem[], item: PickerItem): PickerCandidate | null {
  const taken = new Set(items.map((i) => i.key));
  // Unused questions first, an older repeat last (R23); the order inside each group is the pool's.
  const same = pool.filter((c) => c.loCodes.includes(item.loCode));
  same.sort((a, b) => Number(Boolean(a.repeat)) - Number(Boolean(b.repeat)));
  if (same.length === 0) return null;
  const from = same.findIndex((c) => c.qid === item.qid);
  for (let step = 1; step <= same.length; step++) {
    const c = same[(from + step + same.length) % same.length]!;
    if (!taken.has(c.qid)) return c;
  }
  return null;
}

/** Candidates for "add from the bank": the pool minus what is already on the sheet. */
export const addableCandidates = (pool: readonly PickerCandidate[], items: readonly PickerItem[], filter = ""): PickerCandidate[] => {
  const taken = new Set(items.map((i) => i.key));
  const q = filter.trim().toLowerCase();
  return pool
    .filter((c) => !taken.has(c.qid) && (!q || c.textBn.toLowerCase().includes(q) || c.qid.toLowerCase().includes(q)))
    .sort((a, b) => Number(Boolean(a.repeat)) - Number(Boolean(b.repeat)));
};

/** The three save arguments the declare / update mutations take. */
export function saveArgs(state: PickerState): {
  selectedQids: string[];
  teacherItems: { textBn: string; marks: number }[];
  freeLines: PickerFreeLine[];
} {
  return {
    selectedQids: state.items.filter((i) => i.origin === "BANK" && i.qid).map((i) => i.qid as string),
    teacherItems: state.items.filter((i) => i.origin === "TEACHER").map((i) => ({ textBn: i.textBn, marks: i.marks })),
    freeLines: state.freeLines,
  };
}

/** A draft question as the server returns it (`masteryHomeworkDraft.items`). */
export interface DraftItemLike {
  origin: string;
  qid: string | null;
  textBn: string | null;
  loCode: string;
  marks: number;
  fromBook?: boolean;
  repeat?: boolean;
}

/**
 * Server draft → picker state. A book-exercise fallback (`fromBook`) is a FREE LINE, not a marked item (§4.7: "nothing
 * suitable → the book exercise as a free line"); its minutes follow the marks the draft gave it × the policy rate.
 */
export function draftToPicker(items: readonly DraftItemLike[], minutesPerMark: number, textbookKind = "TEXTBOOK"): PickerState {
  const picked: PickerItem[] = [];
  const lines: PickerFreeLine[] = [];
  let own = 0;
  for (const d of items) {
    if (d.fromBook) {
      lines.push({ kind: textbookKind, textBn: d.textBn ?? "", estMinutes: Math.min(240, Math.max(0, Math.round(d.marks * (minutesPerMark > 0 ? minutesPerMark : 0)))) });
    } else if (d.origin === "BANK" && d.qid) {
      picked.push({ key: d.qid, origin: "BANK", qid: d.qid, textBn: d.textBn ?? d.qid, loCode: d.loCode, marks: d.marks, repeat: Boolean(d.repeat) });
    } else {
      own += 1;
      picked.push({ key: `own:${own}`, origin: "TEACHER", qid: null, textBn: d.textBn ?? "", loCode: d.loCode, marks: d.marks, repeat: false });
    }
  }
  return { items: picked, freeLines: lines, seq: own + 1 };
}

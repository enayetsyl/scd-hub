/**
 * Question-bank browse state (ux-audit F5) — filters, search and the paginated
 * result window live here (provider above the navigator) so a basket round-trip,
 * a preview visit or a drawer switch never wipes them. Filters + search are also
 * persisted via the storage shim (SecureStore native / localStorage web) so they
 * survive an app restart. The result window (items/cursor) and the selection
 * (BasketContext) are deliberately NOT persisted: the item window is server data,
 * and a large Bangla-label blob would breach SecureStore's ~2KB value limit.
 */
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { getItem, setItem } from "../lib/storage";
import type { QuestionListItem } from "../graphql/operations";

export interface QbFilters {
  subject: string | null;
  classLevel: number | null;
  /** Multi-select axes (D-#524). Empty array = no constraint on that axis. */
  topicTags: string[];
  questionTypes: string[];
  /** Chapter numbers, from the artifact's own address (D-#524). */
  chapters: number[];
  /** Exercise family (D-#511) — only offered where the chosen slice has any. */
  category: string | null;
  paperRole: string | null;
  difficulty: string | null;
  bloomLevel: string | null;
  reviewStatus: string | null;
  marksMin: string;
  marksMax: string;
}

export const EMPTY_FILTERS: QbFilters = {
  subject: null,
  classLevel: null,
  topicTags: [],
  questionTypes: [],
  chapters: [],
  category: null,
  paperRole: null,
  difficulty: null,
  bloomLevel: null,
  reviewStatus: null,
  marksMin: "",
  marksMax: "",
};

const STORAGE_KEY = "scd_qbank_ctx";

interface QuestionBankContextValue {
  /** Hydration gate — pause the bank query until the persisted filters are in. */
  loaded: boolean;
  filters: QbFilters;
  search: string;
  /** Number of active filters (for the FilterBar badge). */
  activeCount: number;
  setFilters: (next: QbFilters) => void;
  clearFilter: (key: keyof QbFilters) => void;
  clearAll: () => void;
  setSearch: (s: string) => void;
  // --- paginated result window (runtime only) ---
  items: QuestionListItem[];
  /** Cursor for the NEXT page (last item's id), null = first page. */
  after: string | null;
  /** True once a short page came back — hides the load-more footer. */
  exhausted: boolean;
  /** Append a fetched page; replaces the window when it was a first page. */
  appendPage: (page: QuestionListItem[], requestedAfter: string | null, pageSize: number) => void;
  requestNextPage: () => void;
  resetPages: () => void;
}

const QuestionBankContext = createContext<QuestionBankContextValue | null>(null);

function countActive(filters: QbFilters): number {
  let n = 0;
  for (const key of Object.keys(filters) as Array<keyof QbFilters>) {
    const v = filters[key];
    // A multi-select axis counts ONCE however many chips are picked, and an empty
    // array is not a filter at all — `[] !== null && [] !== ""` is true, so the old
    // scalar test would have counted every cleared axis as active (D-#524).
    if (Array.isArray(v)) {
      if (v.length > 0) n += 1;
    } else if (v !== null && v !== "") {
      n += 1;
    }
  }
  return n;
}

/**
 * Coerce a persisted blob into the CURRENT filter shape.
 *
 * The multi-select axes were scalars before D-#524, and the persisted value survives
 * an app update — so a returning user's storage still holds `topicTag: "TOP-…"` where
 * the code now expects `topicTags: [...]`. Without this the first `.map` over it throws
 * and the bank screen dies on open. Unknown/!!corrupt values fall back to the empty
 * filter rather than propagating.
 */
export function normalizeFilters(raw: unknown): QbFilters {
  const r = (raw ?? {}) as Record<string, unknown>;
  const strList = (many: unknown, one: unknown): string[] => {
    if (Array.isArray(many)) return many.filter((v): v is string => typeof v === "string" && v !== "");
    return typeof one === "string" && one !== "" ? [one] : [];
  };
  const numList = (many: unknown): number[] => {
    if (!Array.isArray(many)) return [];
    return many.map((v) => Number(v)).filter((n) => Number.isInteger(n));
  };
  const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    subject: str(r.subject),
    classLevel: Number.isInteger(r.classLevel) ? (r.classLevel as number) : null,
    topicTags: strList(r.topicTags, r.topicTag),
    questionTypes: strList(r.questionTypes, r.questionType),
    chapters: numList(r.chapters),
    category: str(r.category),
    paperRole: str(r.paperRole),
    difficulty: str(r.difficulty),
    bloomLevel: str(r.bloomLevel),
    reviewStatus: str(r.reviewStatus),
    marksMin: text(r.marksMin),
    marksMax: text(r.marksMax),
  };
}

interface BrowseState {
  filters: QbFilters;
  search: string;
}

export function QuestionBankProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [browse, setBrowse] = useState<BrowseState>({ filters: EMPTY_FILTERS, search: "" });
  const [loaded, setLoaded] = useState(false);

  const [items, setItems] = useState<QuestionListItem[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const browseRef = useRef(browse);
  browseRef.current = browse;

  useEffect(() => {
    (async () => {
      const raw = await getItem(STORAGE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          setBrowse({
            filters: normalizeFilters(parsed),
            search: typeof parsed.search === "string" ? (parsed.search as string) : "",
          });
        } catch {
          /* ignore corrupt persisted value */
        }
      }
      setLoaded(true);
    })();
  }, []);

  const resetPages = useCallback(() => {
    setItems([]);
    setAfter(null);
    setExhausted(false);
  }, []);

  /** Commit a browse-state change: set state, persist, reset pagination. */
  const commit = useCallback(
    (next: BrowseState) => {
      setBrowse(next);
      void setItem(STORAGE_KEY, JSON.stringify({ ...next.filters, search: next.search }));
      resetPages();
    },
    [resetPages],
  );

  const setFilters = useCallback(
    (next: QbFilters) => commit({ filters: next, search: browseRef.current.search }),
    [commit],
  );

  const clearFilter = useCallback(
    (key: keyof QbFilters) => {
      const prev = browseRef.current;
      const empty = EMPTY_FILTERS[key];
      commit({
        filters: { ...prev.filters, [key]: Array.isArray(empty) ? [] : empty },
        search: prev.search,
      });
    },
    [commit],
  );

  const clearAll = useCallback(
    () => commit({ filters: EMPTY_FILTERS, search: "" }),
    [commit],
  );

  const setSearch = useCallback(
    (s: string) => commit({ filters: browseRef.current.filters, search: s }),
    [commit],
  );

  const appendPage = useCallback(
    (page: QuestionListItem[], requestedAfter: string | null, pageSize: number) => {
      setItems((prev) => {
        const base = requestedAfter === null ? [] : prev;
        const seen = new Set(base.map((q) => q.id));
        const fresh = page.filter((q) => !seen.has(q.id));
        return [...base, ...fresh];
      });
      if (page.length < pageSize) setExhausted(true);
    },
    [],
  );

  const requestNextPage = useCallback(() => {
    const last = itemsRef.current[itemsRef.current.length - 1];
    if (last) setAfter(last.id);
  }, []);

  const value = useMemo<QuestionBankContextValue>(
    () => ({
      loaded,
      filters: browse.filters,
      search: browse.search,
      activeCount: countActive(browse.filters),
      setFilters,
      clearFilter,
      clearAll,
      setSearch,
      items,
      after,
      exhausted,
      appendPage,
      requestNextPage,
      resetPages,
    }),
    [loaded, browse, setFilters, clearFilter, clearAll, setSearch,
     items, after, exhausted, appendPage, requestNextPage, resetPages],
  );

  return <QuestionBankContext.Provider value={value}>{children}</QuestionBankContext.Provider>;
}

export function useQuestionBank(): QuestionBankContextValue {
  const ctx = useContext(QuestionBankContext);
  if (!ctx) throw new Error("useQuestionBank must be used within QuestionBankProvider");
  return ctx;
}

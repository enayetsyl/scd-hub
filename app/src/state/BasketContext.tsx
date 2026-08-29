/**
 * Working basket (J3.1) — local, in-memory accumulation of selected questions
 * before a set is created. Each "Add to basket" tap in the question bank lands
 * here; BasketScreen turns the basket into createSet + addQuestionToSet calls.
 * The basket count badges the Questions tab.
 */
import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { setExamMinutes } from "@scd/shared";

export interface BasketEntry {
  artifactId: string;
  qid: string;
  marks: number;
  /** Short label for display (question text or qid). */
  label: string;
  subject: string;
  /** Drives the time estimate (QT-1, D-#574) — the rate is per (subject × type). */
  questionType: string | null;
  /** Content class level (1..5) — used to guard against assigning to a mismatched section. */
  classLevel: number;
}

interface BasketContextValue {
  items: BasketEntry[];
  count: number;
  totalMarks: number;
  /**
   * Exam minutes for the basket AS A WHOLE (QT-1, D-#574).
   *
   * Computed with the SAME shared helper the server snapshots onto the set, so the number
   * the teacher reads while choosing cannot differ from the one that is saved. Ceiled on
   * the SUM, never per question, so a basket of one-mark questions is not inflated.
   */
  examMinutes: number;
  has: (artifactId: string) => boolean;
  add: (entry: BasketEntry) => void;
  remove: (artifactId: string) => void;
  /** Swap an item with its neighbour (dir -1 = up, +1 = down). No-op at the ends. */
  move: (artifactId: string, dir: -1 | 1) => void;
  clear: () => void;
}

const BasketContext = createContext<BasketContextValue | null>(null);

export function BasketProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [items, setItems] = useState<BasketEntry[]>([]);

  const add = useCallback((entry: BasketEntry) => {
    setItems((prev) =>
      prev.some((i) => i.artifactId === entry.artifactId) ? prev : [...prev, entry],
    );
  }, []);

  const remove = useCallback((artifactId: string) => {
    setItems((prev) => prev.filter((i) => i.artifactId !== artifactId));
  }, []);

  const move = useCallback((artifactId: string, dir: -1 | 1) => {
    setItems((prev) => {
      const from = prev.findIndex((i) => i.artifactId === artifactId);
      const to = from + dir;
      if (from < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const has = useCallback(
    (artifactId: string) => items.some((i) => i.artifactId === artifactId),
    [items],
  );

  const value = useMemo<BasketContextValue>(
    () => ({
      items,
      count: items.length,
      totalMarks: items.reduce((s, i) => s + (i.marks || 0), 0),
      examMinutes: setExamMinutes(items),
      has,
      add,
      remove,
      move,
      clear,
    }),
    [items, has, add, remove, move, clear],
  );

  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}

export function useBasket(): BasketContextValue {
  const ctx = useContext(BasketContext);
  if (!ctx) throw new Error("useBasket must be used within BasketProvider");
  return ctx;
}

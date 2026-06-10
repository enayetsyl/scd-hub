/**
 * Working basket (J3.1) — local, in-memory accumulation of selected questions
 * before a set is created. Each "Add to basket" tap in the question bank lands
 * here; BasketScreen turns the basket into createSet + addQuestionToSet calls.
 * The basket count badges the Questions tab.
 */
import React, { createContext, useContext, useState, useCallback, useMemo } from "react";

export interface BasketEntry {
  artifactId: string;
  qid: string;
  marks: number;
  /** Short label for display (question text or qid). */
  label: string;
  subject: string;
}

interface BasketContextValue {
  items: BasketEntry[];
  count: number;
  totalMarks: number;
  has: (artifactId: string) => boolean;
  add: (entry: BasketEntry) => void;
  remove: (artifactId: string) => void;
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
      has,
      add,
      remove,
      clear,
    }),
    [items, has, add, remove, clear],
  );

  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}

export function useBasket(): BasketContextValue {
  const ctx = useContext(BasketContext);
  if (!ctx) throw new Error("useBasket must be used within BasketProvider");
  return ctx;
}

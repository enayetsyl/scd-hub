/**
 * Seeded randomness for the worksheet engine (D-#744): no Math.random anywhere, so the
 * same seed always gives the same paper. Shared by the core rules (generate.ts) and the
 * KG rules (kg.ts).
 */
export type Rng = () => number;

/** mulberry32 — tiny, fast, good enough for shuffling a worksheet. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const randInt = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));

/** Distinct indices from [lo, hi], in random order. */
export function pickIndices(rng: Rng, lo: number, hi: number, n: number): number[] {
  const all: number[] = [];
  for (let i = lo; i <= hi; i++) all.push(i);
  return shuffle(all, rng).slice(0, Math.max(0, n));
}

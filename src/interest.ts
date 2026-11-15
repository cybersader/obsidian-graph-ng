/** Degree-of-interest ranking (after van Ham and Perer): a priori interest − hop distance + user interest.
 * Pure and DOM-free. One scorer is built per focus change and memoises each score, so ordering a
 * focus's direct connections costs O(degree log degree). Nothing here runs per frame. */
export interface InterestInput {
  /** Adjacency CSR offsets: degree is `offsets[n + 1] − offsets[n]`. */
  offsets: ArrayLike<number>;
  /** Current grouping codes; absent means no bridge bonus. */
  groups?: ArrayLike<number>;
  /** Declared interest per note in [0, 1]; NaN or absent means not declared. */
  declared?: ArrayLike<number>;
  /** Visited notes, oldest first (the card's selection trail). Only the last `TRAIL` count. */
  trail?: readonly number[];
  /** "Bridges first": up-weight neighbours whose group differs from the focus's group. */
  bridges?: boolean;
}
export const TRAIL = 16;
/** Term weights. Hop distance outweighs every other term together, so tiers never reorder. */
export const WEIGHTS = { apriori: 1, declared: 1, user: 1.5, bridge: 1, hop: 5 };
/** Rare beats popular: 1 for an isolated note, falling slowly with degree. */
export const apriori = (degree: number) => 1 / (1 + Math.log2(1 + Math.max(0, degree)));
export type Scorer = (node: number, hop?: number) => number;
/** DOI scorer for one focus. `hop` defaults to 1 (direct connection). */
export function interestScorer(focus: number, x: InterestInput): Scorer {
  const user = new Map<number, number>(), t = x.trail ?? [], start = Math.max(0, t.length - TRAIL), memo = new Map<number, number>();
  // Most recent visit scores 1, older visits fade linearly.
  for (let i = start; i < t.length; i++) user.set(t[i]!, (i - start + 1) / (t.length - start));
  const g = x.bridges ? x.groups : undefined, home = g?.[focus];
  const base = (n: number) => {
    const d = x.declared?.[n];
    return WEIGHTS.apriori * apriori(x.offsets[n + 1]! - x.offsets[n]!) + (d! >= 0 && d! <= 1 ? WEIGHTS.declared * d! : 0)
      + WEIGHTS.user * (n === focus ? 0 : user.get(n) ?? 0) + (g && home !== undefined && g[n] !== undefined && g[n] !== home ? WEIGHTS.bridge : 0);
  };
  return (n, hop = 1) => { let s = memo.get(n); if (s === undefined) memo.set(n, s = base(n)); return s - WEIGHTS.hop * hop; };
}
/** Highest interest first; ties fall to `tie` (for example the name), then the lower id. The result
 * depends only on the set, not the input order. */
export const byInterest = (score: Scorer, tie?: (a: number, b: number) => number) => (a: number, b: number) => score(b) - score(a) || (tie?.(a, b) ?? 0) || a - b;

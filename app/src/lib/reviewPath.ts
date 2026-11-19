/**
 * Helpers for the reviewer's ordered path (.claude/plans/review-next-chunk.md): turning an item of
 * `myReviewPath` into a navigation action, finding the next undecided item, and wording a run of
 * chapters ("৩–৪"). No React here, so the logic is unit-testable.
 */
import { StackActions } from "@react-navigation/native";
import type { Client, CombinedError } from "urql";
import { MY_REVIEW_PATH, type ReviewPathItemT } from "../graphql/reviewHub";
import { bnNum } from "./labels";

/** The params an item names, or undefined when the JSON is unusable. */
export function itemParams(item: Pick<ReviewPathItemT, "paramsJson">): Record<string, unknown> | undefined {
  try {
    const p = JSON.parse(item.paramsJson) as unknown;
    return p && typeof p === "object" ? (p as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The stack action that opens an item: PUSH keeps the hub/chapter on the Back path, REPLACE swaps the finished screen out. */
export function openItemAction(item: Pick<ReviewPathItemT, "screen" | "paramsJson">, mode: "push" | "replace") {
  const params = itemParams(item);
  return mode === "replace" ? StackActions.replace(item.screen, params) : StackActions.push(item.screen, params);
}

/** The first undecided item of the caller's path (a fresh read): an item, null when nothing is left, or the read's error. */
export async function fetchNextItem(
  client: Client,
): Promise<{ item: ReviewPathItemT | null; error: null } | { item: null; error: CombinedError }> {
  const res = await client.query(MY_REVIEW_PATH, {}, { requestPolicy: "network-only" }).toPromise();
  if (res.error) return { item: null, error: res.error };
  return { item: res.data?.myReviewPath.next?.item ?? null, error: null };
}

/**
 * "৩–৪" for consecutive numeric chapters, "৩, ৫" otherwise (the order given is kept; it is the
 * order they were handed out in).
 */
export function chaptersLabel(chapters: readonly string[]): string {
  if (chapters.length === 0) return "";
  const nums = chapters.map((c) => Number(c));
  const consecutive =
    chapters.length > 1 && nums.every((n, i) => Number.isInteger(n) && (i === 0 || n === (nums[i - 1] as number) + 1));
  return consecutive ? `${bnNum(chapters[0] as string)}–${bnNum(chapters[chapters.length - 1] as string)}` : chapters.map((c) => bnNum(c)).join(", ");
}

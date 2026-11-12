/**
 * useGuardianFeatures (D-#1011) — the guardian-facing features switched on for the signed-in
 * guardian. The storybook shelf and activity sheets (tabs, Today cards, the all-rounder card)
 * show only when their feature is on. Staff logins never query it.
 */
import { useQuery } from "urql";
import { useAuth } from "../auth/AuthContext";
import { LESSON_PROGRESS_ON_QUERY, MY_GUARDIAN_FEATURES } from "../graphql/guardianFeatures";

export type GuardianFeatureKey = "STORYBOOKS" | "ACTIVITY_SHEETS";

export function useGuardianFeatures(): { has: (f: GuardianFeatureKey) => boolean; any: boolean } {
  const { role } = useAuth();
  const [q] = useQuery({ query: MY_GUARDIAN_FEATURES, pause: role !== "GUARDIAN", requestPolicy: "cache-and-network" });
  const on = q.data?.myGuardianFeatures ?? [];
  return { has: (f) => on.includes(f), any: on.length > 0 };
}

/** GH-4 (D-#1528): true once the school switched lesson progress on (D-#952). Guardians see the missed-lessons entries only then. */
export function useLessonProgressOn(): boolean {
  const { role } = useAuth();
  const [q] = useQuery({ query: LESSON_PROGRESS_ON_QUERY, pause: role !== "GUARDIAN", requestPolicy: "cache-and-network" });
  return q.data?.lessonProgressOn === true;
}
